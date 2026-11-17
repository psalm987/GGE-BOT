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

    test("a refused setting says what was wrong, in a code and params and in English", async () => {
        const p = await api.player()
        const error = await p.api.accounts.create({ ...newAccount(), plugins: { attackNomads: { enabled: true, options: { eventDifficulty: "9" } } } }).catch((e: unknown) => e)
        expect(error).toMatchObject({
            code: "BAD_REQUEST",
            message: "attackNomads.eventDifficulty must be one of 0..2",
            data: { code: "PLUGIN_OPTION_CHOICE", params: { where: "attackNomads.eventDifficulty", last: 2 } },
        })
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

describe("run schedules", () => {
    const HOUR = 3600_000
    const hhmm = (at: number) => new Date(at).toISOString().slice(11, 16)
    /** A daily UTC window from `fromHours` to `toHours` hours from now. */
    const window = (fromHours: number, toHours: number) =>
        ({ tz: "UTC", jitterMinutes: 0, windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: hhmm(Date.now() + fromHours * HOUR), end: hhmm(Date.now() + toHours * HOUR) }] })
    const berlin = { tz: "Europe/Berlin", jitterMinutes: 12, windows: [{ days: [1, 3], start: "22:00", end: "02:30" }, { days: [6], start: "08:00", end: "12:00" }] }

    test("create and update round-trip a schedule, and null removes it", async () => {
        const p = await api.player()
        const created = await p.api.accounts.create({ ...newAccount(), schedule: berlin })
        expect(created.schedule).toEqual(berlin)
        expect((await p.api.accounts.list())[0]!.schedule).toEqual(berlin)

        const later = window(2, 3)
        expect((await p.api.accounts.update({ id: created.id, schedule: later })).schedule).toEqual(later)
        expect((await p.api.accounts.update({ id: created.id, serverId: 27 })).schedule).toEqual(later)
        expect((await p.api.accounts.update({ id: created.id, schedule: null })).schedule).toBeNull()
    })

    test.each([
        ["an unknown time zone", { ...berlin, tz: "Mars/Olympus" }, "Unknown time zone"],
        ["a window that starts and ends at the same time", { ...berlin, windows: [{ days: [1], start: "08:00", end: "08:00" }] }, "A window can't start and end at the same time"],
        ["a window with no days", { ...berlin, windows: [{ days: [], start: "08:00", end: "09:00" }] }, "Pick at least one day"],
        ["no windows", { ...berlin, windows: [] }, "Add at least one window"],
    ])("refuses %s and says why", async (_, schedule, message) => {
        const p = await api.player()
        const { id } = await p.api.accounts.create(newAccount())
        const issues = (error: { data?: { issues?: { message: string }[] } }) => ({ code: (error as { code?: string }).code, messages: error.data?.issues?.map(i => i.message) })

        expect(await p.api.accounts.update({ id, schedule }).then(() => "ok", issues)).toEqual({ code: "BAD_REQUEST", messages: [message] })
        expect(await p.api.accounts.create({ ...newAccount(), schedule }).then(() => "ok", issues)).toEqual({ code: "BAD_REQUEST", messages: [message] })
        expect((await p.api.accounts.list()).map(a => a.schedule)).toEqual([null])
    })

    test("a wanted account outside its window is sleeping until the window's next start", async () => {
        const p = await api.player()
        const schedule = window(2, 3)
        const { id } = await p.api.accounts.create({ ...newAccount(), schedule })
        expect((await p.api.accounts.list())[0]!.sleepingUntil).toBeNull()

        await p.api.accounts.setDesiredState({ ids: [id], state: "running" })
        const { sleepingUntil } = (await p.api.accounts.list())[0]!
        const startsIn = sleepingUntil!.getTime() - Date.now()
        expect(startsIn).toBeGreaterThan(1.9 * HOUR)
        expect(startsIn).toBeLessThanOrEqual(2 * HOUR)
        expect(hhmm(sleepingUntil!.getTime())).toBe(schedule.windows[0]!.start)

        await p.api.accounts.setDesiredState({ ids: [id], state: "stopped" })
        expect((await p.api.accounts.list())[0]!.sleepingUntil).toBeNull()
    })

    test("an account inside its window, or without a schedule, isn't sleeping", async () => {
        const p = await api.player()
        const inside = await p.api.accounts.create({ ...newAccount(), schedule: window(-1, 1) })
        await p.api.accounts.setDesiredState({ ids: [inside.id], state: "running" })
        expect((await p.api.accounts.list())[0]!.sleepingUntil).toBeNull()

        await p.api.accounts.update({ id: inside.id, schedule: window(2, 3) })
        expect((await p.api.accounts.list())[0]!.sleepingUntil).not.toBeNull()
        await p.api.accounts.update({ id: inside.id, schedule: null })
        expect((await p.api.accounts.list())[0]!.sleepingUntil).toBeNull()
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
