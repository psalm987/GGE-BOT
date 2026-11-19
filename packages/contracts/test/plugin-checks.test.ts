import { describe, expect, test } from "vitest"
import { commanderPositions, commanderUsage, readCommanderList, runChecks, type CheckInput, type PluginStates } from "../src/index.ts"

const input = (options: CheckInput["options"], pluginStates: PluginStates = {}, attackLimit = "3500"): CheckInput =>
    ({ options, plugins: { attack: { attackLimit } }, pluginStates })

describe("the commander check", () => {
    const check = [{ type: "commanders" as const, option: "commanderWhiteList" }]

    test("counts the commanders a list picks", () => {
        expect(runChecks(check, input({ commanderWhiteList: "1-5, 9" }))).toEqual([{ level: "ok", key: "commandersSome", params: { count: 6 } }])
    })

    test("warns when the list is empty, so every commander can be sent", () => {
        expect(runChecks(check, input({ commanderWhiteList: " " }))[0]).toMatchObject({ level: "warn", key: "commandersAll" })
        expect(runChecks(check, input({}))[0]).toMatchObject({ level: "warn", key: "commandersAll" })
    })

    test("warns when the list picks nobody", () => {
        expect(runChecks(check, input({ commanderWhiteList: "abc, 9-3" }))).toEqual([{ level: "warn", key: "commandersNone", params: { list: "abc, 9-3" } }])
    })

    test("reads a list the way the commander pool does", () => {
        expect([...commanderPositions("3-5,1")]).toEqual([3, 4, 5, 1])
        expect(commanderPositions("1-1000000").size).toBe(500)
    })
})

describe("the daily attack check", () => {
    const check = [{ type: "dailyAttacks" as const }]
    const reported = (used: number, limit: number): PluginStates => ({ attack: { state: "running", reasonKey: "attacksToday", params: { used, limit } } })

    test("shows the configured limit while the bot hasn't reported usage", () => {
        expect(runChecks(check, input({}))).toEqual([{ level: "info", key: "dailyAttacksLimit", params: { limit: 3500 } }])
        expect(runChecks(check, input({}, {}, ""))[0]).toMatchObject({ level: "info", key: "dailyAttacksUnknown" })
    })

    test("is fine with room left, warns under a tenth left, and warns at the limit", () => {
        expect(runChecks(check, input({}, reported(1240, 3500)))).toEqual([{ level: "ok", key: "dailyAttacksUsed", params: { used: 1240, limit: 3500 } }])
        expect(runChecks(check, input({}, reported(3200, 3500)))[0]).toMatchObject({ level: "warn", key: "dailyAttacksUsed" })
        expect(runChecks(check, input({}, reported(3500, 3500)))[0]).toMatchObject({ level: "warn", key: "dailyAttacksReached" })
    })
})

describe("the rows check", () => {
    const check = [{ type: "rows" as const, options: ["targets", "castleTargets"] }]

    test("counts the rows in every list it names", () => {
        expect(runChecks(check, input({ targets: [{ tool: 614, stock: 10 }], castleTargets: [{ tool: 611, stock: 5 }, { tool: 614, stock: 5 }] }))).toEqual([{ level: "ok", key: "rowsSome", params: { count: 3 } }])
    })

    test("warns when every list is empty or unset", () => {
        expect(runChecks(check, input({ targets: [], castleTargets: [] }))[0]).toMatchObject({ level: "warn", key: "rowsNone" })
        expect(runChecks(check, input({}))[0]).toMatchObject({ level: "warn", key: "rowsNone" })
    })
})

describe("a commander list", () => {
    test("takes semicolons as well as commas, and ranges with either", () => {
        expect([...commanderPositions("1;2;3")]).toEqual([1, 2, 3])
        expect([...commanderPositions("1-3; 7, 9")]).toEqual([1, 2, 3, 7, 9])
        expect([...commanderPositions("1;;2,")]).toEqual([1, 2])
    })
    test("names the positions written out and the first of each range", () => {
        expect(readCommanderList("1-99; 19, 4-6").named).toEqual([1, 19, 4])
        expect(readCommanderList("abc; 9-3").named).toEqual([])
    })
})

describe("the commander check, once the bot has counted the account's commanders", () => {
    const check = [{ type: "commanders" as const, option: "commanderWhiteList" }]
    const counted = (list: string, commanders: number | null) => runChecks(check, { ...input({ commanderWhiteList: list }), commanders })[0]

    test("a position past the last commander is named", () => {
        expect(counted("1;2;19", 18)).toEqual({ level: "warn", key: "commandersOver", params: { position: 19, total: 18 } })
        expect(counted("20-25", 18)).toEqual({ level: "warn", key: "commandersOver", params: { position: 20, total: 18 } })
    })
    test("a range that runs past the last commander is every commander up to the last, not a mistake", () => {
        expect(counted("1-99", 18)).toEqual({ level: "ok", key: "commandersOf", params: { count: 18, max: 18, remaining: 0 } })
        expect(counted("1;2;3", 18)).toEqual({ level: "ok", key: "commandersOf", params: { count: 3, max: 18, remaining: 15 } })
    })
    test("the maximum is the game's 50 at most", () => {
        expect(counted("1-99", 64)).toEqual({ level: "ok", key: "commandersOf", params: { count: 50, max: 50, remaining: 0 } })
        expect(counted("51", 64)).toMatchObject({ key: "commandersOver", params: { position: 51, total: 50 } })
    })
    test("before the bot has counted, the list is only counted", () => {
        expect(counted("1;2;19", null)).toEqual({ level: "ok", key: "commandersSome", params: { count: 3 } })
    })
})

describe("kingdoms that share commanders", () => {
    const check = [{ type: "commandersShared" as const, option: "commanderWhiteList", plugins: ["green", "sands", "ice"] }]
    const run = (lists: Record<string, string>, enabled: Record<string, boolean>, commanders: number | null = 18) => runChecks(check, {
        options: { commanderWhiteList: lists.green }, pluginStates: {}, plugin: "green", enabled, commanders,
        plugins: Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, { commanderWhiteList: list }])),
    })[0]

    test("warns, with how many, when another kingdom that is on lists the same commanders", () => {
        expect(run({ green: "1-6", sands: "5;6;7", ice: "10" }, { green: true, sands: true, ice: true })).toEqual({ level: "warn", key: "commandersShared", params: { count: 2 } })
    })
    test("a kingdom that is off shares nothing", () => {
        expect(run({ green: "1-6", sands: "5;6;7", ice: "10" }, { green: true, sands: false, ice: true })).toEqual({ level: "ok", key: "commandersApart", params: {} })
    })
    test("lists with no commander in common are apart", () => {
        expect(run({ green: "1-6", sands: "7-12", ice: "13-18" }, { green: true, sands: true, ice: true })).toMatchObject({ level: "ok", key: "commandersApart" })
    })
    test("the default list is every commander, so two kingdoms on it share them all", () => {
        expect(run({ green: "1-99", sands: "1-99", ice: "" }, { green: true, sands: true, ice: false })).toMatchObject({ level: "warn", key: "commandersShared", params: { count: 18 } })
    })
})

describe("how the kingdoms use the account's commanders between them", () => {
    test("counts each commander once, against the account's count", () => {
        expect(commanderUsage(["1-6", "5;6;7"], 18)).toEqual({ configured: 7, max: 18, remaining: 11 })
        expect(commanderUsage(["1-99"], 18)).toEqual({ configured: 18, max: 18, remaining: 0 })
        expect(commanderUsage([], 18)).toEqual({ configured: 0, max: 18, remaining: 18 })
    })
    test("has no maximum until the bot has counted", () => {
        expect(commanderUsage(["1;2;3"], null)).toEqual({ configured: 3, max: null, remaining: null })
    })
})
