import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { emptyCustomWave, emptyPlan } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { startTowers, tower, castleAt, melee, ranged, tool } = require("./harness/army-bots.cjs")
const { baronOptions } = require("../plugins/attack/sharedBarronAttackLogic.js")

const LADDER = 614, RAM = 611, MANTLET = 620
const units = [{ wodID: LADDER, type: "Ladder" }, { wodID: RAM, type: "Ram" }, { wodID: MANTLET, type: "Mantlet" }]
const packages = [
    { packageID: "30", unitID: String(LADDER), unitAmount: "1", packagePriceC1: "10" },
    { packageID: "32", unitID: String(RAM), unitAmount: "1", packagePriceC1: "20" },
    { packageID: "36", unitID: String(MANTLET), unitAmount: "1", packagePriceC1: "30" },
]
const MINUTE = 60_000
const START = new Date("2026-11-21T12:00:00Z").getTime()
const row = () => Array.from({ length: 20 }, (_, i) => tower(605 + i, 600, { victories: 300 }))
const run = ms => vi.advanceTimersByTimeAsync(ms)
const ownedBy = (home, wodID) => home[0].unitInventory.find(unit => unit.unitInfo.wodID == wodID).amount

/** A castle holding `ladders`, `rams` and `mantlets`, with the tools in the shape the attack builder reads. */
const castles = ({ ladders = 100_000, rams = 100_000, mantlets = 100_000 } = {}) => [castleAt(0, 1, 600, 600, {
    name: "Ironhold",
    inventory: [melee(601, 500_000), ranged(603, 500_000), tool(LADDER, ladders, { wallBonus: "10" }),
        tool(RAM, rams, { gateBonus: "10", slotTypes: "1,9" }), tool(MANTLET, mantlets, { defRangeBonus: "10" })],
})]

const AUTOBUY = { autoBuy: true, autoBuyMin: 1000, armourerSpendCap: 500_000, armourerCoinFloor: 0 }
function game(options, { coins = 1_000_000, stock, live = [30, 32, 36], map = row(), ...rest } = {}) {
    const home = castles(stock)
    const started = startTowers(options, {
        castles: home, map, commanders: 9, travelSeconds: 30, cooldown: 60, resources: { coins },
        armourer: { units, packages, live }, ...rest,
    })
    return { ...started, home }
}
const dryOrders = () => console.log.mock.calls.filter(([key]) => key == "dryRunSbp").map(([, json]) => JSON.parse(json))

beforeEach(() => { vi.useFakeTimers({ now: START }); for (const method of ["warn", "info", "log", "debug"]) vi.spyOn(console, method).mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("the Towers armoury options", () => {
    const keys = baronOptions({ kingdom: 0 }).map(def => def.key)
    test("the daily tool budget is gone and Auto-buy, Minimum tools and the coin limits are there", () => {
        expect(keys).not.toContain("toolBudgetPerDay")
        expect(keys).toEqual(expect.arrayContaining(["autoBuy", "autoBuyMin", "armourerSpendCap", "armourerCoinFloor"]))
    })
    test("Auto-buy starts off, and the minimum and coin limits show only while it is on", () => {
        const defs = Object.fromEntries(baronOptions({ kingdom: 0 }).map(def => [def.key, def]))
        expect(defs.autoBuy.default).toBe(false)
        for (const key of ["autoBuyMin", "armourerSpendCap", "armourerCoinFloor"])
            expect(defs[key].showWhen).toEqual({ key: "autoBuy", in: [1] })
    })
})

describe("Auto-buy from the armoury", () => {
    test("below the minimum, the bot orders the shortfall of ladders from the armourer, and with dryRun it only logs the order", async () => {
        const dry = game({ ...AUTOBUY, dryRun: true }, { stock: { ladders: 400 } })
        await run(MINUTE)
        expect(dry.orders).toEqual([])
        expect(dryOrders()[0]).toEqual({ PID: 30, BT: 0, TID: 27, AMT: 600, KID: 0, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 })
        expect(dry.sent.length).toBeGreaterThan(0)
    })

    test("without dryRun the order goes to the game, the castle gets the tools, and the coins go down", async () => {
        const live = game(AUTOBUY, { stock: { ladders: 400 } })
        await run(MINUTE)
        expect(live.orders).toEqual([{ PID: 30, BT: 0, TID: 27, AMT: 600, KID: 0, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }])
        expect(ownedBy(live.home, LADDER)).toBeGreaterThan(900)
        expect(live.protocols.resources.coins).toBe(1_000_000 - 6000)
    })

    test("with a source castle picked that isn't the main one, the bot buys from inside it and the tools land there", async () => {
        const home = castles()
        const watch = castleAt(0, 2, 610, 600, { type: 4, name: "Ironhold Watch", inventory: [melee(601, 500_000), ranged(603, 500_000), tool(LADDER, 400, { wallBonus: "10" })] })
        const live = game({ ...AUTOBUY, sourceCastle: { kingdom: 0, id: 2 } }, { castles: [...home, watch] })
        await run(MINUTE)
        expect(live.orders.map(order => order.AMT)).toEqual([600])
        expect(live.joins).toEqual([2])
        expect(ownedBy([watch], LADDER)).toBeGreaterThan(900)
        expect(ownedBy(home, LADDER)).toBe(100_000)
    })

    test("at or above the minimum it buys nothing", async () => {
        const full = game({ ...AUTOBUY, dryRun: true }, { stock: { ladders: 1000 } })
        await run(MINUTE)
        expect(full.orders).toEqual([])
        expect(dryOrders()).toEqual([])
    })

    test("with Auto-buy off it buys nothing, whatever the stock", async () => {
        const off = game({ ...AUTOBUY, autoBuy: false }, { stock: { ladders: 0 } })
        await run(MINUTE)
        expect(off.orders).toEqual([])
    })

    test("a coin floor stops the order short of it, and a floor at the coins stops it altogether", async () => {
        const nearly = game({ ...AUTOBUY, armourerCoinFloor: 999_900 }, { stock: { ladders: 0 } })
        await run(MINUTE)
        expect(nearly.orders.map(order => order.AMT)).toEqual([10])
        const stopped = game({ ...AUTOBUY, armourerCoinFloor: 1_000_000 }, { stock: { ladders: 0 } })
        await run(MINUTE)
        expect(stopped.orders).toEqual([])
    })

    test("the spend cap holds one check to that many coins", async () => {
        const capped = game({ ...AUTOBUY, armourerSpendCap: 2500 }, { stock: { ladders: 0 } })
        await run(MINUTE)
        expect(capped.orders.map(order => order.AMT)).toEqual([250])
    })

    test("Ladders only watches ladders, and Ladders, rams and mantlets watches all three", async () => {
        const ladders = game({ ...AUTOBUY, dryRun: true }, { stock: { ladders: 1000, rams: 0, mantlets: 0 } })
        await run(MINUTE)
        expect(dryOrders()).toEqual([])
        vi.restoreAllMocks(); for (const method of ["warn", "info", "log", "debug"]) vi.spyOn(console, method).mockImplementation(() => {})
        const all = game({ ...AUTOBUY, tools: 2, dryRun: true }, { stock: { ladders: 1000, rams: 900, mantlets: 0 } })
        await run(MINUTE)
        expect(dryOrders().map(order => [order.PID, order.AMT])).toEqual([[32, 100], [36, 1000]])
        expect(all.orders).toEqual([])
    })

    test("with No tools there is nothing to keep stocked", async () => {
        const none = game({ ...AUTOBUY, tools: 0 }, { stock: { ladders: 0 } })
        await run(MINUTE)
        expect(none.orders).toEqual([])
    })

    test("a tool the armourer is not selling is skipped without stopping the attacks", async () => {
        const closed = game(AUTOBUY, { stock: { ladders: 0 }, live: [] })
        await run(MINUTE)
        expect(closed.orders).toEqual([])
        expect(closed.sent.length).toBeGreaterThan(0)
    })

    test("the stock is looked at again after five minutes, and the attacks since then are bought back", async () => {
        const live = game(AUTOBUY, { stock: { ladders: 1000 } })
        await run(4 * MINUTE)
        expect(live.orders).toEqual([])
        await run(2 * MINUTE)
        const bought = live.orders.reduce((total, order) => total + order.AMT, 0)
        expect(bought).toBeGreaterThan(0)
        expect(ownedBy(live.home, LADDER)).toBeGreaterThanOrEqual(1000 - 30)
    })

    test("with the army on Waves the Tools setting is not in use, so nothing is bought", async () => {
        const first = emptyCustomWave()
        first.left = { tools: [{ item: LADDER, amount: 10 }, null], units: [{ item: 603, amount: 30 }, { item: 601, amount: 10 }] }
        first.front = { tools: [null, null, null], units: [{ item: 601, amount: 100 }, null, null, null, null, null] }
        const waves = game({ ...AUTOBUY, armyMode: "waves", waves: { ...emptyPlan(), waves: [first, ...emptyPlan().waves.slice(1)] } }, { stock: { ladders: 50 } })
        await run(MINUTE)
        expect(waves.sent.length).toBeGreaterThan(0)
        expect(waves.orders).toEqual([])
    })
})
