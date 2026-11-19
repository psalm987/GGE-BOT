import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { startTowers, tower, castleAt, melee, ranged, tool } = require("./harness/army-bots.cjs")
const { towerLevel, matchesFilter, pickSourceCastle, TOP_LEVELS, BASE_LEVELS } = require("../towers.js")
const { rectsAround } = require("../mapScan.js")

const inventory = () => [melee(601, 50_000), ranged(603, 50_000), tool(614, 50_000, { wallBonus: "10" })]
const MINUTE = 60_000
const run = ms => vi.advanceTimersByTimeAsync(ms)
const targets = game => game.sent.map(cra => [cra.TX, cra.TY])
const last = game => game.statuses.at(-1)

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00Z") }); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("a tower's level", () => {
    test.each([
        ["Great Empire", 0, 1, 81],
        ["Burning Sands", 1, 35, 61],
        ["Everwinter Glacier", 2, 20, 51],
        ["Fire Peaks", 3, 45, 71],
    ])("%s towers start at their base level and stop at the kingdom's top level", (_, kingdom, base, top) => {
        expect(BASE_LEVELS[kingdom]).toBe(base)
        expect(TOP_LEVELS[kingdom]).toBe(top)
        expect(towerLevel(0, kingdom)).toBe(base)
        expect(towerLevel(1, kingdom)).toBe(base + 1)
        const steps = top - base
        // The fewest victories that reach the top level: floor(1.9 · v^0.555) is the levels gained.
        const needed = Array.from({ length: 2000 }, (_, v) => v).find(v => towerLevel(v, kingdom) >= top)
        expect(towerLevel(needed, kingdom)).toBe(top)
        expect(towerLevel(needed - 1, kingdom)).toBe(top - 1)
        expect(Math.floor(1.9 * needed ** .555)).toBe(steps)
        for (let v = 1; v <= needed; v++)
            expect(towerLevel(v, kingdom) - towerLevel(v - 1, kingdom)).toBeGreaterThanOrEqual(0)
    })
    test("the victories that max a tower, by kingdom", () => {
        const needed = kingdom => Array.from({ length: 2000 }, (_, v) => v).find(v => towerLevel(v, kingdom) >= TOP_LEVELS[kingdom])
        expect([0, 1, 2, 3].map(needed)).toEqual([845, 112, 154, 112])
    })
    test("the filters split towers at the top level, with no tower in both or in neither", () => {
        for (const level of [50, 80, 81, 82]) {
            expect(matchesFilter("all", level, 81)).toBe(true)
            expect(matchesFilter("maxed", level, 81)).toBe(level >= 81)
            expect(matchesFilter("notMaxed", level, 81)).toBe(!matchesFilter("maxed", level, 81))
        }
    })
})

describe("the castle the attacks leave from", () => {
    const castles = [castleAt(0, 5, 400, 400, { type: 4 }), castleAt(0, 1, 100, 100), castleAt(2, 9, 300, 300, { type: 12 })]
    const main = [12, 1]
    test("is the picked castle, an outpost included", () => {
        expect(pickSourceCastle(castles, 0, { kingdom: 0, id: 5 }, main)).toEqual({ castle: castles[0], fellBack: false })
    })
    test("is the kingdom's main castle when none is picked", () => {
        expect(pickSourceCastle(castles, 0, null, main)).toEqual({ castle: castles[1], fellBack: false })
        expect(pickSourceCastle(castles, 2, undefined, main).castle).toBe(castles[2])
    })
    test("falls back to the main castle when the picked one is gone, and says so", () => {
        expect(pickSourceCastle(castles, 0, { kingdom: 0, id: 77 }, main)).toEqual({ castle: castles[1], fellBack: true })
    })
    test("is nothing in a kingdom the account holds no castle in", () => {
        expect(pickSourceCastle(castles, 3, null, main).castle).toBeUndefined()
    })
})

test("a search radius above 50 is asked for as four rectangles no wider than the whole-map walk's", () => {
    expect(rectsAround(600, 600, 50)).toEqual([{ x: 550, y: 550, w: 650, h: 650 }])
    const far = rectsAround(600, 600, 100)
    expect(far).toHaveLength(4)
    expect(far.every(rect => rect.w - rect.x <= 100 && rect.h - rect.y <= 100)).toBe(true)
    expect([Math.min(...far.map(r => r.x)), Math.max(...far.map(r => r.w)), Math.min(...far.map(r => r.y)), Math.max(...far.map(r => r.h))]).toEqual([500, 700, 500, 700])
})

describe("which towers a kingdom attacks", () => {
    const green = () => [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: inventory() }), castleAt(0, 2, 300, 300, { type: 4, name: "Watch", inventory: inventory() })]

    test("the picked castle is where the scan centres and the attack leaves from", async () => {
        const game = startTowers({ sourceCastle: { kingdom: 0, id: 2 } }, { castles: green(), map: [tower(310, 305), tower(610, 605)] })
        await run(1000)
        expect(game.requests).toEqual([[250, 250, 350, 350]])
        expect(game.sent).toHaveLength(1)
        expect(game.sent[0]).toMatchObject({ SX: 300, SY: 300, TX: 310, TY: 305 })
        expect(last(game)).toMatchObject({ state: "running", reasonKey: "statusTowersAttacking", params: { castle: "Watch", found: 1 } })
    })

    test("with no castle picked the attacks leave from the main castle", async () => {
        const game = startTowers({}, { castles: green(), map: [tower(310, 305), tower(610, 605)] })
        await run(1000)
        expect(game.sent[0]).toMatchObject({ SX: 600, SY: 600, TX: 610, TY: 605 })
    })

    test("a picked castle the account no longer holds falls back to the main castle with a status", async () => {
        const game = startTowers({ sourceCastle: { kingdom: 0, id: 99 } }, { castles: green(), map: [tower(610, 605)] })
        await run(1000)
        expect(game.statuses[0]).toMatchObject({ state: "waiting", reasonKey: "statusTowersCastleFallback", params: { castle: "Ironhold" } })
        expect(game.sent[0]).toMatchObject({ SX: 600, SY: 600 })
    })

    test("a kingdom with no castle reports that and stops, without an error", async () => {
        const game = startTowers({}, { kingdomID: 3, castles: green(), map: [tower(610, 605)] })
        await run(60 * MINUTE)
        expect(game.stopped).toEqual([])
        expect(game.statuses).toEqual([expect.objectContaining({ state: "stopped", reasonKey: "statusTowersNoCastle" })])
        expect(game.requests).toEqual([])
        expect(game.sent).toEqual([])
    })

    test("the search radius decides how far towers are taken from", async () => {
        const map = () => [tower(620, 600), tower(600, 645), tower(660, 600), tower(600, 699), tower(701, 600)]
        const near = startTowers({ searchRadius: 30 }, { castles: green(), map: map(), commanders: 9 })
        await run(10 * MINUTE)
        expect(near.requests[0]).toEqual([570, 570, 630, 630])
        expect(targets(near)).toEqual([[620, 600]])

        const usual = startTowers({}, { castles: green(), map: map(), commanders: 9 })
        await run(10 * MINUTE)
        expect(targets(usual)).toEqual([[620, 600], [600, 645]])

        const far = startTowers({ searchRadius: 100 }, { castles: green(), map: map(), commanders: 9 })
        await run(10 * MINUTE)
        expect(far.requests.slice(0, 4)).toHaveLength(4)
        expect(targets(far)).toEqual([[620, 600], [600, 645], [660, 600], [600, 699]])
    })

    test("a radius above 100 is cut to 100", async () => {
        const game = startTowers({ searchRadius: 400 }, { castles: green(), map: [tower(600, 700), tower(600, 760)], commanders: 9 })
        await run(10 * MINUTE)
        expect(targets(game)).toEqual([[600, 700]])
    })

    test("with the map grid on, a wider radius looks at more boxes and still stops at 30 towers", async () => {
        const few = startTowers({ searchRadius: 100 }, { castles: green(), map: [tower(690, 600)], mapGrid: true })
        await run(1000)
        expect(few.requests.every(([x1, , x2]) => x2 - x1 == 12)).toBe(true)
        expect(few.requests).toHaveLength(15 * 15)
        expect(targets(few)).toEqual([[690, 600]])

        const many = Array.from({ length: 60 }, (_, i) => tower(600 + (i % 10), 600 + Math.floor(i / 10)))
        const dense = startTowers({ searchRadius: 100 }, { castles: green(), map: many, mapGrid: true, commanders: 99 })
        await run(1000)
        expect(dense.requests.length).toBeLessThan(10)
    })

    test.each([
        ["Maxed only", 1, [[610, 600]]],
        ["Non-maxed only", 2, [[620, 600]]],
        ["All towers", 0, [[610, 600], [620, 600]]],
    ])("%s", async (_, towerFilter, expected) => {
        const game = startTowers({ towerFilter }, { castles: green(), map: [tower(610, 600, { victories: 845 }), tower(620, 600, { victories: 844 })], commanders: 9 })
        await run(10 * MINUTE)
        expect(targets(game)).toEqual(expected)
    })

    test("Maxed only with no maxed tower in range waits with a status, not an error", async () => {
        const game = startTowers({ towerFilter: 1 }, { castles: green(), map: [tower(620, 600, { victories: 3 })] })
        await run(10 * MINUTE)
        expect(game.sent).toEqual([])
        expect(game.stopped).toEqual([])
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersNoneInRange", params: { castle: "Ironhold", radius: 50 } })
    })

    test("Non-maxed only leaves a tower alone once an attack has brought it to the top level", async () => {
        const game = startTowers({ towerFilter: 2 }, { castles: green(), map: [tower(620, 600, { victories: 844 })], cooldown: 60 })
        await run(60 * MINUTE)
        expect(game.sent).toHaveLength(1)
    })
})

describe("looking at the map again", () => {
    const castles = () => [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: inventory() })]

    test("a tower that appears after the start is attacked once the map is read again", async () => {
        const game = startTowers({}, { castles: castles(), map: [tower(610, 600)], cooldown: 6 * 3600 })
        await run(5 * MINUTE)
        expect(targets(game)).toEqual([[610, 600]])
        game.map.push(tower(630, 600))
        await run(20 * MINUTE)
        expect(game.requests).toHaveLength(1)
        await run(25 * MINUTE)
        expect(game.requests).toHaveLength(2)
        expect(targets(game)).toEqual([[610, 600], [630, 600]])
    })

    test("the map is read at most once in 30 minutes, however long nothing is ready", async () => {
        const game = startTowers({}, { castles: castles(), map: [tower(610, 600, { wait: 12 * 3600 })] })
        await run(6 * 60 * MINUTE)
        expect(game.sent).toEqual([])
        expect(game.requests.length).toBeGreaterThanOrEqual(9)
        expect(game.requests.length).toBeLessThanOrEqual(13)
    })

    test("a kingdom with towers ready does not read the map again to find them", async () => {
        const map = Array.from({ length: 20 }, (_, i) => tower(605 + i, 600))
        const game = startTowers({}, { castles: castles(), map, commanders: 1, travelSeconds: 30, cooldown: 60 })
        await run(20 * MINUTE)
        expect(game.sent.length).toBeGreaterThan(10)
        expect(game.requests).toHaveLength(1)
    })

    test("a scan the game doesn't answer is tried again later, not at once", async () => {
        let down = true
        const game = startTowers({}, { castles: castles(), map: [tower(610, 600)], scanFails: () => down })
        await run(10 * MINUTE)
        expect(game.requests.length).toBeGreaterThanOrEqual(5)
        expect(game.requests.length).toBeLessThanOrEqual(14)
        expect(game.stopped).toEqual([])
        down = false
        await run(3 * MINUTE)
        expect(targets(game)).toEqual([[610, 600]])
    })
})

describe("waiting for a tower", () => {
    const castles = () => [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: inventory() })]

    test("with time skips on and none to spend, the plugin waits for the tower instead of spinning", async () => {
        const game = startTowers({ useTimeSkips: true, upgradeTowers: true }, { castles: castles(), map: [tower(610, 600, { wait: 1800 })], commanders: 1 })
        let asked = 0
        const clock = Date.now
        vi.spyOn(Date, "now").mockImplementation(() => { asked++; return clock() })
        await run(20 * MINUTE)
        expect(game.sent).toEqual([])
        // One look a minute at most: a spinning loop reads the clock thousands of times a second.
        expect(asked).toBeLessThan(400)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersCooling", params: { castle: "Ironhold", found: 1 } })
        expect(last(game).params.minutes).toBeLessThanOrEqual(30)
        await run(12 * MINUTE)
        expect(targets(game)).toEqual([[610, 600]])
    })

    test("the status says when the next tower is ready, and that every tower has a march on it", async () => {
        const game = startTowers({}, { castles: castles(), map: [tower(610, 600)], commanders: 2, travelSeconds: 600, cooldown: 3600 })
        await run(1 * MINUTE)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersAllOut", params: { castle: "Ironhold", found: 1 } })
        await run(11 * MINUTE)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersCooling" })
        expect(last(game).params.minutes).toBeGreaterThan(50)
        expect(game.sent).toHaveLength(1)
    })

    test("a tower is attacked again when its wait from the march home is over, not before", async () => {
        const game = startTowers({}, { castles: castles(), map: [tower(610, 600)], commanders: 2, travelSeconds: 60, cooldown: 1200 })
        await run(15 * MINUTE)
        expect(game.sent).toHaveLength(1)
        await run(10 * MINUTE)
        expect(game.sent).toHaveLength(2)
    })

    test("a castle short of troops is looked at again without a march coming home", async () => {
        const home = [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: [melee(601, 10)] })]
        const game = startTowers({}, { castles: home, map: [tower(610, 600)] })
        await run(2 * MINUTE)
        expect(last(game)).toMatchObject({ state: "waiting", reasonKey: "statusTowersNoTroops", params: { castle: "Ironhold" } })
        home[0].unitInventory.push(melee(602, 5000))
        await run(10 * MINUTE)
        expect(game.sent).toHaveLength(1)
    })
})
