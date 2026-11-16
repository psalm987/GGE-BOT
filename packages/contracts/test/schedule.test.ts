import { describe, expect, test } from "vitest"
import { Schedule, scheduleState, storedSchedule } from "../src/index.ts"

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]

const schedule = (windows: Schedule["windows"], over: Partial<Schedule> = {}): Schedule => ({ tz: "UTC", jitterMinutes: 0, windows, ...over })
const at = (s: Schedule, iso: string, seed = "account-1") => {
    const { active, nextChange } = scheduleState(s, new Date(iso), seed)
    return { active, nextChange: nextChange?.toISOString() ?? null }
}

// 2026-06-15 is a Monday.
describe("a window inside one day", () => {
    const office = schedule([{ days: WEEKDAYS, start: "09:00", end: "17:00" }])

    test("is active from its start up to its end", () => {
        expect(at(office, "2026-06-15T08:59:59Z")).toEqual({ active: false, nextChange: "2026-06-15T09:00:00.000Z" })
        expect(at(office, "2026-06-15T09:00:00Z")).toEqual({ active: true, nextChange: "2026-06-15T17:00:00.000Z" })
        expect(at(office, "2026-06-15T16:59:59Z")).toEqual({ active: true, nextChange: "2026-06-15T17:00:00.000Z" })
        expect(at(office, "2026-06-15T17:00:00Z")).toEqual({ active: false, nextChange: "2026-06-16T09:00:00.000Z" })
    })

    test("is not active on a day that isn't listed", () => {
        expect(at(office, "2026-06-20T12:00:00Z").active).toBe(false)
        expect(at(office, "2026-06-21T12:00:00Z").active).toBe(false)
    })

    test("the next start skips the weekend", () => {
        expect(at(office, "2026-06-19T18:00:00Z")).toEqual({ active: false, nextChange: "2026-06-22T09:00:00.000Z" })
    })
})

describe("a window past midnight", () => {
    const mondayNight = schedule([{ days: [1], start: "22:00", end: "02:00" }])

    test("is active before midnight on its day and after midnight on the next", () => {
        expect(at(mondayNight, "2026-06-15T23:00:00Z")).toEqual({ active: true, nextChange: "2026-06-16T02:00:00.000Z" })
        expect(at(mondayNight, "2026-06-16T01:00:00Z")).toEqual({ active: true, nextChange: "2026-06-16T02:00:00.000Z" })
    })

    test("belongs to the day it starts on", () => {
        expect(at(mondayNight, "2026-06-15T01:00:00Z").active).toBe(false)
        expect(at(mondayNight, "2026-06-16T23:00:00Z").active).toBe(false)
        expect(at(mondayNight, "2026-06-16T02:00:00Z")).toEqual({ active: false, nextChange: "2026-06-22T22:00:00.000Z" })
    })
})

describe("windows that meet", () => {
    test("two windows that touch are one stretch", () => {
        const split = schedule([{ days: EVERY_DAY, start: "08:00", end: "12:00" }, { days: EVERY_DAY, start: "12:00", end: "16:00" }])
        expect(at(split, "2026-06-15T10:00:00Z")).toEqual({ active: true, nextChange: "2026-06-15T16:00:00.000Z" })
    })

    test("windows that cover the whole week never change", () => {
        const always = schedule([{ days: EVERY_DAY, start: "00:00", end: "12:00" }, { days: EVERY_DAY, start: "12:00", end: "00:00" }])
        expect(at(always, "2026-06-15T10:00:00Z")).toEqual({ active: true, nextChange: null })
    })

    test("no schedule is always active", () => {
        expect(scheduleState(null, new Date("2026-06-15T10:00:00Z"), "account-1")).toEqual({ active: true, nextChange: null })
    })
})

describe("daylight saving in Europe/Berlin", () => {
    test("spring forward on 2026-03-29: a 02:30 start, which the clocks skip, is 03:00", () => {
        const s = schedule([{ days: [0], start: "02:30", end: "05:00" }], { tz: "Europe/Berlin" })
        // 01:59:59 CET; one second later the clocks read 03:00 CEST.
        expect(at(s, "2026-03-29T00:59:59Z")).toEqual({ active: false, nextChange: "2026-03-29T01:00:00.000Z" })
        expect(at(s, "2026-03-29T01:00:00Z")).toEqual({ active: true, nextChange: "2026-03-29T03:00:00.000Z" })
    })

    test("spring forward: a window wholly inside the skipped hour still runs for a minute", () => {
        const s = schedule([{ days: [0], start: "02:15", end: "02:45" }], { tz: "Europe/Berlin" })
        expect(at(s, "2026-03-29T01:00:00Z")).toEqual({ active: true, nextChange: "2026-03-29T01:01:00.000Z" })
    })

    test("fall back on 2026-10-25: 02:30 happens twice and the window starts at the first", () => {
        const s = schedule([{ days: [0], start: "02:30", end: "03:30" }], { tz: "Europe/Berlin" })
        expect(at(s, "2026-10-25T00:29:59Z")).toEqual({ active: false, nextChange: "2026-10-25T00:30:00.000Z" })
        // 02:30 CEST to 03:30 CET is two hours, and the second 02:30 (01:30 UTC) falls inside it.
        expect(at(s, "2026-10-25T00:30:00Z")).toEqual({ active: true, nextChange: "2026-10-25T02:30:00.000Z" })
        expect(at(s, "2026-10-25T01:30:00Z")).toEqual({ active: true, nextChange: "2026-10-25T02:30:00.000Z" })
    })

    test("fall back: a window across the repeated hour is an hour longer", () => {
        const s = schedule([{ days: [0], start: "01:00", end: "04:00" }], { tz: "Europe/Berlin" })
        expect(at(s, "2026-10-24T22:59:59Z").nextChange).toBe("2026-10-24T23:00:00.000Z")
        expect(at(s, "2026-10-24T23:00:00Z").nextChange).toBe("2026-10-25T03:00:00.000Z")
    })

    test("a day without a change keeps the zone's usual offset", () => {
        const s = schedule([{ days: EVERY_DAY, start: "08:00", end: "20:00" }], { tz: "Europe/Berlin" })
        expect(at(s, "2026-07-01T00:00:00Z").nextChange).toBe("2026-07-01T06:00:00.000Z")
        expect(at(s, "2026-12-01T00:00:00Z").nextChange).toBe("2026-12-01T07:00:00.000Z")
    })
})

describe("America/New_York", () => {
    const office = schedule([{ days: WEEKDAYS, start: "09:00", end: "17:00" }], { tz: "America/New_York" })

    test("follows local time in summer and in winter", () => {
        expect(at(office, "2026-06-15T12:00:00Z")).toEqual({ active: false, nextChange: "2026-06-15T13:00:00.000Z" })
        expect(at(office, "2026-06-15T20:00:00Z")).toEqual({ active: true, nextChange: "2026-06-15T21:00:00.000Z" })
        expect(at(office, "2026-01-12T13:30:00Z")).toEqual({ active: false, nextChange: "2026-01-12T14:00:00.000Z" })
        expect(at(office, "2026-01-12T21:30:00Z")).toEqual({ active: true, nextChange: "2026-01-12T22:00:00.000Z" })
    })

    test("the weekday is the local one", () => {
        // 02:00 UTC on Saturday is still Friday evening in New York.
        const friday = schedule([{ days: [5], start: "20:00", end: "23:00" }], { tz: "America/New_York" })
        expect(at(friday, "2026-06-20T02:00:00Z").active).toBe(true)
    })
})

describe("jitter", () => {
    const daily = schedule([{ days: EVERY_DAY, start: "08:00", end: "16:00" }], { jitterMinutes: 15 })
    const days = Array.from({ length: 30 }, (_, i) => Date.parse("2026-06-01T00:00:00Z") + i * DAY)
    const startOffsets = (seed: string) => days.map(midnight =>
        (scheduleState(daily, new Date(midnight), seed).nextChange!.getTime() - (midnight + 8 * 60 * MINUTE)) / MINUTE)
    const endOffsets = (seed: string) => days.map(midnight =>
        (scheduleState(daily, new Date(midnight + 12 * 60 * MINUTE), seed).nextChange!.getTime() - (midnight + 16 * 60 * MINUTE)) / MINUTE)

    test("moves each start and each end by a whole number of minutes within the limit", () => {
        for (const offset of [...startOffsets("account-1"), ...endOffsets("account-1")]) {
            expect(Number.isInteger(offset)).toBe(true)
            expect(Math.abs(offset)).toBeLessThanOrEqual(15)
        }
    })

    test("differs from day to day", () => {
        expect(new Set(startOffsets("account-1")).size).toBeGreaterThanOrEqual(2)
        expect(new Set(endOffsets("account-1")).size).toBeGreaterThanOrEqual(2)
    })

    test("is the same every time it is asked for the same account and day", () => {
        expect(startOffsets("account-1")).toEqual(startOffsets("account-1"))
        const early = scheduleState(daily, new Date("2026-06-15T00:00:00Z"), "account-1").nextChange
        const later = scheduleState(daily, new Date("2026-06-15T07:30:00Z"), "account-1").nextChange
        expect(later).toEqual(early)
    })

    test("differs between accounts", () => {
        expect(startOffsets("account-1")).not.toEqual(startOffsets("account-2"))
    })

    test("zero jitter moves nothing", () => {
        expect(at({ ...daily, jitterMinutes: 0 }, "2026-06-15T00:00:00Z").nextChange).toBe("2026-06-15T08:00:00.000Z")
    })

    test("never inverts a short window: it always starts before it ends and lasts a minute or more", () => {
        const short = schedule([{ days: EVERY_DAY, start: "08:00", end: "08:01" }], { jitterMinutes: 30 })
        for (const seed of ["a", "b", "c", "d"])
            for (const midnight of days) {
                const start = scheduleState(short, new Date(midnight), seed)
                expect(start.active).toBe(false)
                const end = scheduleState(short, start.nextChange!, seed)
                expect(end.active).toBe(true)
                expect(end.nextChange!.getTime() - start.nextChange!.getTime()).toBeGreaterThanOrEqual(MINUTE)
            }
    })

    test("windows that jitter pushes into each other join, so every reported change is a real one", () => {
        const close = schedule([{ days: EVERY_DAY, start: "08:00", end: "12:00" }, { days: EVERY_DAY, start: "12:10", end: "16:00" }], { jitterMinutes: 30 })
        let now = new Date("2026-06-01T00:00:00Z")
        let joined = 0
        for (let i = 0; i < 120; i++) {
            const before = scheduleState(close, now, "account-1")
            const after = scheduleState(close, before.nextChange!, "account-1")
            expect(after.active).toBe(!before.active)
            if (before.active && before.nextChange!.getTime() - now.getTime() > 6 * 60 * MINUTE)
                joined++
            now = before.nextChange!
        }
        expect(joined).toBeGreaterThan(0)
    })
})

describe("the schema", () => {
    const valid = { tz: "Europe/Berlin", jitterMinutes: 10, windows: [{ days: [1, 2], start: "08:00", end: "17:30" }] }
    const messages = (value: unknown) => Schedule.safeParse(value).error?.issues.map(i => i.message) ?? []

    test("accepts a schedule, with a window past midnight", () => {
        expect(Schedule.parse(valid)).toEqual(valid)
        expect(Schedule.safeParse({ ...valid, windows: [{ days: [6], start: "22:00", end: "02:00" }] }).success).toBe(true)
    })

    test.each(["Mars/Olympus", "+01:00", "", "Europe/Berlin; drop"])("refuses the time zone %j", tz => {
        expect(messages({ ...valid, tz })).toEqual(["Unknown time zone"])
    })

    test("refuses a window that starts and ends at the same time", () => {
        expect(messages({ ...valid, windows: [{ days: [1], start: "08:00", end: "08:00" }] })).toEqual(["A window can't start and end at the same time"])
    })

    test.each([
        ["no days", { days: [], start: "08:00", end: "09:00" }],
        ["a day twice", { days: [1, 1], start: "08:00", end: "09:00" }],
        ["a day past Saturday", { days: [7], start: "08:00", end: "09:00" }],
        ["a time that isn't one", { days: [1], start: "24:00", end: "09:00" }],
        ["a time without a leading zero", { days: [1], start: "8:00", end: "09:00" }],
    ])("refuses a window with %s", (_, window) => {
        expect(Schedule.safeParse({ ...valid, windows: [window] }).success).toBe(false)
    })

    test("refuses no windows, more than 14, and jitter outside 0 to 30", () => {
        expect(Schedule.safeParse({ ...valid, windows: [] }).success).toBe(false)
        expect(Schedule.safeParse({ ...valid, windows: Array(15).fill(valid.windows[0]) }).success).toBe(false)
        expect(Schedule.safeParse({ ...valid, jitterMinutes: 31 }).success).toBe(false)
        expect(Schedule.safeParse({ ...valid, jitterMinutes: -1 }).success).toBe(false)
        expect(Schedule.safeParse({ ...valid, jitterMinutes: 2.5 }).success).toBe(false)
    })

    test("a stored value that isn't a schedule reads as none", () => {
        expect(storedSchedule(valid)).toEqual(valid)
        expect(storedSchedule(null)).toBeNull()
        expect(storedSchedule({ tz: "Mars/Olympus" })).toBeNull()
    })
})
