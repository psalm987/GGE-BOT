import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { PASSWORD, allStrings, startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
})
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const userId = async (username: string) => (await admin.api.users.list({ search: username })).find(u => u.username === username)!.id

describe("managing users", () => {
    test("disabling a player ends their sessions and stops their bots", async () => {
        const p = await api.player("rowdy")
        const { id } = await p.api.accounts.create({ name: "R", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
        await p.api.accounts.setDesiredState({ ids: [id], state: "running" })

        await admin.api.users.setStatus({ id: await userId("rowdy"), status: "disabled" })

        expect(await p.api.auth.me()).toBeNull()
        const all = await admin.api.accounts.list()
        expect(all.find(a => a.id === id)).toMatchObject({ owner: "rowdy", desiredState: "stopped" })
    })

    test("the user list counts each player's game accounts", async () => {
        const p = await api.player("counted")
        await admin.api.users.setMaxBots({ id: await userId("counted"), maxBots: 2 })
        await p.api.accounts.create({ name: "C1", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
        await p.api.accounts.create({ name: "C2", serverId: 26, password: "pw", externalEvent: false, plugins: {} })
        const [row] = await admin.api.users.list({ search: "counted" })
        expect(row).toMatchObject({ username: "counted", accountCount: 2, maxBots: 2 })
    })

    test("an admin can't disable or demote themselves", async () => {
        const me = await userId("boss")
        expect(await codeOf(admin.api.users.setStatus({ id: me, status: "disabled" }))).toBe("BAD_REQUEST")
        expect(await codeOf(admin.api.users.setRole({ id: me, role: "user" }))).toBe("BAD_REQUEST")
        expect(await codeOf(admin.api.overview())).toBe("ok")
    })

    test("promoting a player lets them into the admin app", async () => {
        await api.player("promoted")
        await admin.api.users.setRole({ id: await userId("promoted"), role: "admin" })
        expect(await codeOf(api.admin().api.auth.login({ login: "promoted", password: PASSWORD }))).toBe("ok")
    })

    test("force stop works on any player's account and the admin view shows no passwords", async () => {
        const p = await api.player()
        const { id } = await p.api.accounts.create({ name: "F", serverId: 27, password: "leak-check-pw", externalEvent: false, plugins: {} })
        await p.api.accounts.setDesiredState({ ids: [id], state: "running" })
        await admin.api.accounts.forceStop({ id })
        expect((await p.api.accounts.list())[0]!.desiredState).toBe("stopped")
        expect(allStrings(await admin.api.accounts.list()).join(" ")).not.toContain("leak-check-pw")
    })
})

describe("overview and audit", () => {
    test("counts match and every change above is in the audit log with its actor", async () => {
        const overview = await admin.api.overview()
        expect(overview.users).toBeGreaterThanOrEqual(4)
        expect(overview.accounts).toBeGreaterThanOrEqual(2)

        const actions = (await admin.api.audit.list({ limit: 500 })).map(e => `${e.actor}:${e.action}`)
        for (const expected of ["boss:user.disable", "boss:user.set_role", "boss:account.force_stop", "rowdy:account.create", "rowdy:account.start"])
            expect(actions).toContain(expected)
    })

    test("players can't reach any admin procedure", async () => {
        const p = await api.player()
        const asAdminApp = api.admin()
        for (const [k, v] of p.jar) asAdminApp.jar.set(k, v)
        expect(await codeOf(asAdminApp.api.users.list({}))).toBe("UNAUTHORIZED")
        expect(await codeOf(asAdminApp.api.users.setRole({ id: await userId("boss"), role: "user" }))).toBe("UNAUTHORIZED")
    })
})
