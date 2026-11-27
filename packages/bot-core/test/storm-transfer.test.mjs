import { createRequire } from "node:module"
import { runStorm, GREAT_EMPIRE, STORM } from "./harness/storm.mjs"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const BOTH = "test/fixtures/storm-supply-both.cjs"

const protocols = { KingdomID: { stormIslands: 4 }, AreaType: { externalKingdom: 12 }, castles: [], unlockInfoList: [], ClientCommands: {} }
const { decide, fillAmount, BUSY_RETRY_MS, SENT_LOOK_MS } = loadModule("stormTransfer.js", { extra: { "protocols.js": protocols } }).mod

const castle = { id: 1, kingdomID: 0 }
const want = (fields = {}) => ({ name: "x", hoursLeft: Infinity, maySkip: false, waitMs: HOUR, ...fields })
const order = (goods, fields = {}) => want({ order: { from: castle, goods }, ...fields })

describe("the one transfer slot into Storm", () => {
    test("a transfer in flight blocks every send: a goods that wants one looks again in five minutes", () => {
        expect(decide(600, [order({ food: 100 })])).toEqual({ act: "wait", ms: BUSY_RETRY_MS })
    })

    test("a goods that wants nothing keeps its own wait while a transfer flies", () => {
        expect(decide(600, [want({ waitMs: 3 * HOUR })])).toEqual({ act: "wait", ms: 3 * HOUR })
    })

    test("a transfer that lands after a goods runs out is skipped when that goods may skip", () => {
        expect(decide(2 * 3600, [want({ hoursLeft: 1, maySkip: true })])).toEqual({ act: "skip" })
    })

    test("it is not skipped when that goods may not skip, when it lands in time, or on a dry run", () => {
        expect(decide(2 * 3600, [want({ hoursLeft: 1, maySkip: false })]).act).toBe("wait")
        expect(decide(600, [want({ hoursLeft: 1, maySkip: true })]).act).toBe("wait")
        expect(decide(2 * 3600, [order({ food: 1 }, { hoursLeft: 1, maySkip: true, dryRun: true })]).act).toBe("wait")
    })

    test("after the skips, the slot is never skipped twice in one look", () => {
        expect(decide(2 * 3600, [want({ hoursLeft: 1, maySkip: true })], { skipped: true }).act).toBe("wait")
    })

    test("a free slot goes to the goods that runs out soonest", () => {
        const mead = order({ mead: 10 }, { name: "mead", hoursLeft: 1.5 })
        const food = order({ food: 10 }, { name: "food", hoursLeft: 0.5 })
        expect(decide(0, [mead, food])).toMatchObject({ act: "send", want: food })
    })

    test("a goods nothing eats waits behind one being eaten, and goods troops eat go before goods they don't", () => {
        const idleFood = order({ food: 10 }, { name: "food", feedsTroops: true })
        const mead = order({ mead: 10 }, { name: "mead", hoursLeft: 40, feedsTroops: true })
        const build = order({ wood: 10 }, { name: "build" })
        expect(decide(0, [idleFood, mead])).toMatchObject({ want: mead })
        expect(decide(0, [build, idleFood])).toMatchObject({ want: idleFood })
    })

    test("Build Supply's wood and stone wait behind mead or food that is running out, and never skip a transfer in flight", () => {
        const build = order({ wood: 10, stone: 10 }, { name: "buildSupply", landNow: true })
        const food = order({ food: 10 }, { name: "food", hoursLeft: 1.5, feedsTroops: true })
        const mead = order({ mead: 10 }, { name: "mead", hoursLeft: 2, feedsTroops: true })
        expect(decide(0, [build, food])).toMatchObject({ act: "send", want: food })
        expect(decide(0, [build, mead])).toMatchObject({ act: "send", want: mead })
        expect(decide(10 * 3600, [build]).act).toBe("wait")
    })

    test("after a send, the loser looks again in five minutes and the sender in about fifteen", () => {
        expect(decide(0, [order({ food: 1 })])).toMatchObject({ ms: SENT_LOOK_MS })
        expect(decide(0, [order({ food: 1 }, { hoursLeft: 1 }), order({ mead: 1 })])).toMatchObject({ ms: BUSY_RETRY_MS })
    })

    test("with nothing to send, the next look is the soonest any goods asks for", () => {
        expect(decide(0, [want({ waitMs: 2 * HOUR }), want({ waitMs: 30 * MINUTE })])).toEqual({ act: "wait", logOnly: [], ms: 30 * MINUTE })
    })

    test("a log-only order never holds the slot: it is logged, and the real order behind it is sent", () => {
        const dryFood = order({ food: 10 }, { name: "food", hoursLeft: 0.5, dryRun: true })
        const mead = order({ mead: 10 }, { name: "mead", hoursLeft: 1.5 })
        expect(decide(0, [dryFood, mead])).toMatchObject({ act: "send", want: mead, logOnly: [dryFood] })
        expect(decide(0, [dryFood])).toEqual({ act: "wait", logOnly: [dryFood], ms: SENT_LOOK_MS })
    })
})

describe("filling the Storm storehouse", () => {
    const storm = { food: 1000, mead: 1000, getProductionData: { maxAmountFood: 10_000, maxAmountMead: 10_000 } }
    test("about a tenth of the food is lost on the way, so more is sent to fill it", () => {
        expect(fillAmount(storm, "food")).toBe(10_000)
    })
    test("mead fills to the space left, as it always has", () => {
        expect(fillAmount(storm, "mead")).toBe(9000)
    })
    test("a full storehouse needs nothing", () => {
        expect(fillAmount({ ...storm, food: 12_000 }, "food")).toBe(0)
    })
})

describe("mead and food share the slot", () => {
    const meadEaten = (mead, rate = 1000) => ({ mead, getProductionData: { MeadConsumptionRate: rate, maxAmountMead: 10_000 } })

    test("mead that runs out first goes first; food waits for the slot and goes once the mead has landed", async () => {
        const t0 = Date.now()
        const { transfers, said } = runStorm(BOTH, {
            storm: { ...meadEaten(1000), food: 100, getProductionData: { ...meadEaten(1000).getProductionData, maxAmountFood: 9000, FoodConsumptionRate: 50 } },
            held: {},
            fresh: ([storm]) => { if (Date.now() - t0 >= HOUR) storm.mead = 10_000 },
        })
        await vi.advanceTimersByTimeAsync(1000)
        expect(transfers.map(t => t.args[3])).toEqual([[["MEAD", 9000]]])
        expect(said("foodTransferInFlight")).toBe(true)
        await vi.advanceTimersByTimeAsync(HOUR + 5 * MINUTE)
        expect(transfers.map(t => t.args[3][0][0])).toEqual(["MEAD", "F"])
    })

    test("food that runs out first goes first", async () => {
        const { transfers } = runStorm(BOTH, {
            storm: { mead: 1500, food: 10, getProductionData: { MeadConsumptionRate: 1000, maxAmountMead: 10_000, maxAmountFood: 900, FoodConsumptionRate: 100 } },
            held: {},
        })
        await vi.advanceTimersByTimeAsync(1000)
        expect(transfers.map(t => t.args)).toEqual([[1, GREAT_EMPIRE, STORM, [["F", 988]]]])
    })

    test("food on Log only never holds up the mead: the mead is sent and the food only logged", async () => {
        const { transfers, said } = runStorm(BOTH, {
            storm: { mead: 1000, food: 10, getProductionData: { MeadConsumptionRate: 1000, maxAmountMead: 10_000, maxAmountFood: 900, FoodConsumptionRate: 100 } },
            options: { foodSendStorm: { foodDryRun: true } },
            held: {},
        })
        await vi.advanceTimersByTimeAsync(1000)
        expect(transfers.map(t => t.args[3])).toEqual([[["MEAD", 9000]]])
        expect(said("dryRunKgt")).toBe(true)
    })

    test("both senders refresh the figures with one dcl per look", async () => {
        const { checks } = runStorm(BOTH, { storm: meadEaten(100_000), held: {} })
        await vi.advanceTimersByTimeAsync(1000)
        expect(checks()).toBe(1)
    })
})
