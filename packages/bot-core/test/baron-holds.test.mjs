import { createRequire } from "node:module"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { startTowers, tower, castleAt, melee, ranged, tool } = require("./harness/army-bots.cjs")

const inventory = () => [melee(601, 500_000), ranged(603, 500_000), tool(614, 500_000, { wallBonus: "10" })]
const castles = () => [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: inventory() })]
const MINUTE = 60_000
const run = ms => vi.advanceTimersByTimeAsync(ms)
const targets = game => game.sent.map(cra => [cra.TX, cra.TY])

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00Z").getTime() }); for (const method of ["warn", "info", "log", "debug", "error"]) vi.spyOn(console, method).mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test("a tower the game refuses as cooling down is held for 5 minutes while the plugin attacks the next", async () => {
    let refuse = true
    const game = startTowers({ commanderWhiteList: "1-99" }, {
        castles: castles(), map: [tower(605, 600), tower(610, 600)], commanders: 3, travelSeconds: 3600,
        sendResult: cra => refuse && cra.TX == 605 ? (refuse = false, "COOLING_DOWN") : undefined,
    })
    await run(MINUTE)
    expect(targets(game)).toEqual([[610, 600]])
    await run(3 * MINUTE)
    expect(targets(game)).toEqual([[610, 600]])
    await run(3 * MINUTE)
    expect(targets(game)).toEqual([[610, 600], [605, 600]])
})

test("a refused attack screen holds the tower too", async () => {
    const game = startTowers({ commanderWhiteList: "1-99" }, {
        castles: castles(), map: [tower(605, 600), tower(610, 600)], commanders: 3, travelSeconds: 3600, screenRefusal: area => area.x == 605,
    })
    await run(MINUTE)
    expect(targets(game)).toEqual([[610, 600]])
    expect(game.screens.filter(([x]) => x == 605)).toHaveLength(1)
    await run(3 * MINUTE)
    expect(game.screens.filter(([x]) => x == 605)).toHaveLength(1)
})

test("a tower whose map data is over 2 minutes old is looked at again before its attack", async () => {
    const game = startTowers({ commanderWhiteList: "1-99" }, { castles: castles(), map: [tower(605, 600)], commanders: 1, travelSeconds: 30, cooldown: 300 })
    await run(MINUTE)
    expect(game.looks).toEqual([])
    await run(15 * MINUTE)
    expect(game.sent.length).toBeGreaterThan(1)
    expect(game.looks.length).toBeGreaterThan(0)
})

test("the plugin keeps its own record of a tower's wait after its hit, whatever a later map packet says", async () => {
    const game = startTowers({ commanderWhiteList: "1-99" }, { castles: castles(), map: [tower(605, 600)], commanders: 2, travelSeconds: 30, cooldown: 3600 })
    await run(2 * MINUTE)
    expect(game.sent).toHaveLength(1)
    // A later map look, past the 30 to 40 minute rescan, shows the tower ready, which the bot would otherwise trust.
    game.map[0].extraData[2] = 0
    await run(45 * MINUTE)
    expect(game.sent).toHaveLength(1)
    await run(20 * MINUTE)
    expect(game.sent).toHaveLength(2)
})

test.each(["CANT_START_NEW_ARMIES", "NOT_ENOUGH_CURRENCY1"])("%s does not stop the plugin", async refusal => {
    let refuse = true
    const game = startTowers({ commanderWhiteList: "1-99" }, {
        castles: castles(), map: [tower(605, 600)], commanders: 2, travelSeconds: 30,
        sendResult: () => refuse ? (refuse = false, refusal) : undefined,
    })
    await run(15 * MINUTE)
    expect(game.stopped).toEqual([])
    expect(game.sent.length).toBeGreaterThan(0)
})
