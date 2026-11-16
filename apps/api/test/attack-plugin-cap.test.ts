import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { pluginCatalog } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
const attackKeys = Array.from({ length: 7 }, (_, i) => `attackCap${i}`)
beforeAll(async () => {
    api = await startApi()
    await api.db.insert(pluginCatalog).values(attackKeys.map(key => ({ key, force: false, hidden: false, options: [], category: "attack" })))
    admin = await api.signedInAdmin()
})
afterAll(() => api.close())

const withAttackPlugins = (n: number) => ({
    name: `acc${Math.random().toString(36).slice(2, 8)}`, serverId: 26, password: "pw", externalEvent: false,
    plugins: Object.fromEntries(attackKeys.slice(0, n).map(key => [key, { enabled: true, options: {} }])),
})
const userId = async (username: string) => (await admin.api.users.list({ search: username })).find(u => u.username === username)!.id
const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (e: { code: string; message: string }) => e)

describe("attack plugin cap", () => {
    test("a player with no override gets the global default of 4", async () => {
        const p = await api.player()
        expect(await p.api.plugins.attackLimit()).toBe(4)
        expect(await errorOf(p.api.accounts.create(withAttackPlugins(5))))
            .toMatchObject({ code: "BAD_REQUEST", message: "Your plan allows 4 attack plugins at once. Turn some off to save." })
        expect(await errorOf(p.api.accounts.create(withAttackPlugins(4)))).toBeNull()
    })

    test("raising the global default lets players save more, and is audited", async () => {
        await admin.api.settings.setAttackPluginCap({ cap: "6" })
        expect(await admin.api.settings.get()).toEqual({ attackPluginCap: "6" })
        const p = await api.player()
        expect(await errorOf(p.api.accounts.create(withAttackPlugins(6)))).toBeNull()
        const entry = (await admin.api.audit.list({ limit: 20 })).find(e => e.action === "admin.settings.attack_plugin_cap")
        expect(entry?.meta).toEqual({ from: "4", to: "6" })
        await admin.api.settings.setAttackPluginCap({ cap: "4" })
    })

    test("a per-user override beats the default, and clearing it restores the default", async () => {
        const p = await api.player("uncapped")
        const id = await userId("uncapped")
        await admin.api.users.setAttackPluginCap({ id, cap: "none" })
        expect(await p.api.plugins.attackLimit()).toBeNull()
        expect(await errorOf(p.api.accounts.create(withAttackPlugins(7)))).toBeNull()
        expect((await admin.api.users.list({ search: "uncapped" }))[0]!.attackPluginCap).toBe("none")
        const entry = (await admin.api.audit.list({ limit: 20 })).find(e => e.action === "admin.user.attack_plugin_cap")
        expect(entry?.meta).toEqual({ from: null, to: "none" })

        await admin.api.users.setAttackPluginCap({ id, cap: null })
        expect(await p.api.plugins.attackLimit()).toBe(4)
    })

    test("changing caps needs an admin session", async () => {
        const anonymous = api.admin()
        expect((await errorOf(anonymous.api.settings.setAttackPluginCap({ cap: "none" })))?.code).toBe("UNAUTHORIZED")
        expect((await errorOf(anonymous.api.users.setAttackPluginCap({ id: crypto.randomUUID(), cap: "none" })))?.code).toBe("UNAUTHORIZED")
    })
})
