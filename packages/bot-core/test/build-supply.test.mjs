import { createRequire } from "node:module"
import { runStorm, GREAT_EMPIRE, BURNING_SANDS, BERIMOND, STORM } from "./harness/storm.mjs"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const SUPPLY = "plugins/buildSupply.js"
const WITH_FOOD = "test/fixtures/storm-food-and-build-supply.cjs"

const sands = (fields = {}) => ({ id: 50, kingdomID: BURNING_SANDS, areaInfo: { type: 12, extraData: [, , , , , , , "Dune"] }, wood: 100_000, stone: 100_000, ...fields })
const fromSands = (keep = 0) => ({ castle: { kingdom: BURNING_SANDS, id: 50 }, keep })
const stormStock = (fields = {}) => ({
    wood: 1000, stone: 4000, ...fields,
    getProductionData: { maxAmountWood: 10_000, maxAmountStone: 10_000, ...fields.getProductionData },
})

function run({ relPath = SUPPLY, storm = {}, others = [sands()], options = {}, ...rest } = {}) {
    const game = runStorm(relPath, {
        storm: stormStock(storm), others, held: {}, ...rest,
        options: { buildSupply: { buildSupplySources: [fromSands()], ...options } },
    })
    /** Build's report on a castle; resolves to the earliest next look the plugin asked for, Infinity for none. */
    const buildLooked = ({ castle = game.storm, need = { wood: 1_000_000, stone: 1_000_000 }, nothingPayable = true } = {}) => {
        const asked = []
        game.bot.events.emit("buildLooked", { castle, need, nothingPayable, waiting: nothingPayable, lookAgainIn: ms => asked.push(ms) })
        return Promise.all(asked).then(waits => Math.min(Infinity, ...waits))
    }
    return { ...game, buildLooked, goods: () => game.transfers.map(t => t.args[3]) }
}

test("sends only for the Storm Islands castle, and only once nothing in its plan is payable", async () => {
    const { buildLooked, transfers, main } = run()
    await vi.advanceTimersByTimeAsync(SECOND)
    for (const report of [{ castle: main }, { nothingPayable: false }, { need: { wood: 0, stone: 0 } }]) {
        buildLooked(report)
        await vi.advanceTimersByTimeAsync(MINUTE)
    }
    expect(transfers).toEqual([])

    buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(transfers).toHaveLength(1)
})

test("fills each storehouse plus a ninth for what is lost on the way, wood and stone in one transfer", async () => {
    const { buildLooked, transfers } = run()
    await vi.advanceTimersByTimeAsync(SECOND)
    buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(transfers.map(t => t.args)).toEqual([[50, BURNING_SANDS, STORM, [["W", 10_000], ["S", 6666]]]])
})

test("sends no more than the plan still lacks, plus a ninth", async () => {
    const { buildLooked, goods } = run()
    await vi.advanceTimersByTimeAsync(SECOND)
    buildLooked({ need: { wood: 1900, stone: 3000 } })
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(goods()).toEqual([[["W", 1000]]])
})

test("a castle sends only what it holds above its keep", async () => {
    const { buildLooked, goods } = run({ others: [sands({ wood: 8000, stone: 3000 })], options: { buildSupplySources: [fromSands(2000)] } })
    await vi.advanceTimersByTimeAsync(SECOND)
    buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(goods()).toEqual([[["W", 6000], ["S", 1000]]])
})

test("the first listed castle with wood or stone above its keep sends; Storm and Berimond rows never do", async () => {
    const camp = { id: 70, kingdomID: BERIMOND, areaInfo: { type: 12 }, wood: 1_000_000, stone: 1_000_000 }
    const { buildLooked, transfers } = run({
        others: [camp, sands()],
        main: { wood: 500, stone: 500 },
        options: {
            buildSupplySources: [
                { castle: { kingdom: BERIMOND, id: 70 }, keep: 0 }, { castle: { kingdom: STORM, id: 900 }, keep: 0 },
                { castle: { kingdom: GREAT_EMPIRE, id: 1 }, keep: 1000 }, fromSands(),
            ],
        },
    })
    await vi.advanceTimersByTimeAsync(SECOND)
    buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(transfers.map(t => t.args.slice(0, 2))).toEqual([[50, BURNING_SANDS]])
})

test("with no castle listed, or none with stock above its keep, nothing is sent", async () => {
    const empty = run({ options: { buildSupplySources: [] } })
    await vi.advanceTimersByTimeAsync(SECOND)
    empty.buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(empty.transfers).toEqual([])
    expect(empty.said("buildSupplyNoCastles")).toBe(true)
    vi.useRealTimers()

    const kept = run({ options: { buildSupplySources: [fromSands(200_000)] } })
    await vi.advanceTimersByTimeAsync(SECOND)
    kept.buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(kept.transfers).toEqual([])
    expect(kept.said("buildSupplyNoSource")).toBe(true)
})

test("after a send, Build looks again once the goods have landed", async () => {
    const { buildLooked, transfers } = run({ options: { buildSupplyUseSkips: false } })
    await vi.advanceTimersByTimeAsync(SECOND)
    const next = buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(transfers).toHaveLength(1)
    const ms = await next
    expect(ms).toBeGreaterThanOrEqual(HOUR - MINUTE)
    expect(ms).toBeLessThanOrEqual(HOUR + MINUTE)
})

test("with skips on, the transfer is skipped until it lands, a few seconds between skips, and Build looks again within seconds", async () => {
    const t0 = Date.now()
    const at = []
    const { buildLooked, skips, storm } = run({
        held: { "30MinSkip": 5 },
        onSkip: () => { at.push(Date.now() - t0); return 0 },
    })
    await vi.advanceTimersByTimeAsync(SECOND)
    const next = buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(skips).toEqual(["MS4", "MS4"])
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(SECOND)
    expect(at[1] - at[0]).toBeLessThanOrEqual(3 * SECOND)
    expect(storm.wood).toBe(1000 + 9000)
    const ms = await next
    expect(ms).toBeGreaterThanOrEqual(5 * SECOND)
    expect(ms).toBeLessThanOrEqual(10 * SECOND)
})

test("a refused transfer is tried again in five minutes", async () => {
    let calls = 0
    const { buildLooked, transfers, said } = run({ onTransfer: async () => calls++ == 0 ? 1 : 0 })
    await vi.advanceTimersByTimeAsync(SECOND)
    buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(transfers).toHaveLength(1)
    expect(said("buildSupplyRefused")).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(transfers).toHaveLength(2)
})

test("one report from Build sends once: the arbiter's later looks don't send again", async () => {
    const { buildLooked, transfers } = run({ options: { buildSupplyUseSkips: false } })
    await vi.advanceTimersByTimeAsync(SECOND)
    buildLooked()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(transfers).toHaveLength(1)
})

test("while a transfer flies, nothing is sent and Build looks again once it lands", async () => {
    const { buildLooked, transfers } = run({ storm: { resourceTransfer: { remainingTime: 20 * 60, resources: { mead: 500 } } } })
    await vi.advanceTimersByTimeAsync(SECOND)
    const ms = await buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(transfers).toEqual([])
    expect(ms).toBeGreaterThanOrEqual(20 * MINUTE - MINUTE)
    expect(ms).toBeLessThanOrEqual(21 * MINUTE)
})

test("food that is running out goes first; wood and stone follow once the food has landed", async () => {
    const t0 = Date.now()
    const { buildLooked, goods, said } = run({
        fresh: ([storm]) => { if (Date.now() - t0 >= HOUR) storm.food = 10_000 },
        relPath: WITH_FOOD,
        storm: { food: 100, getProductionData: { maxAmountFood: 10_000, FoodConsumptionRate: 100 } },
        main: { food: 1_000_000 },
    })
    const next = buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(goods().map(g => g[0][0])).toEqual(["F"])
    expect(said("buildSupplyTransferInFlight")).toBe(true)
    expect(await next).toBeGreaterThanOrEqual(HOUR - MINUTE)
    await vi.advanceTimersByTimeAsync(HOUR + 5 * MINUTE)
    expect(goods().map(g => g[0][0])).toEqual(["F", "W"])
})

test("food that isn't running out leaves the slot to wood and stone", async () => {
    const { buildLooked, goods } = run({ relPath: WITH_FOOD, storm: { food: 9000, getProductionData: { maxAmountFood: 10_000, FoodConsumptionRate: 100 } } })
    buildLooked()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(goods().map(g => g[0][0])).toEqual(["W"])
})

test("log only writes the transfer to the log and sends nothing, skips included", async () => {
    const { buildLooked, transfers, skips, log } = run({ held: { "60MinSkip": 5 }, options: { buildSupplyDryRun: true } })
    await vi.advanceTimersByTimeAsync(SECOND)
    expect(await Promise.all([buildLooked(), vi.advanceTimersByTimeAsync(MINUTE)]).then(([ms]) => ms)).toBe(Infinity)
    expect(transfers).toEqual([])
    expect(skips).toEqual([])
    const line = log.find(args => args[0] == "dryRunKgt")
    expect(JSON.parse(line[1])).toEqual({ SCID: 50, SKID: BURNING_SANDS, TKID: STORM, G: [["W", 10_000], ["S", 6666]] })
})

test("the catalog offers the castle rows with a keep, skips on by default, and log only", () => {
    const { mod } = loadModule(SUPPLY, { mainThread: true })
    expect(mod.pluginOptions.map(o => [o.key, o.type, o.default])).toEqual([
        ["buildSupplySources", "Rows", []], ["buildSupplyUseSkips", "Checkbox", true], ["buildSupplyDryRun", "Checkbox", false],
    ])
    const rows = mod.pluginOptions.find(o => o.key == "buildSupplySources")
    expect(rows.columns.map(c => [c.key, c.type])).toEqual([["castle", "castle"], ["keep", "number"]])
})
