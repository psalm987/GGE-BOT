import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { startTowers, standInCommanders, tower, castleAt, melee, ranged, tool } = require("./harness/army-bots.cjs")
const { createBaronCoordinator } = require("../baronCoordinator.js")

const inventory = () => [melee(601, 500_000), ranged(603, 500_000), tool(614, 500_000, { wallBonus: "10" })]
const castlesIn = kingdomID => [castleAt(kingdomID, 1, 600, 600, { name: "Ironhold", inventory: inventory() })]
const MINUTE = 60_000
const run = ms => vi.advanceTimersByTimeAsync(ms)
const targets = game => game.sent.map(cra => [cra.TX, cra.TY])
const reach = game => Math.max(...game.requests.map(([x1, , x2]) => (x2 - x1) / 2))

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-27T12:00:00Z").getTime() }); for (const method of ["warn", "info", "log", "debug", "error"]) vi.spyOn(console, method).mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("a commander two kingdoms may send", () => {
    test("goes to the kingdom whose tower is clearly nearer, even when the farther kingdom asked first", async () => {
        const coordinator = createBaronCoordinator()
        const sharedCommanders = standInCommanders(1)
        const out = await sharedCommanders.waitForCommanderAvailable()
        const far = startTowers({}, { kingdomID: 0, castles: castlesIn(0), map: [tower(640, 600)], coordinator, sharedCommanders, travelSeconds: 600 })
        await run(30_000)
        const near = startTowers({}, { kingdomID: 1, castles: castlesIn(1), map: [tower(605, 600)], coordinator, sharedCommanders, travelSeconds: 600 })
        await run(30_000)
        sharedCommanders.freeCommander(out.lordID)
        await run(10_000)
        expect(targets(near)).toEqual([[605, 600]])
        expect(targets(far)).toEqual([])
    })

    test("comes back to the farther kingdom once the nearer one has nothing to attack", async () => {
        const coordinator = createBaronCoordinator()
        const sharedCommanders = standInCommanders(1)
        const far = startTowers({}, { kingdomID: 0, castles: castlesIn(0), map: [tower(640, 600)], coordinator, sharedCommanders, travelSeconds: 60 })
        const near = startTowers({}, { kingdomID: 1, castles: castlesIn(1), map: [tower(605, 600)], coordinator, sharedCommanders, travelSeconds: 60 })
        await run(10 * MINUTE)
        expect(targets(near)).toEqual([[605, 600]])
        expect(targets(far)).toEqual([[640, 600]])
    })

    test("the kingdom learns its travel speed from the attack the game accepted", async () => {
        const coordinator = createBaronCoordinator()
        startTowers({}, { kingdomID: 1, castles: castlesIn(1), map: [tower(605, 600)], coordinator, travelSeconds: 30 })
        await run(MINUTE)
        expect(coordinator.msPerTile("attackBarronsBurningSands")).toBe(6000)
    })
})

describe("widening the search while commanders wait", () => {
    test("when every kingdom's towers are cooling down for 5 minutes, the kingdom with the smaller search widens a step and attacks a farther tower", async () => {
        const coordinator = createBaronCoordinator()
        const narrow = startTowers({ widenSearch: true, searchRadius: 40 }, {
            kingdomID: 0, castles: castlesIn(0), map: [tower(630, 600), tower(645, 600)], coordinator, travelSeconds: 30, cooldown: 6 * 3600,
        })
        const wide = startTowers({ widenSearch: true, searchRadius: 50 }, {
            kingdomID: 1, castles: castlesIn(1), map: [tower(610, 600), tower(670, 600)], coordinator, travelSeconds: 30, cooldown: 6 * 3600,
        })
        await run(5 * MINUTE)
        expect(targets(narrow)).toEqual([[630, 600]])
        await run(4 * MINUTE)
        expect(targets(narrow)).toEqual([[630, 600], [645, 600]])
        expect(reach(narrow)).toBe(50)
        expect(narrow.statuses.find(status => status.reasonKey == "statusTowersWidenedIdle")).toMatchObject({ state: "waiting", params: { castle: "Ironhold", before: 40, radius: 50 } })
        expect(targets(wide)).toEqual([[610, 600]])
        expect(reach(wide)).toBe(50)
    })

    test("a later scan keeps the widened search, though nearer towers are in range", async () => {
        const coordinator = createBaronCoordinator()
        const game = startTowers({ widenSearch: true, searchRadius: 40 }, {
            kingdomID: 0, castles: castlesIn(0), map: [tower(630, 600), tower(645, 600)], coordinator, commanders: 2, travelSeconds: 25 * 60, cooldown: 6 * 3600,
        })
        await run(9 * MINUTE)
        expect(targets(game)).toEqual([[630, 600], [645, 600]])
        const asked = game.requests.length
        await run(45 * MINUTE)
        expect(game.requests.length).toBeGreaterThan(asked)
        expect(game.requests.slice(asked).map(([x1, , x2]) => (x2 - x1) / 2)).toEqual(Array(game.requests.length - asked).fill(50))
    })

    test("a kingdom with Widen search off keeps its radius", async () => {
        const coordinator = createBaronCoordinator()
        const game = startTowers({ searchRadius: 40 }, {
            kingdomID: 0, castles: castlesIn(0), map: [tower(630, 600), tower(645, 600)], coordinator, travelSeconds: 30, cooldown: 6 * 3600,
        })
        await run(30 * MINUTE)
        expect(targets(game)).toEqual([[630, 600]])
        expect(reach(game)).toBe(40)
    })

    test("a kingdom held by its hourly limit does not widen", async () => {
        const coordinator = createBaronCoordinator()
        const game = startTowers({ widenSearch: true, searchRadius: 40, attacksPerHour: 1 }, {
            kingdomID: 0, castles: castlesIn(0), map: [tower(630, 600), tower(645, 600)], coordinator, travelSeconds: 30, cooldown: 6 * 3600,
        })
        await run(30 * MINUTE)
        expect(targets(game)).toEqual([[630, 600]])
        expect(reach(game)).toBe(40)
    })
})
