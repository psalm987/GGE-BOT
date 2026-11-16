import { eq, inArray } from "drizzle-orm"
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

describe("event twins and over-limit accounts", () => {
    const named = (name: string, over: { serverId?: number; externalEvent?: boolean } = {}) => ({ ...newAccount(), name, ...over })
    const desiredOf = async (ids: string[]) => Object.fromEntries((await api.db.select().from(gameAccounts).where(inArray(gameAccounts.id, ids))).map(a => [a.id, a.desiredState]))

    test("an event twin can be added at the limit and doesn't count", async () => {
        const p = await api.player()
        const main = await p.api.accounts.create(named("TwinMain"))
        const twin = await p.api.accounts.create(named("twinmain", { externalEvent: true }))
        expect(twin).toMatchObject({ isTwin: true, entitled: true })
        expect(await p.api.accounts.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: main.id, isTwin: false, entitled: true })]))
        await p.api.accounts.setDesiredState({ ids: [main.id, twin.id], state: "running" })
        expect(await desiredOf([main.id, twin.id])).toEqual({ [main.id]: "running", [twin.id]: "running" })
    })

    test("an event account with no main counts like any account", async () => {
        const p = await api.player()
        await p.api.accounts.create(named("Lonely", { externalEvent: true }))
        expect(await codeOf(p.api.accounts.create(newAccount()))).toBe("FORBIDDEN")
        expect(await codeOf(p.api.accounts.create(named("Lonely", { serverId: 27, externalEvent: true })))).toBe("FORBIDDEN")
    })

    test("lowering the limit stops the newest bots and keeps every account and its settings", async () => {
        const p = await api.player("shrinker")
        const id = await userId("shrinker")
        await admin.api.users.setMaxBots({ id, maxBots: 3 })
        const oldest = await p.api.accounts.create(named("Old1"))
        const oldTwin = await p.api.accounts.create(named("Old1", { externalEvent: true }))
        const middle = await p.api.accounts.create({ ...named("Mid1"), plugins: { attackNomads: { enabled: true, options: {} } } })
        const newest = await p.api.accounts.create(named("New1"))
        const all = [oldest.id, oldTwin.id, middle.id, newest.id]
        await p.api.accounts.setDesiredState({ ids: all, state: "running" })

        await admin.api.users.setMaxBots({ id, maxBots: 1 })

        expect(await desiredOf(all)).toEqual({ [oldest.id]: "running", [oldTwin.id]: "running", [middle.id]: "stopped", [newest.id]: "stopped" })
        const list = await p.api.accounts.list()
        expect(list).toHaveLength(4)
        expect(list.find(a => a.id === middle.id)).toMatchObject({ entitled: false, plugins: { attackNomads: { enabled: true } } })
        const entry = (await admin.api.audit.list({ limit: 20 })).find(e => e.action === "admin.user.max_bots" && e.targetId === id)
        expect((entry!.meta as { stopped: string[] }).stopped.sort()).toEqual([middle.id, newest.id].sort())
    })

    test("starting an account beyond the plan is refused for the whole batch", async () => {
        const p = await api.player("overrun")
        const owner = await userId("overrun")
        await api.db.insert(gameAccounts).values(["O1", "O2"].map((name, i) => ({ ownerId: owner, name, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw"), createdAt: new Date(Date.UTC(2026, 0, 1 + i)) })))
        const [first, second] = await p.api.accounts.list()
        expect([first!.entitled, second!.entitled]).toEqual([true, false])
        const error = await p.api.accounts.setDesiredState({ ids: [first!.id, second!.id], state: "running" }).catch(e => e as { code: string; message: string })
        expect(error).toMatchObject({ code: "FORBIDDEN", message: "Your plan runs your oldest bot and their event twins. Remove a bot to start this one." })
        expect(await desiredOf([first!.id, second!.id])).toEqual({ [first!.id]: "stopped", [second!.id]: "stopped" })
        expect(await codeOf(p.api.accounts.setDesiredState({ ids: [first!.id], state: "running" }))).toBe("ok")
        expect(await codeOf(p.api.accounts.setDesiredState({ ids: [second!.id], state: "stopped" }))).toBe("ok")
    })

    test("turning a twin into an account that counts is refused at the limit", async () => {
        const p = await api.player()
        const main = await p.api.accounts.create(named("Pair"))
        const twin = await p.api.accounts.create(named("Pair", { externalEvent: true }))
        for (const change of [{ name: "Other" }, { serverId: 27 }])
            expect(await codeOf(p.api.accounts.update({ id: twin.id, ...change }))).toBe("FORBIDDEN")
        expect(await codeOf(p.api.accounts.update({ id: main.id, name: "Renamed" }))).toBe("FORBIDDEN")
        expect(await p.api.accounts.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: twin.id, name: "Pair", serverId: 26, isTwin: true })]))
        expect(await codeOf(p.api.accounts.update({ id: twin.id, password: "new" }))).toBe("ok")
    })

    test("demoting an admin stops the bots beyond a player's plan", async () => {
        await api.player("promoted")
        const id = await userId("promoted")
        await admin.api.users.setRole({ id, role: "admin" })
        const owned = await api.db.insert(gameAccounts).values(["A1", "A2", "A3"].map((name, i) => ({
            ownerId: id, name, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw"), desiredState: "running" as const, createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
        }))).returning({ id: gameAccounts.id })

        await admin.api.users.setRole({ id, role: "user" })

        expect(Object.values(await desiredOf(owned.map(a => a.id))).sort()).toEqual(["running", "stopped", "stopped"])
        expect((await desiredOf([owned[0]!.id]))[owned[0]!.id]).toBe("running")
        const entry = (await admin.api.audit.list({ limit: 20 })).find(e => e.action === "user.set_role" && e.targetId === id)
        expect(entry).toMatchObject({ meta: { role: "user", stopped: expect.arrayContaining([owned[1]!.id, owned[2]!.id]) } })
    })
})
