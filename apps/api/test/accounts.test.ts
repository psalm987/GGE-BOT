import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { openSealed } from "@gge/crypto"
import { allStrings, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const GAME_PASSWORD = "game-pass-S3CRET"
const newAccount = (name = `acc${Math.random().toString(36).slice(2, 8)}`) =>
    ({ name, serverId: 26, password: GAME_PASSWORD, externalEvent: false, plugins: {} })

describe("a player's accounts", () => {
    test("create, list, update and remove round-trip", async () => {
        const p = await api.player()
        const created = await p.api.accounts.create({ ...newAccount("Hero"), plugins: { attackNomads: { enabled: true, options: { eventDifficulty: "2" } } } })
        expect(created).toMatchObject({ name: "Hero", serverId: 26, desiredState: "stopped", status: null })
        expect(created.plugins.attackNomads).toEqual({ enabled: true, options: { eventDifficulty: 2 } })

        expect((await p.api.accounts.list()).map(a => a.id)).toEqual([created.id])

        const updated = await p.api.accounts.update({ id: created.id, name: "Hero2", serverId: 27 })
        expect(updated).toMatchObject({ name: "Hero2", serverId: 27 })
        expect(updated.plugins.attackNomads).toBeDefined()

        await p.api.accounts.setDesiredState({ ids: [created.id], state: "running" })
        expect((await p.api.accounts.list())[0]!.desiredState).toBe("running")

        await p.api.accounts.remove({ ids: [created.id] })
        expect(await p.api.accounts.list()).toEqual([])
    })

    test("the game password never comes back, and only the runner's key opens what is stored", async () => {
        const p = await api.player()
        const created = await p.api.accounts.create(newAccount())
        const responses = [created, await p.api.accounts.list(), await p.api.accounts.update({ id: created.id, name: "renamed" })]
        for (const text of allStrings(responses)) {
            expect(text).not.toContain(GAME_PASSWORD)
            expect(text.toLowerCase()).not.toContain("password")
        }

        const row = (await api.accountRows()).find(r => r.id === created.id)!
        expect(row.passwordSealed.toString("utf8")).not.toContain(GAME_PASSWORD)
        expect(openSealed(api.keys.privateKey, row.passwordSealed)).toBe(GAME_PASSWORD)
    })

    test("updating without a password keeps the stored one; with one, replaces it", async () => {
        const p = await api.player()
        const { id } = await p.api.accounts.create(newAccount())
        const sealed = async () => openSealed(api.keys.privateKey, (await api.accountRows()).find(r => r.id === id)!.passwordSealed)
        await p.api.accounts.update({ id, name: "x" })
        expect(await sealed()).toBe(GAME_PASSWORD)
        await p.api.accounts.update({ id, password: "new-one" })
        expect(await sealed()).toBe("new-one")
    })

    test("one game account can't be added twice, even by another player", async () => {
        const a = await api.player()
        const b = await api.player()
        await a.api.accounts.create(newAccount("Twin"))
        expect(await codeOf(b.api.accounts.create(newAccount("twin")))).toBe("CONFLICT")
        expect(await codeOf(b.api.accounts.create({ ...newAccount("twin"), serverId: 27 }))).toBe("ok")
    })

    test.each([
        ["an unknown plugin", { nope: { enabled: true, options: {} } }],
        ["a hidden plugin", { commander: { enabled: true, options: {} } }],
        ["a wrong option type", { attackNomads: { enabled: true, options: { lowValueChests: "yes" } } }],
    ])("rejects settings with %s", async (_, plugins) => {
        const p = await api.player()
        expect(await codeOf(p.api.accounts.create({ ...newAccount(), plugins }))).toBe("BAD_REQUEST")
        expect(await p.api.accounts.list()).toEqual([])
    })

    test("an unknown server is rejected", async () => {
        const p = await api.player()
        expect(await codeOf(p.api.accounts.create({ ...newAccount(), serverId: 999 }))).toBe("BAD_REQUEST")
    })

    test("signed-out callers get nothing", async () => {
        expect(await codeOf(api.client().api.accounts.list())).toBe("UNAUTHORIZED")
        expect(await codeOf(api.client().api.plugins.catalog())).toBe("UNAUTHORIZED")
    })

    test("the catalog and server list hide what players can't use", async () => {
        const p = await api.player()
        expect((await p.api.plugins.catalog()).map(e => e.key)).toEqual(["attack", "attackNomads"])
        expect(await p.api.servers.list()).toEqual([{ id: 27, label: "Germany 1" }, { id: 26, label: "India 1" }])
    })
})

describe("one player can't touch another's accounts", () => {
    test("update, remove and start on someone else's account change nothing", async () => {
        const owner = await api.player()
        const intruder = await api.player()
        const { id } = await owner.api.accounts.create(newAccount("Mine"))

        expect(await intruder.api.accounts.list()).toEqual([])
        expect(await codeOf(intruder.api.accounts.update({ id, name: "Stolen" }))).toBe("NOT_FOUND")
        expect(await codeOf(intruder.api.accounts.update({ id, password: "hijack" }))).toBe("NOT_FOUND")
        await intruder.api.accounts.setDesiredState({ ids: [id], state: "running" })
        await intruder.api.accounts.remove({ ids: [id] })

        const [mine] = await owner.api.accounts.list()
        expect(mine).toMatchObject({ id, name: "Mine", desiredState: "stopped" })
        expect(openSealed(api.keys.privateKey, (await api.accountRows()).find(r => r.id === id)!.passwordSealed)).toBe(GAME_PASSWORD)
    })
})
