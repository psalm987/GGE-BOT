import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { botLogs, botRuns } from "@gge/db"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
let watched: Awaited<ReturnType<Api["player"]>>
let bystander: Awaited<ReturnType<Api["player"]>>
let watchedId: string
let bystanderId: string
let accountId: string

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const MISSING = "00000000-0000-4000-8000-000000000000"
const userId = async (username: string) => (await admin.api.users.list({ search: username })).items.find(u => u.username === username)!.id

beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
    watched = await api.player("watched")
    bystander = await api.player("bystander")
    await watched.api.auth.login({ login: "watched", password: PASSWORD })
    watchedId = await userId("watched")
    bystanderId = await userId("bystander")
    accountId = (await watched.api.accounts.create({ name: "watched bot", serverId: 26, password: "pw", externalEvent: false, plugins: {} })).id
    await api.db.insert(botLogs).values([1, 2, 3, 4, 5].map(n => ({ accountId, level: 0, message: `line ${n}`, parts: [`line ${n}`] })))
    await api.db.insert(botRuns).values([
        { accountId, startedAt: new Date(Date.now() - 7200_000), endedAt: new Date(Date.now() - 3600_000), endReason: "crash" },
        { accountId, startedAt: new Date(Date.now() - 3600_000) },
    ])
})
afterAll(() => api.close())

describe("users.get", () => {
    test("returns the list row's fields plus the last sign-in and the live sessions", async () => {
        const fromList = (await admin.api.users.list({ search: "watched" })).items.find(u => u.id === watchedId)!
        const user = await admin.api.users.get({ id: watchedId })
        expect(user).toMatchObject({ ...fromList, accountCount: 1 })
        expect(user.sessions).toEqual({ client: 2, admin: 0 })
        expect(user.lastLoginAt).toBeInstanceOf(Date)
        expect((await admin.api.users.get({ id: bystanderId })).sessions.client).toBe(1)
    })

    test("a user who never signed in has no last sign-in", async () => {
        await api.signup("quiet")
        expect((await admin.api.users.get({ id: await userId("quiet") })).lastLoginAt).toBeNull()
    })

    test("an unknown id is NOT_FOUND and a malformed id is refused", async () => {
        expect(await codeOf(admin.api.users.get({ id: MISSING }))).toBe("NOT_FOUND")
        expect(await codeOf(admin.api.users.get({ id: "nope" }))).toBe("BAD_REQUEST")
    })

    test("a player can't call any of the new admin procedures", async () => {
        const asAdminApp = api.admin()
        for (const [k, v] of watched.jar) asAdminApp.jar.set(k, v)
        expect(await codeOf(asAdminApp.api.users.get({ id: watchedId }))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.logs.feed({ ownerId: watchedId, accountIds: [accountId] }))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.accounts.runs({ id: accountId }))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.audit.list({ actorId: watchedId }))).toBe("UNAUTHORIZED")
    })
})

describe("an account's log and runs for admins", () => {
    test("the log of an account the admin doesn't own is newest first and paged by before", async () => {
        const page = (before?: number) => admin.api.logs.feed({ ownerId: watchedId, accountIds: [accountId], limit: 2, before })
        const first = await page()
        expect(first.map(l => l.message)).toEqual(["line 5", "line 4"])
        const second = await page(first[1]!.id)
        expect(second.map(l => l.message)).toEqual(["line 3", "line 2"])
        expect(second[0]!.parts).toEqual(["line 3"])
        expect(await page(second[1]!.id)).toHaveLength(1)
    })

    test("runs come back newest first and respect the limit", async () => {
        expect((await admin.api.accounts.runs({ id: accountId })).map(r => r.endReason)).toEqual([null, "crash"])
        expect(await admin.api.accounts.runs({ id: accountId, limit: 1 })).toHaveLength(1)
    })

    test("a player reads neither the log nor the runs of another player's account", async () => {
        expect(await bystander.api.logs.feed({ accountIds: [accountId] })).toEqual([])
        expect(await codeOf(bystander.api.accounts.runs({ id: accountId }))).toBe("NOT_FOUND")
    })

    test("an account with no history is an empty page", async () => {
        expect(await admin.api.logs.feed({ ownerId: watchedId, accountIds: [MISSING] })).toEqual([])
        expect(await admin.api.accounts.runs({ id: MISSING })).toEqual([])
    })
})

describe("audit.list by actor or target", () => {
    test("actorId returns only that user's entries, targetId only entries about them, and both together return the union", async () => {
        await admin.api.users.setMaxBots({ id: watchedId, maxBots: 4 })
        await admin.api.users.setMaxBots({ id: bystanderId, maxBots: 5 })

        const byActor = await admin.api.audit.list({ actorId: watchedId })
        expect(byActor.length).toBeGreaterThan(0)
        expect(byActor.every(e => e.actor === "watched")).toBe(true)
        expect(byActor.map(e => e.action)).toContain("account.create")

        const aboutTarget = await admin.api.audit.list({ targetId: watchedId })
        expect(aboutTarget.map(e => e.action)).toContain("admin.user.max_bots")
        expect(aboutTarget.every(e => e.targetId === watchedId)).toBe(true)
        expect(aboutTarget.some(e => e.actor === "watched")).toBe(false)

        const both = await admin.api.audit.list({ actorId: watchedId, targetId: watchedId })
        expect(both.map(e => e.id).sort()).toEqual([...byActor, ...aboutTarget].map(e => e.id).sort())
        expect(both.some(e => e.actor === "watched")).toBe(true)
        expect(both.some(e => e.targetId === watchedId && e.actor === "boss")).toBe(true)
        expect(both.some(e => e.targetId === bystanderId)).toBe(false)
    })

    test("the filter combines with before for paging", async () => {
        const all = await admin.api.audit.list({ actorId: watchedId, targetId: watchedId, limit: 500 })
        const page = await admin.api.audit.list({ actorId: watchedId, targetId: watchedId, limit: 1, before: all[0]!.id })
        expect(page.map(e => e.id)).toEqual([all[1]!.id])
    })

    test("with no filter every entry is returned", async () => {
        const everything = await admin.api.audit.list({ limit: 500 })
        expect(everything.some(e => e.targetId === bystanderId)).toBe(true)
    })
})
