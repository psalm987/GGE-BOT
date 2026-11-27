import { createRequire } from "node:module"
import { runStorm, GREAT_EMPIRE, BURNING_SANDS, BERIMOND, STORM } from "./harness/storm.mjs"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const FOOD = "plugins/foodSendStorm.js"
const run = (setup = {}) => runStorm(FOOD, { ...setup, options: { foodSendStorm: setup.options ?? {} } })
const foodSent = transfers => transfers.map(t => t.args[3])

test("refreshes the castles' figures with dcl before it looks", async () => {
    const { bot } = run({ storm: { food: 100 } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(bot.sent[0][0]).toBe("dcl")
})

test("fills the Storm storehouse from the main castle, sending a ninth more for what is lost on the way", async () => {
    const { transfers } = run({ storm: { food: 100 } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers.map(t => t.args)).toEqual([[1, GREAT_EMPIRE, STORM, [["F", 11_000]]]])
})

test("with a source list, the first castle with food above its keep sends, from its own kingdom", async () => {
    const sands = { id: 50, kingdomID: BURNING_SANDS, areaInfo: { type: 12 }, food: 5000 }
    const { transfers } = run({
        storm: { food: 100 },
        main: { food: 9000 },
        others: [sands],
        options: { foodSources: [{ castle: { kingdom: GREAT_EMPIRE, id: 1 }, keep: 10_000 }, { castle: { kingdom: BURNING_SANDS, id: 50 }, keep: 1000 }] },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers.map(t => t.args)).toEqual([[50, BURNING_SANDS, STORM, [["F", 4000]]]])
})

test("Storm and Berimond rows in the list never send", async () => {
    const camp = { id: 70, kingdomID: BERIMOND, areaInfo: { type: 12 }, food: 1_000_000 }
    const { transfers } = run({
        storm: { food: 100 },
        others: [camp],
        options: { foodSources: [{ castle: { kingdom: BERIMOND, id: 70 }, keep: 0 }, { castle: { kingdom: STORM, id: 900 }, keep: 0 }] },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
})

test("with a source list where no castle has food above its keep, nothing is sent", async () => {
    const { transfers, said } = run({ storm: { food: 100 }, options: { foodSources: [{ castle: { kingdom: GREAT_EMPIRE, id: 1 }, keep: 2_000_000 }] } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
    expect(said("foodSourcesKeepReached")).toBe(true)
})

test("waits until the food lasts less than the hours set, then sends", async () => {
    const t0 = Date.now()
    const burning = ([storm]) => { storm.food = 1000 - 100 * (Date.now() - t0) / HOUR }
    const { transfers } = run({ storm: { food: 1000 }, options: { foodRefillBelowHours: 2 }, fresh: burning })
    await vi.advanceTimersByTimeAsync(8 * HOUR - MINUTE)
    expect(transfers).toEqual([])
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(transfers).toHaveLength(1)
})

test("counts what the castle grows against what its troops eat", async () => {
    const { transfers, said } = run({ storm: { food: 1000, getProductionData: { FoodConsumptionRate: 600, deltaFood: 500 } } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
    expect(said("dontNeedFoodForAnother")).toBe(true)
})

test("when nothing eats the food, it tops up only once the storehouse is less than half full", async () => {
    const idle = { FoodConsumptionRate: 0 }
    const half = run({ storm: { food: 6000, getProductionData: idle } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(half.transfers).toEqual([])
    vi.useRealTimers()
    const low = run({ storm: { food: 4000, getProductionData: idle } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(foodSent(low.transfers)).toEqual([[["F", 6666]]])
})

test("a transfer in flight is waited out: no send, and another look within five minutes", async () => {
    const { transfers, checks, said } = run({ storm: { food: 100, resourceTransfer: { remainingTime: 30 * 60, resources: { mead: 500 } } }, held: {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
    expect(said("foodTransferInFlight")).toBe(true)
    const first = checks()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(checks()).toBeGreaterThan(first)
})

test("a refused transfer is tried again in five minutes", async () => {
    let calls = 0
    const { transfers, said } = run({ storm: { food: 100 }, onTransfer: async () => calls++ == 0 ? 1 : 0 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(said("failedToSendFood")).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(transfers).toHaveLength(2)
})

test("a transfer that lands after the food runs out is skipped, and the food it carried is counted at nine tenths", async () => {
    const { skips, transfers } = run({
        storm: { food: 50, resourceTransfer: { remainingTime: 2 * 3600, resources: { food: 5000 } }, getProductionData: { FoodConsumptionRate: 3000 } },
        onSkip: castle => { castle.resourceTransfer = undefined; return 0 },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(skips.length).toBeGreaterThan(0)
    expect(foodSent(transfers)).toEqual([[["F", Math.floor((10_000 - 50 - 4500) / 0.9)]]])
})

test("with skips off, a late transfer is waited out", async () => {
    const { skips, transfers } = run({
        storm: { food: 50, resourceTransfer: { remainingTime: 2 * 3600, resources: { food: 5000 } } },
        options: { foodUseSkips: false },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(skips).toEqual([])
    expect(transfers).toEqual([])
})

test("log only writes the transfer to the log and sends nothing, skips included", async () => {
    const late = run({ storm: { food: 50, resourceTransfer: { remainingTime: 2 * 3600, resources: { food: 5000 } } }, options: { foodDryRun: true } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(late.skips).toEqual([])
    vi.useRealTimers()
    const { transfers, log } = run({ storm: { food: 100 }, options: { foodDryRun: true } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
    const line = log.find(args => args[0] == "dryRunKgt")
    expect(JSON.parse(line[1])).toEqual({ SCID: 1, SKID: GREAT_EMPIRE, TKID: STORM, G: [["F", 11_000]] })
})

test("the catalog offers the hours, the castle rows with a keep, skips and log only", () => {
    const { mod } = loadModule(FOOD, { mainThread: true })
    expect(mod.pluginOptions.map(o => [o.key, o.type])).toEqual([
        ["foodRefillBelowHours", "Number"], ["foodSources", "Rows"], ["foodUseSkips", "Checkbox"], ["foodDryRun", "Checkbox"],
    ])
    const list = mod.pluginOptions.find(o => o.key == "foodSources")
    expect(list.columns.map(c => [c.key, c.type])).toEqual([["castle", "castle"], ["keep", "number"]])
    expect(mod.pluginOptions.find(o => o.key == "foodUseSkips").default).toBe(true)
})
