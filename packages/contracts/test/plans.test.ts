import { describe, expect, test } from "vitest"
import { accountLimit, currentPlan, entitledAccountIds, nextPlanChange, type CurrentPlan, type PlanPeriod } from "../src/index.ts"

const day = (n: number) => new Date(Date.UTC(2026, 0, n))
const period = (from: number, to: number, over: Partial<PlanPeriod> = {}): PlanPeriod =>
    ({ planId: "basic", startsAt: day(from), endsAt: day(to), source: "purchase", ...over })
const sizes = { basic: 1, team: 5 }

describe("currentPlan", () => {
    test("no periods is no plan", () => {
        expect(currentPlan([], sizes, day(5))).toBeNull()
    })

    test("a period covers its start and stops covering at its end", () => {
        const periods = [period(1, 29)]
        expect(currentPlan(periods, sizes, day(1))).toEqual({ planId: "basic", maxAccounts: 1, endsAt: day(29), isTrial: false })
        expect(currentPlan(periods, sizes, new Date(day(29).getTime() - 1))).not.toBeNull()
        expect(currentPlan(periods, sizes, day(29))).toBeNull()
    })

    test("a period that hasn't started yet is no plan", () => {
        expect(currentPlan([period(10, 38)], sizes, day(5))).toBeNull()
    })

    test("an expired period is no plan", () => {
        expect(currentPlan([period(1, 29)], sizes, day(40))).toBeNull()
    })

    test("a queued period extends the cover and the current one still names the plan", () => {
        const periods = [period(29, 57, { planId: "team" }), period(1, 29)]
        expect(currentPlan(periods, sizes, day(5))).toEqual({ planId: "basic", maxAccounts: 1, endsAt: day(57), isTrial: false })
        expect(currentPlan(periods, sizes, day(30))).toEqual({ planId: "team", maxAccounts: 5, endsAt: day(57), isTrial: false })
    })

    test("cover ends at the first gap", () => {
        expect(currentPlan([period(1, 29), period(40, 68)], sizes, day(5))?.endsAt).toEqual(day(29))
    })

    test("a trial is flagged only while it is the current period", () => {
        const periods = [period(1, 8, { source: "trial" }), period(8, 36)]
        expect(currentPlan(periods, sizes, day(2))).toMatchObject({ isTrial: true, endsAt: day(36) })
        expect(currentPlan(periods, sizes, day(9))).toMatchObject({ isTrial: false })
    })
})

describe("nextPlanChange", () => {
    test("is the nearest start or end still ahead", () => {
        const periods = [period(1, 29), period(29, 57), period(70, 98)]
        expect(nextPlanChange(periods, day(5))).toEqual(day(29))
        expect(nextPlanChange(periods, day(29))).toEqual(day(57))
        expect(nextPlanChange(periods, day(60))).toEqual(day(70))
        expect(nextPlanChange(periods, day(98))).toBeNull()
        expect(nextPlanChange([], day(1))).toBeNull()
    })
})

describe("accountLimit", () => {
    const plan: CurrentPlan = { planId: "team", maxAccounts: 5, endsAt: day(29), isTrial: false }
    const user = { role: "user" as const, maxBots: 2, maxBotsOverride: null, plan: null }

    test.each([
        ["no plan", user],
        ["a plan", { ...user, plan }],
        ["a plan and an override", { ...user, plan, maxBotsOverride: 9 }],
        ["an admin", { ...user, role: "admin" as const }],
    ])("billing off: %s gets max_bots", (_, owner) => {
        expect(accountLimit(owner, false)).toBe(2)
    })

    test.each([
        ["no plan gets nothing", user, 0],
        ["no plan gets nothing even with an override", { ...user, maxBotsOverride: 3 }, 0],
        ["a plan gives its size", { ...user, plan }, 5],
        ["an override replaces the plan's size", { ...user, plan, maxBotsOverride: 3 }, 3],
        ["an override of zero is still an override", { ...user, plan, maxBotsOverride: 0 }, 0],
    ])("billing live: %s", (_, owner, limit) => {
        expect(accountLimit(owner, true)).toBe(limit)
    })

    test("billing live: an admin with no plan still runs every account", () => {
        const admin = { ...user, role: "admin" as const }
        const accounts = ["a", "b", "c"].map((id, i) => ({ id, serverId: 26, name: id, externalEvent: false, createdAt: day(i + 1) }))
        expect(entitledAccountIds({ role: admin.role, maxBots: accountLimit(admin, true) }, accounts).size).toBe(3)
    })
})
