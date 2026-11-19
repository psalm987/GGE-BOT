import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { startTowers, tower, castleAt, melee, ranged, tool } = require("./harness/army-bots.cjs")
const { RollingWindow, DAY, HOUR, toolsIn, horseByDistance } = require("../towers.js")
const { readTowerAttack, towerAttackLine } = require("../attackLog.js")

const LADDER = 614, MANTLET = 615, RAM = 611
const inventory = (extra = []) => [melee(601, 500_000), ranged(603, 500_000), tool(LADDER, 500_000, { wallBonus: "10" }), ...extra]
const castles = (stock = inventory()) => [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: stock })]
/** Twenty towers in a row east of the castle, 5 to 24 tiles away, at level 46. */
const row = () => Array.from({ length: 20 }, (_, i) => tower(605 + i, 600, { victories: 300 }))
const MINUTE = 60_000
const run = ms => vi.advanceTimersByTimeAsync(ms)
const last = game => game.statuses.at(-1)
const START = new Date("2026-11-18T12:00:00Z").getTime()

beforeEach(() => { vi.useFakeTimers({ now: START }); for (const method of ["warn", "info", "log", "debug"]) vi.spyOn(console, method).mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("a rolling window", () => {
    test("counts what was added in its span and says when there is room again", () => {
        const window = new RollingWindow(HOUR)
        window.add(0)
        window.add(10 * MINUTE)
        window.add(20 * MINUTE, 3)
        expect(window.total(30 * MINUTE)).toBe(5)
        expect(window.roomAt(30 * MINUTE, 6)).toBe(30 * MINUTE)
        expect(window.roomAt(30 * MINUTE, 5)).toBe(HOUR)
        expect(window.roomAt(30 * MINUTE, 5, 2)).toBe(HOUR + 10 * MINUTE)
        expect(window.roomAt(30 * MINUTE, 4, 3)).toBe(HOUR + 20 * MINUTE)
        expect(window.roomAt(30 * MINUTE, 2, 3)).toBe(Infinity)
        expect(window.total(HOUR + 10 * MINUTE)).toBe(3)
    })
})

describe("a kingdom's own limits", () => {
    test("Most attacks a day stops the kingdom at its cap and lets attacks go again as the 24 hours roll on", async () => {
        const game = startTowers({ maxPerDay: 3 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(6 * 60 * MINUTE)
        expect(game.sent).toHaveLength(3)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersLimitDay", params: { cap: 3 } })
        await run(17 * 60 * MINUTE + 50 * MINUTE)
        expect(game.sent).toHaveLength(3)
        await run(30 * MINUTE)
        expect(game.sent).toHaveLength(6)
    })

    test("0 leaves the kingdom to the account's cap alone", async () => {
        const game = startTowers({ maxPerDay: 0 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(30 * MINUTE)
        expect(game.sent.length).toBeGreaterThan(20)
    })

    test("Attacks an hour holds the kingdom to that many in any hour", async () => {
        const game = startTowers({ attacksPerHour: 2 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(50 * MINUTE)
        expect(game.sent).toHaveLength(2)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersLimitHour", params: { cap: 2 } })
        await run(60 * MINUTE)
        expect(game.sent).toHaveLength(4)
    })

    test("the strictest limit wins, and the status names the one in force", async () => {
        const game = startTowers({ maxPerDay: 5, attacksPerHour: 2 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(30 * MINUTE)
        expect(game.sent).toHaveLength(2)
        expect(last(game).reasonKey).toBe("statusTowersLimitHour")
        await run(3 * 60 * MINUTE)
        expect(game.sent).toHaveLength(5)
        expect(last(game)).toMatchObject({ reasonKey: "statusTowersLimitDay", params: { cap: 5 } })
        await run(12 * 60 * MINUTE)
        expect(game.sent).toHaveLength(5)
    })

    test("a running kingdom's status carries its attacks and tools of the last 24 hours against their caps", async () => {
        const game = startTowers({ maxPerDay: 40, toolBudgetPerDay: 900 }, { castles: castles(), map: row().slice(0, 2), commanders: 9, travelSeconds: 600, cooldown: 3600 })
        await run(MINUTE)
        expect(game.sent).toHaveLength(2)
        expect(last(game)).toMatchObject({ reasonKey: "statusTowersAllOut", params: { castle: "Ironhold", found: 2, attacks: "2/40", tools: "60/900" } })
    })
})

describe("the tool budget", () => {
    test("counts the tools put into attacks and keeps attacks with tools home once it is used", async () => {
        const game = startTowers({ toolBudgetPerDay: 60, attackLeft: true, attackMiddle: true, attackRight: true }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(60 * MINUTE)
        expect(game.sent.map(toolsIn)).toEqual([30, 30])
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersLimitTools", params: { cap: 60, used: 60 } })
        await run(24 * 60 * MINUTE)
        expect(game.sent.map(toolsIn)).toEqual([30, 30, 30, 30])
    })

    test("an attack that would take the day over the budget is not sent, and the castle's tools are not taken", async () => {
        const home = castles()
        const game = startTowers({ toolBudgetPerDay: 50 }, { castles: home, map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(60 * MINUTE)
        expect(game.sent.map(toolsIn)).toEqual([30])
        expect(home[0].unitInventory.find(unit => unit.unitInfo.wodID == LADDER).amount).toBe(500_000 - 30)
        expect(last(game)).toMatchObject({ reasonKey: "statusTowersLimitTools", params: { cap: 50, used: 30 } })
    })

    test("a budget smaller than one attack's tools says so instead of waiting for a day that never comes", async () => {
        const game = startTowers({ toolBudgetPerDay: 20 }, { castles: castles(), map: row(), commanders: 9 })
        await run(60 * MINUTE)
        expect(game.sent).toEqual([])
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersToolsOverBudget", params: { cap: 20 } })
    })

    test("with Tools on No tools the budget stops nothing", async () => {
        const game = startTowers({ toolBudgetPerDay: 20, tools: 0, maxPerDay: 4 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        await run(60 * MINUTE)
        expect(game.sent.map(toolsIn)).toEqual([0, 0, 0, 0])
    })
})

describe("the account's limits", () => {
    test("the account's daily cap stops every kingdom, and the status names it", async () => {
        const game = startTowers({}, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        game.bot.xtHandler.emit("gai", { AC: 3500, ACTH: 9999 }, 0)
        await run(60 * MINUTE)
        expect(game.sent.length).toBeLessThanOrEqual(1)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersLimitAccount", params: { cap: 3500 } })
    })

    test.each([
        ["a limit above the game's 4,000 is cut to 4,000", "9000", 99_999, 3999, 4000],
        ["the game's own threshold wins when it is lower", "3500", 1200, 1199, 1200],
        ["the player's limit wins when it is lower", "500", 9999, 499, 500],
    ])("%s", async (_, attackLimit, ACTH, under, cap) => {
        const open = startTowers({}, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60, attackOptions: { attackLimit } })
        open.bot.xtHandler.emit("gai", { AC: under, ACTH }, 0)
        await run(5 * MINUTE)
        expect(open.sent.length).toBeGreaterThan(0)

        const shut = startTowers({}, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60, attackOptions: { attackLimit } })
        shut.bot.xtHandler.emit("gai", { AC: cap, ACTH }, 0)
        await run(5 * MINUTE)
        expect(shut.sent.length).toBeLessThanOrEqual(1)
        expect(last(shut)).toMatchObject({ reasonKey: "statusTowersLimitAccount", params: { cap } })
    })

    test("a kingdom cap under the account's cap still wins", async () => {
        const game = startTowers({ maxPerDay: 2 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60 })
        game.bot.xtHandler.emit("gai", { AC: 10, ACTH: 9999 }, 0)
        await run(60 * MINUTE)
        expect(game.sent).toHaveLength(2)
        expect(last(game).reasonKey).toBe("statusTowersLimitDay")
    })
})

describe("the last 24 hours across a restart", () => {
    test("the line a kingdom logs for an attack reads back as that kingdom's attack and its tools", async () => {
        const game = startTowers({}, { castles: castles(), map: row().slice(0, 1), commanders: 1 })
        await run(MINUTE)
        const lines = game.logged.map(readTowerAttack).filter(Boolean)
        expect(lines).toEqual([{ plugin: "attackBarronsGreatEmpire", tools: 30 }])
    })

    test("other lines, and other scripts' attack lines, are not tower attacks", () => {
        const head = ["[12:00] ", "[", "sharedBarronAttackLogic", "] "]
        expect(readTowerAttack([...head, ...towerAttackLine("firePeaks", 3, 610, 600, "4m", 0)])).toEqual({ plugin: "attackBarronsFirePeaks", tools: 0 })
        expect(readTowerAttack([...head, "hittingTargetAttack", "burningSands", " ", "C", 3, " ", 610, ":", 600, " ", "4m", "tillImpactAttack"])).toEqual({ plugin: "attackBarronsBurningSands", tools: 0 })
        expect(readTowerAttack([...head, "waitingForMoreTroops"])).toBeNull()
        expect(readTowerAttack(["[12:00] ", "[", "sharedFortressAttackLogic", "] ", "hittingTargetAttack", "firePeaks"])).toBeNull()
        expect(readTowerAttack(null)).toBeNull()
    })

    test("a bot that starts with its cap already used in the last 24 hours sends nothing until an attack rolls off", async () => {
        const history = [{ at: START - 23 * 60 * MINUTE, tools: 30 }, { at: START - 2 * 60 * MINUTE, tools: 30 }, { at: START - 10 * MINUTE, tools: 30 }]
        const game = startTowers({ maxPerDay: 3 }, { castles: castles(), map: row(), commanders: 9, travelSeconds: 30, cooldown: 60, history })
        await run(50 * MINUTE)
        expect(game.sent).toEqual([])
        expect(last(game)).toMatchObject({ reasonKey: "statusTowersLimitDay", params: { cap: 3 } })
        await run(20 * MINUTE)
        expect(game.sent).toHaveLength(1)
    })

    const history = () => [{ at: START - 5 * 60 * MINUTE, tools: 60 }, { at: START - 20 * MINUTE, tools: 0 }]
    test("the tools of the last 24 hours count against the budget too", async () => {
        const tools = startTowers({ toolBudgetPerDay: 80 }, { castles: castles(), map: row(), commanders: 9, history: history() })
        await run(30 * MINUTE)
        expect(tools.sent).toEqual([])
        expect(last(tools)).toMatchObject({ reasonKey: "statusTowersLimitTools", params: { cap: 80, used: 60 } })
    })
    test("and the last hour against the hourly limit", async () => {
        const hourly = startTowers({ attacksPerHour: 1 }, { castles: castles(), map: row(), commanders: 9, history: history() })
        await run(30 * MINUTE)
        expect(hourly.sent).toEqual([])
        await run(15 * MINUTE)
        expect(hourly.sent).toHaveLength(1)
    })
})

describe("the horse", () => {
    const COIN_HORSE = 2
    const map = () => [tower(610, 600, { victories: 300 }), tower(640, 600, { victories: 300 })]
    const rides = game => game.sent.map(cra => [cra.TX, cra.HBW, cra.PTT])

    test("By distance rides the coin horse to a near tower and spends a feather on a far one", async () => {
        const game = startTowers({ horse: 3 }, { castles: castles(), map: map(), commanders: 9 })
        await run(MINUTE)
        expect(rides(game)).toEqual([[610, COIN_HORSE, 0], [640, -1, 1]])
        expect(game.statuses.some(status => status.reasonKey == "statusTowersAttackingNoFeathers")).toBe(false)
    })

    test("the distance is the player's to set", async () => {
        const game = startTowers({ horse: 3, horseDistance: 5 }, { castles: castles(), map: map(), commanders: 9 })
        await run(MINUTE)
        expect(rides(game)).toEqual([[610, -1, 1], [640, -1, 1]])
        const wide = startTowers({ horse: 3, horseDistance: 40 }, { castles: castles(), map: map(), commanders: 9 })
        await run(MINUTE)
        expect(rides(wide)).toEqual([[610, COIN_HORSE, 0], [640, COIN_HORSE, 0]])
    })

    test("with no feathers left a far tower gets the coin horse, and the status says so", async () => {
        const game = startTowers({ horse: 3 }, { castles: castles(), map: map(), commanders: 2, resources: { pegasusTicket: 0 }, travelSeconds: 600 })
        await run(30_000)
        expect(rides(game)).toEqual([[610, COIN_HORSE, 0], [640, COIN_HORSE, 0]])
        expect(game.statuses.some(status => status.reasonKey == "statusTowersAttackingNoFeathers")).toBe(true)
    })

    test("with no feathers and no coin horse in the stable the troops walk", async () => {
        const home = castles()
        home[0].unlockedHorses = []
        const game = startTowers({ horse: 3 }, { castles: home, map: map(), commanders: 9, resources: { pegasusTicket: 0 } })
        await run(MINUTE)
        expect(rides(game)).toEqual([[610, -1, 0], [640, -1, 0]])
    })

    test("the fixed choices ride what they always rode", async () => {
        for (const [horse, ride] of [[0, [-1, 0]], [1, [COIN_HORSE, 0]], [2, [-1, 1]]]) {
            const game = startTowers({ horse }, { castles: castles(), map: map().slice(1), commanders: 1 })
            await run(MINUTE)
            expect(rides(game)).toEqual([[640, ...ride]])
        }
    })

    test("the horse for a distance", () => {
        expect(horseByDistance(15, 15, 3)).toEqual({ horse: "coin", fellBack: false })
        expect(horseByDistance(15.1, 15, 3)).toEqual({ horse: "feather", fellBack: false })
        expect(horseByDistance(40, 15, 0)).toEqual({ horse: "coin", fellBack: true })
    })
})

describe("minimum troops", () => {
    const few = () => [melee(601, 200), ranged(603, 200), tool(LADDER, 500, { wallBonus: "10" })]
    test("the bot waits while the castle holds fewer attack troops than the minimum", async () => {
        const game = startTowers({ minTroops: 500 }, { castles: castles(few()), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(game.sent).toEqual([])
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersNoTroops" })
    })
    test("and attacks once it holds that many", async () => {
        const game = startTowers({ minTroops: 400 }, { castles: castles(few()), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(game.sent).toHaveLength(1)
    })
    test("a minimum under 80 never lowers the floor of 80", async () => {
        const game = startTowers({ minTroops: 5 }, { castles: castles([melee(601, 60)]), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(game.sent).toEqual([])
    })
})

describe("the tools of the first wave", () => {
    const stocked = () => inventory([tool(MANTLET, 5000, { defRangeBonus: "10" }), tool(RAM, 5000, { gateBonus: "10", slotTypes: "1,9" })])
    const front = cra => cra.A[0].M.T.map(([item]) => item)
    const flanks = cra => [...cra.A[0].L.T, ...cra.A[0].R.T].map(([item]) => item)
    const sides = { attackLeft: true, attackMiddle: true, attackRight: true }

    test("Ladders, rams and mantlets puts rams on the front and shields on the flanks", async () => {
        const game = startTowers({ tools: 2, ...sides }, { castles: castles(stocked()), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(front(game.sent[0])).toEqual([LADDER, RAM, MANTLET])
        expect(flanks(game.sent[0])).toEqual([LADDER, MANTLET, LADDER, MANTLET])
    })
    test("Ladders only sends no rams and no shields", async () => {
        const game = startTowers({ tools: 1, ...sides }, { castles: castles(stocked()), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(front(game.sent[0])).toEqual([LADDER, -1, -1])
        expect(flanks(game.sent[0])).toEqual([LADDER, -1, LADDER, -1])
    })
    test("a castle with no rams fills the front's second slot with shields, as before", async () => {
        const game = startTowers({ tools: 2, ...sides }, { castles: castles(inventory([tool(MANTLET, 5000, { defRangeBonus: "10" })])), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(front(game.sent[0])).toEqual([LADDER, MANTLET, -1])
    })
    test("a long wait's status is rewritten every half hour, not every minute", async () => {
        const game = startTowers({ maxPerDay: 1 }, { castles: castles(), map: row(), commanders: 9 })
        await run(10 * 60 * MINUTE)
        expect(game.statuses.filter(status => status.reasonKey == "statusTowersLimitDay").length).toBeLessThanOrEqual(22)
    })
    test("No tools sends none", async () => {
        const game = startTowers({ tools: 0, ...sides }, { castles: castles(stocked()), map: row().slice(0, 1) })
        await run(MINUTE)
        expect(toolsIn(game.sent[0])).toBe(0)
    })
})
