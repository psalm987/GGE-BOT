import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { gaussian, jittered, lognormalDelay, loginTiming } = require("../timing.js")

/** mulberry32: the same sequence on every run. */
function seeded(seed) {
    return () => {
        seed = seed + 0x6D2B79F5 | 0
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

const N = 200_000
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length
const sd = values => {
    const centre = mean(values)
    return Math.sqrt(mean(values.map(v => (v - centre) ** 2)))
}
const least = values => values.reduce((a, b) => Math.min(a, b))
const most = values => values.reduce((a, b) => Math.max(a, b))
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
const share = (values, test) => values.filter(test).length / values.length

afterEach(() => vi.useRealTimers())

describe("gaussian", () => {
    const random = seeded(1)
    const samples = Array.from({ length: N }, () => gaussian(60_000, 6000, random))

    test("samples centre on the mean with the asked spread", () => {
        expect(mean(samples)).toBeGreaterThan(59_900)
        expect(mean(samples)).toBeLessThan(60_100)
        expect(sd(samples)).toBeGreaterThan(5800)
        expect(sd(samples)).toBeLessThan(6100)
    })

    test("no sample is further than 3 sd from the mean, and the tails land on that bound", () => {
        expect(least(samples)).toBe(42_000)
        expect(most(samples)).toBe(78_000)
        expect(share(samples, v => v === 42_000 || v === 78_000)).toBeLessThan(0.005)
    })
})

describe("jittered", () => {
    test("each wait is a fresh delay around the mean", async () => {
        vi.useFakeTimers()
        const calls = []
        const start = Date.now()
        jittered(() => calls.push(Date.now() - start), 60_000, 6000, seeded(2))
        await vi.advanceTimersByTimeAsync(100 * 60_000)

        const waits = calls.map((at, i) => at - (calls[i - 1] ?? 0))
        expect(calls.length).toBeGreaterThan(90)
        expect(calls.length).toBeLessThan(110)
        expect(new Set(waits).size).toBeGreaterThan(80)
        expect(least(waits)).toBeGreaterThanOrEqual(42_000)
        expect(most(waits)).toBeLessThanOrEqual(78_000)
    })

    test("only one timer is ever pending, and stop cancels it", async () => {
        vi.useFakeTimers()
        let calls = 0
        const stop = jittered(() => calls++, 1000, 100, seeded(3))
        for (let i = 0; i < 50; i++) {
            await vi.advanceTimersByTimeAsync(700)
            expect(vi.getTimerCount()).toBe(1)
        }
        const before = calls
        expect(before).toBeGreaterThan(25)

        stop()
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(calls).toBe(before)
    })
})

describe("lognormalDelay", () => {
    const random = seeded(5)
    const samples = Array.from({ length: N }, () => lognormalDelay(20_000, 35_000, random))

    test("the median is the geometric middle of the range", () => {
        const middle = Math.sqrt(20_000 * 35_000)
        expect(median(samples)).toBeGreaterThan(middle * 0.99)
        expect(median(samples)).toBeLessThan(middle * 1.03)
    })

    test("about 90% of samples land inside the range", () => {
        const inside = share(samples, v => v >= 20_000 && v <= 35_000)
        expect(inside).toBeGreaterThan(0.89)
        expect(inside).toBeLessThan(0.94)
    })

    test("no sample is below the minimum", () => {
        expect(least(samples)).toBeGreaterThanOrEqual(20_000)
    })

    test("about 3% of delays are a break 2 to 6 times as long", () => {
        // A range this narrow keeps ordinary delays far below twice the minimum, so every longer one is a break.
        const narrow = Array.from({ length: N }, () => lognormalDelay(20_000, 21_000, random))
        const breaks = narrow.filter(v => v > 30_000)
        expect(breaks.length / N).toBeGreaterThan(0.027)
        expect(breaks.length / N).toBeLessThan(0.033)
        expect(least(breaks)).toBeGreaterThanOrEqual(2 * 20_000)
        expect(most(breaks)).toBeLessThanOrEqual(6 * 23_000)
        expect(most(breaks)).toBeGreaterThan(5 * 20_000)
    })

    test("with no range the delay is the minimum itself", () => {
        const fixed = Array.from({ length: 1000 }, () => lognormalDelay(4500.5, 4500.5, random))
        expect(share(fixed, v => v === 4500.5)).toBeGreaterThan(0.9)
        expect(least(fixed)).toBe(4500.5)
    })
})

describe("loginTiming", () => {
    test("without a measurement it is the pair the bot has always sent", () => {
        expect(loginTiming(undefined)).toEqual({ CONM: 212, RTM: 25 })
        expect(Object.keys(loginTiming(undefined))).toEqual(["CONM", "RTM"])
    })

    test("measured times are sent as whole milliseconds", () => {
        expect(loginTiming({ connectMs: 180.4, roundTripMs: 31.6 })).toEqual({ CONM: 180, RTM: 32 })
    })

    test("times outside the plausible range are pulled to its edge", () => {
        expect(loginTiming({ connectMs: 2, roundTripMs: 0.3 })).toEqual({ CONM: 50, RTM: 5 })
        expect(loginTiming({ connectMs: 45_000, roundTripMs: 9000 })).toEqual({ CONM: 3000, RTM: 1000 })
    })

    test("a time that was never measured keeps its old value", () => {
        expect(loginTiming({ connectMs: 300, roundTripMs: undefined })).toEqual({ CONM: 300, RTM: 25 })
        expect(loginTiming({ connectMs: undefined, roundTripMs: NaN })).toEqual({ CONM: 212, RTM: 25 })
    })
})
