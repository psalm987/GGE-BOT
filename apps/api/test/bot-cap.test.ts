import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { gameAccounts, users } from "@gge/db"
import { sealFor } from "@gge/crypto"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
})
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = () => ({ name: `acc${Math.random().toString(36).slice(2, 8)}`, serverId: 26, password: "pw", externalEvent: false, plugins: {} })
const userId = async (username: string) => (await admin.api.users.list({ search: username })).find(u => u.username === username)!.id

describe("one bot per player", () => {
    test("a new player gets one bot, with the limit explained when they ask for a second", async () => {
        const p = await api.player()
        expect((await p.api.auth.me())!.maxBots).toBe(1)
        await p.api.accounts.create(newAccount())
        const error = await p.api.accounts.create(newAccount()).catch(e => e as { code: string; message: string })
        expect(error).toMatchObject({ code: "FORBIDDEN", message: "Your plan allows 1 bot. Remove one to add another." })
        expect(await p.api.accounts.list()).toHaveLength(1)
    })

    test("removing the bot frees the slot", async () => {
        const p = await api.player()
        const { id } = await p.api.accounts.create(newAccount())
        await p.api.accounts.remove({ ids: [id] })
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("ok")
    })

    test("an admin raising the limit lets the player add another", async () => {
        const p = await api.player("grower")
        await p.api.accounts.create(newAccount())
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("FORBIDDEN")
        await admin.api.users.setMaxBots({ id: await userId("grower"), maxBots: 2 })
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("ok")
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("FORBIDDEN")
    })

    test("a limit of zero blocks every create", async () => {
        const p = await api.player("frozen")
        await admin.api.users.setMaxBots({ id: await userId("frozen"), maxBots: 0 })
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("FORBIDDEN")
    })

    test("the limit change is audited and unknown users are NOT_FOUND", async () => {
        await api.player("audited")
        const id = await userId("audited")
        await admin.api.users.setMaxBots({ id, maxBots: 3 })
        const entry = (await admin.api.audit.list({ limit: 20 })).find(e => e.action === "admin.user.max_bots")
        expect(entry).toMatchObject({ actor: "boss", targetId: id, meta: { maxBots: 3 } })
        expect(await codeOf(admin.api.users.setMaxBots({ id: crypto.randomUUID(), maxBots: 1 }))).toBe("NOT_FOUND")
    })

    test("admins have no limit", async () => {
        const client = api.client()
        await client.api.auth.login({ login: "boss", password: PASSWORD })
        await api.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.username, "boss"))
        for (let i = 0; i < 3; i++)
            expect(await codeOf(client.api.accounts.create(newAccount()))).toBe("ok")
    })

    test("a player already over the limit keeps, edits and removes their bots but can't add", async () => {
        const p = await api.player("legacy")
        const owner = await userId("legacy")
        await api.db.insert(gameAccounts).values(["L1", "L2"].map(name => ({ ownerId: owner, name, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw") })))
        const [first, second] = await p.api.accounts.list()
        expect(await p.api.accounts.list()).toHaveLength(2)
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("FORBIDDEN")
        expect(await p.api.accounts.update({ id: first!.id, name: "Renamed" })).toMatchObject({ name: "Renamed" })
        await p.api.accounts.remove({ ids: [first!.id] })
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("FORBIDDEN")
        await p.api.accounts.remove({ ids: [second!.id] })
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("ok")
    })

    test("simultaneous creates can't both fit in the last slot", async () => {
        const p = await api.player()
        const results = await Promise.all(Array.from({ length: 5 }, () => codeOf(p.api.accounts.create(newAccount()))))
        expect(results.filter(r => r === "ok")).toHaveLength(1)
        expect(results.filter(r => r === "FORBIDDEN")).toHaveLength(4)
        expect(await p.api.accounts.list()).toHaveLength(1)
    })
})
