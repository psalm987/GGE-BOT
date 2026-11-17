import { describe, expect, test } from "vitest"
import { commanderPositions, runChecks, type CheckInput, type PluginStates } from "../src/index.ts"

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
