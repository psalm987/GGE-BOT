import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { botLogs, users } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

const newAccount = (name: string, serverId = 26) => ({ name: `${name}-${Math.random().toString(36).slice(2, 8)}`, serverId, password: "pw", externalEvent: false, plugins: {} })
const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const parts = (tag: string) => ["[12:00] ", "[", tag, "] ", "hello"]

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

/** A confirmed player allowed enough bots for a test. */
async function playerWithBots() {
    const p = await api.player()
    await api.db.update(users).set({ maxBots: 5 }).where(sql`lower(${users.email}) = ${p.email.toLowerCase()}`)
    return p
}

describe("the global log feed", () => {
    async function setup() {
        const alice = await playerWithBots()
        const bob = await playerWithBots()
        const [a1, a2] = [await alice.api.accounts.create(newAccount("alice-one")), await alice.api.accounts.create(newAccount("alice-two", 27))]
        const b1 = await bob.api.accounts.create(newAccount("bob-one"))
        const line = (accountId: string, level: number, tag: string | null, message: string) =>
            ({ accountId, level, message, plugin: tag, parts: tag ? parts(tag) : null })
        await api.db.insert(botLogs).values([
            line(a1.id, 0, "attack", "a1 attack info"),
            line(a1.id, 2, "attackNomads", "a1 nomads error"),
            line(a2.id, 1, "attack", "a2 attack warn"),
            line(a2.id, 0, null, "a2 untagged"),
            line(b1.id, 0, "attack", "b1 secret"),
            line(a1.id, 0, "ggeBot", "a1 core"),
        ])
        return { alice, bob, a1, a2, b1 }
    }
    const messages = (lines: { message: string }[]) => lines.map(l => l.message)

    test("shows the owner's lines across accounts, newest first, and never another player's", async () => {
        const { alice, bob, b1 } = await setup()

        const mine = await alice.api.logs.feed({})
        expect(messages(mine)).toEqual(["a1 core", "a2 untagged", "a2 attack warn", "a1 nomads error", "a1 attack info"])
        expect(mine[0]).toMatchObject({ plugin: "ggeBot", level: 0 })
        expect(messages(await bob.api.logs.feed({}))).toEqual(["b1 secret"])

        const probing = await alice.api.logs.feed({ accountIds: [b1.id] })
        expect(probing).toEqual([])
    })

    test("a foreign account id passed alongside one's own adds nothing", async () => {
        const { alice, a1, b1 } = await setup()
        const lines = await alice.api.logs.feed({ accountIds: [a1.id, b1.id] })
        expect(new Set(lines.map(l => l.accountId))).toEqual(new Set([a1.id]))
        expect(messages(lines)).not.toContain("b1 secret")
    })

    test("filters by account, level and plugin, alone and together", async () => {
        const { alice, a1, a2 } = await setup()

        expect(messages(await alice.api.logs.feed({ accountIds: [a2.id] }))).toEqual(["a2 untagged", "a2 attack warn"])
        expect(messages(await alice.api.logs.feed({ levels: [1, 2] }))).toEqual(["a2 attack warn", "a1 nomads error"])
        expect(messages(await alice.api.logs.feed({ plugins: ["attack"] }))).toEqual(["a2 attack warn", "a1 attack info"])
        expect(messages(await alice.api.logs.feed({ plugins: ["attack", "ggeBot"], levels: [0], accountIds: [a1.id] })))
            .toEqual(["a1 core", "a1 attack info"])
    })

    test("before returns the next older page", async () => {
        const { alice } = await setup()

        const first = await alice.api.logs.feed({ limit: 2 })
        const second = await alice.api.logs.feed({ limit: 2, before: first.at(-1)!.id })
        const third = await alice.api.logs.feed({ limit: 2, before: second.at(-1)!.id })

        expect(messages(first)).toEqual(["a1 core", "a2 untagged"])
        expect(messages(second)).toEqual(["a2 attack warn", "a1 nomads error"])
        expect(messages(third)).toEqual(["a1 attack info"])
    })

    test("facets count only the owner's lines, with account names and server labels", async () => {
        const { alice, a1: one, a2: two } = await setup()

        const facets = await alice.api.logs.facets()

        expect(facets.total).toBe(5)
        expect(facets.accounts).toEqual([
            { id: one.id, name: one.name, serverLabel: "India 1", count: 3 },
            { id: two.id, name: two.name, serverLabel: "Germany 1", count: 2 },
        ])
        expect(facets.plugins).toEqual([{ key: "attack", count: 2 }, { key: "attackNomads", count: 1 }, { key: "ggeBot", count: 1 }])
        expect(facets.levels).toEqual([{ level: 0, count: 3 }, { level: 1, count: 1 }, { level: 2, count: 1 }])
    })

    test("a player without a confirmed email, or signed out, gets nothing", async () => {
        const newcomer = await api.signup()
        expect(await codeOf(newcomer.api.logs.feed({}))).toBe("FORBIDDEN")
        expect(await codeOf(api.client().api.logs.facets())).toBe("UNAUTHORIZED")
    })

    test("an admin reads a chosen player's feed and facets; a player cannot", async () => {
        const { alice, bob } = await setup()
        const aliceId = (await alice.api.auth.me())!.id
        const boss = await api.signedInAdmin()

        expect(messages(await boss.api.logs.feed({ ownerId: aliceId, levels: [2] }))).toEqual(["a1 nomads error"])
        expect((await boss.api.logs.facets({ ownerId: aliceId })).total).toBe(5)
        const bobId = (await bob.api.auth.me())!.id
        expect(messages(await boss.api.logs.feed({ ownerId: bobId }))).toEqual(["b1 secret"])
        expect(await codeOf(api.admin().api.logs.feed({ ownerId: aliceId }))).toBe("UNAUTHORIZED")
    })
})

describe("the plugin backfill in migration 0017", () => {
    test("tags old lines from their parts and leaves other shapes alone", async () => {
        const alice = await playerWithBots()
        const acc = await alice.api.accounts.create(newAccount("backfill"))
        const [good, bare, notBracket, numeric, nullParts] = await api.db.insert(botLogs).values([
            { accountId: acc.id, level: 0, message: "good", parts: parts("attack") },
            { accountId: acc.id, level: 0, message: "bare", parts: ["only"] },
            { accountId: acc.id, level: 0, message: "no bracket", parts: ["[t] ", "(", "x", "]"] },
            { accountId: acc.id, level: 0, message: "numeric", parts: ["[t] ", "[", 5, "]"] },
            { accountId: acc.id, level: 0, message: "no parts", parts: null },
        ]).returning({ id: botLogs.id })

        await api.db.execute(sql`
            UPDATE bot_logs SET plugin = parts->>2
            WHERE parts->>1 = '[' AND jsonb_typeof(parts->2) = 'string' AND parts->>2 <> '' AND account_id = ${acc.id}`)

        const rows = await api.db.select({ id: botLogs.id, plugin: botLogs.plugin }).from(botLogs).orderBy(botLogs.id)
        const plugin = (id: number) => rows.find(r => r.id === id)?.plugin
        expect([good, bare, notBracket, numeric, nullParts].map(r => plugin(r!.id))).toEqual(["attack", null, null, null, null])
    })
})
