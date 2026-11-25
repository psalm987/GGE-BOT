import { describe, expect, test } from "vitest"
import { READ_BACK_MAX_MOVEMENTS, ReadBack, hourlyRate, marchProgress, stockForecast } from "../src/read-back.ts"

const march = { id: 1, side: "own", kind: "attack", kingdom: 0, from: { type: 1, x: 1, y: 2, name: "Keep" }, to: { type: 2, x: 3, y: 4, name: null }, sender: null, troops: null, totalSeconds: 600, arrivesAt: 1_000_000 }
const snapshot = { at: 0, castles: [], movements: [march], movementCount: 1, session: { startedAt: 0, coins: null, rubies: null } }

describe("the read-back snapshot", () => {
    test("is refused when it carries more marches than a status report may", () => {
        expect(ReadBack.safeParse(snapshot).success).toBe(true)
        expect(ReadBack.safeParse({ ...snapshot, movements: Array(READ_BACK_MAX_MOVEMENTS + 1).fill(march) }).success).toBe(false)
    })
})

describe("where a stock is heading", () => {
    test("a stock that grows says how many hours until it is full", () => {
        expect(stockForecast({ amount: 20_888, max: 282_600, perHour: 443 })).toEqual({ state: "fillsIn", hours: (282_600 - 20_888) / 443 })
    })
    test("a stock that shrinks says how many hours until it is gone", () => {
        expect(stockForecast({ amount: 7_400_000, max: 9_000_000, perHour: -53_972 })).toEqual({ state: "emptiesIn", hours: 7_400_000 / 53_972 })
    })
    test("a stock at its limit is full, whether or not the castle still makes more", () => {
        expect(stockForecast({ amount: 175_000, max: 175_000, perHour: 19 })).toEqual({ state: "full" })
        expect(stockForecast({ amount: 125_000, max: 125_000, perHour: 0 })).toEqual({ state: "full" })
    })
    test("a stock that isn't moving and isn't full has no forecast", () => {
        expect(stockForecast({ amount: 15, max: 101_000, perHour: 0 })).toBeNull()
    })
    test("time since the read comes off the forecast, down to full or empty", () => {
        const filling = { amount: 0, max: 1000, perHour: 100 }
        expect(stockForecast(filling, 4)).toEqual({ state: "fillsIn", hours: 6 })
        expect(stockForecast(filling, 12)).toEqual({ state: "full" })
        expect(stockForecast({ amount: 1000, max: 1000, perHour: -100 }, 12)).toEqual({ state: "empty" })
    })
})

describe("a session's hourly rate", () => {
    test("is the gain scaled to an hour", () => {
        expect(hourlyRate(44_400, 30 * 60_000)).toBe(88_800)
        expect(hourlyRate(-2, 2 * 3_600_000)).toBe(-1)
    })
    test("is withheld for the first five minutes", () => {
        expect(hourlyRate(44_400, 4 * 60_000)).toBeNull()
    })
})

describe("how far along a march is", () => {
    test("runs from 0 when it leaves to 1 when it lands, and stays there", () => {
        expect(marchProgress(march, 400_000)).toBe(0)
        expect(marchProgress(march, 850_000)).toBe(0.75)
        expect(marchProgress(march, 2_000_000)).toBe(1)
    })
})
