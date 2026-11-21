import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { startTowers, fortress, tower, castleAt, melee, ranged, tool } = require("./harness/army-bots.cjs")

const inventory = () => [melee(601, 500_000), ranged(603, 500_000), tool(614, 500_000, { wallBonus: "10" })]
const castles = () => [castleAt(0, 1, 600, 600, { name: "Ironhold", inventory: inventory() })]
const row = () => Array.from({ length: 6 }, (_, i) => tower(605 + i, 600, { victories: 300 }))
/** The commander position a `cra` went out with: the pool's lord ids run from 101 at position 1. */
const position = cra => cra.LID - 100

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00Z") }); for (const method of ["warn", "info", "log", "debug"]) vi.spyOn(console, method).mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("the commanders an attack goes out with", () => {
    test("Towers sends them in the order the list names them", async () => {
        const game = startTowers({ commanderWhiteList: "36;2;5" }, { castles: castles(), map: row(), commanders: 40, pool: true })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(game.sent.map(position)).toEqual([36, 2, 5])
    })
    test("Towers reads an old range in its own order, lowest first", async () => {
        const game = startTowers({ commanderWhiteList: "4-6" }, { castles: castles(), map: row(), commanders: 9, pool: true })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(game.sent.map(position)).toEqual([4, 5, 6])
    })
    test("Fortress sends the first one the list names", async () => {
        vi.useRealTimers()
        const { cra } = await fortress({ commanderWhiteList: "3;1" }, { inventory: inventory(), commanders: 4 })
        expect(position(cra)).toBe(3)
    })
})
