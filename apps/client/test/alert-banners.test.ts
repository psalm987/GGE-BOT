import { describe, expect, test } from "vitest"
import type { Alerts } from "@gge/contracts"
import { bannerModels, endingSeverity, formatWhen, timeLeft } from "../src/alert-banners.ts"

const now = new Date("2026-11-17T12:00:00Z")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const none: Alerts = { plan: null, noPlan: false, overLimit: null, points: null, announcements: [] }
const announcement = (id: string, severity: "info" | "warning" | "critical") =>
    ({ id, severity, title: id, body: "", linkUrl: null, dismissible: true, startsAt: now })

describe("how urgent an ending plan is", () => {
    test.each([[22, "info"], [8, "info"], [7, "warning"], [2, "warning"], [1, "critical"], [0, "critical"]] as const)("paid, %i days left: %s", (days, severity) => {
        expect(endingSeverity(days, false)).toBe(severity)
    })

    test.each([[6, "warning"], [2, "warning"], [1, "critical"]] as const)("trial, %i days left: %s", (days, severity) => {
        expect(endingSeverity(days, true)).toBe(severity)
    })
})

test("the last day counts down in hours, never zero", () => {
    expect(timeLeft(new Date(now.getTime() + 3 * DAY), 3, now)).toEqual({ unit: "days", count: 3 })
    expect(timeLeft(new Date(now.getTime() + 4.2 * HOUR), 1, now)).toEqual({ unit: "hours", count: 5 })
    expect(timeLeft(new Date(now.getTime() + 60_000), 1, now)).toEqual({ unit: "hours", count: 1 })
})

describe("which banners show", () => {
    test("nothing to say, nothing shown", () => {
        expect(bannerModels(none, [], now)).toEqual([])
        expect(bannerModels(undefined, [], now)).toEqual([])
    })

    test("a trial three days from its end is a warning about the trial", () => {
        const [banner] = bannerModels({ ...none, plan: { planId: "basic", isTrial: true, endsAt: new Date(now.getTime() + 3 * DAY), daysLeft: 3 } }, [], now)
        expect(banner).toMatchObject({ kind: "trialEnding", severity: "warning", left: { unit: "days", count: 3 } })
    })

    test("an ended plan is critical and says which plan it was", () => {
        const endsAt = new Date(now.getTime() - DAY)
        expect(bannerModels({ ...none, noPlan: true, plan: { planId: "team", isTrial: false, endsAt, daysLeft: 0 } }, [], now))
            .toEqual([{ id: "plan", severity: "critical", kind: "planEnded", planId: "team", isTrial: false, endedAt: endsAt }])
    })

    test("no plan ever is its own critical banner", () => {
        expect(bannerModels({ ...none, noPlan: true }, [], now)).toMatchObject([{ kind: "noPlan", severity: "critical" }])
    })

    test("over the limit counts the accounts stopped", () => {
        expect(bannerModels({ ...none, overLimit: { limit: 1, counted: 3 } }, [], now)).toMatchObject([{ kind: "overLimit", stopped: 2, limit: 1 }])
    })

    test("most urgent first, then plan, accounts, announcements and points in that order", () => {
        const alerts: Alerts = {
            plan: { planId: "basic", isTrial: false, endsAt: new Date(now.getTime() + 20 * DAY), daysLeft: 12 },
            noPlan: false,
            overLimit: { limit: 1, counted: 2 },
            points: { balance: 9, cost: 8, days: 28, planId: "basic" },
            announcements: [announcement("down", "critical"), announcement("news", "info")],
        }
        expect(bannerModels(alerts, [{ id: "a1", name: "Ironhold" }], now).map(b => b.id))
            .toEqual(["down", "over-limit", "attention", "plan", "news", "points"])
    })
})

describe("dates in the viewer's language and time zone", () => {
    test("this year's date leaves the year off", () => {
        expect(formatWhen(new Date("2026-11-20T13:02:00Z"), "en-GB", now, { timeZone: "Europe/Berlin" })).toBe("20 Nov, 14:02")
    })

    test("next year's date says the year", () => {
        expect(formatWhen(new Date("2027-01-08T00:00:00Z"), "en-GB", now, { timeZone: "Europe/Berlin" })).toBe("8 Jan 2027, 01:00")
    })

    test("a date alone, for a plan that ended", () => {
        expect(formatWhen(new Date("2026-11-08T00:00:00Z"), "en-GB", now, { time: false, timeZone: "UTC" })).toBe("8 Nov")
    })

    test("another language's own format", () => {
        expect(formatWhen(new Date("2026-11-20T13:02:00Z"), "de", now, { timeZone: "UTC" })).toBe("20. Nov., 13:02")
    })
})
