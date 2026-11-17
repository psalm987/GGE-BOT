import { randomUUID } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { BILLING_NOT_LIVE, NOT_ENOUGH_POINTS } from "@gge/contracts"
import { appSettings, auditLog, planPeriods, pointsLedger, users } from "@gge/db"
import { appendPeriod } from "../src/services/plans.ts"
import { pointsBalance } from "../src/services/points.ts"
import { startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
    await setBilling(true)
})
afterAll(() => api.close())

const DAY = 24 * 60 * 60 * 1000
const setBilling = (billingLive: boolean) => api.db.update(appSettings).set({ billingLive })
type Refusal = { code: string; data?: { code?: string; needed?: number } }
const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: Refusal) => `${e.code} ${e.data?.code}`)
const periodsOf = (userId: string) => api.db.select().from(planPeriods).where(eq(planPeriods.userId, userId)).orderBy(asc(planPeriods.startsAt))
const ledgerOf = (userId: string) => api.db.select().from(pointsLedger).where(eq(pointsLedger.userId, userId)).orderBy(asc(pointsLedger.id))

/** A verified player holding `points`. */
async function player(points: number) {
    const username = `p${Math.random().toString(36).slice(2, 10)}`
    const p = await api.player(username)
    const [user] = await api.db.select({ id: users.id }).from(users).where(eq(users.username, username))
    if (points)
        await admin.api.billing.adjustPoints({ userId: user!.id, delta: points, note: "test grant" })
    return { ...p, id: user!.id }
}

describe("redeeming points", () => {
    test("8 points buy 28 days of Basic and leave none", async () => {
        const p = await player(8)
        expect(await p.api.billing.points({})).toMatchObject({ balance: 8, cost: 8, days: 28, plan: "basic", history: [{ delta: 8, reason: "admin" }] })

        const { balance, period } = await p.api.billing.redeemPoints({ idempotencyKey: randomUUID() })
        expect(balance).toBe(0)
        expect(period).toMatchObject({ planId: "basic", source: "points" })
        expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(28 * DAY)
        expect(await ledgerOf(p.id)).toMatchObject([{ delta: 8 }, { delta: -8, reason: "redeem", periodId: period.id }])
        expect((await p.api.billing.points({})).history.map(h => h.delta)).toEqual([-8, 8])
    })

    test("two redemptions at the same moment with 8 points: one succeeds and the balance ends at 0", async () => {
        const p = await player(8)
        const results = await Promise.all([1, 2].map(() => refusal(p.api.billing.redeemPoints({ idempotencyKey: randomUUID() }))))
        expect(results.toSorted()).toEqual([`FORBIDDEN ${NOT_ENOUGH_POINTS}`, "ok"])
        expect(await pointsBalance(api.db, p.id)).toBe(0)
        expect(await periodsOf(p.id)).toHaveLength(1)
    })

    test("the same key twice deducts once and answers the same, even after more points arrive", async () => {
        const p = await player(16)
        const idempotencyKey = randomUUID()
        const first = await p.api.billing.redeemPoints({ idempotencyKey })
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 5, note: "later top-up" })
        expect(await p.api.billing.redeemPoints({ idempotencyKey })).toEqual(first)
        expect(first.balance).toBe(8)
        expect(await pointsBalance(api.db, p.id)).toBe(13)
        expect(await periodsOf(p.id)).toHaveLength(1)
    })

    test("the same key sent twice at once deducts once", async () => {
        const p = await player(16)
        const idempotencyKey = randomUUID()
        const [a, b] = await Promise.all([1, 2].map(() => p.api.billing.redeemPoints({ idempotencyKey })))
        expect(a).toEqual(b)
        expect(await pointsBalance(api.db, p.id)).toBe(8)
    })

    test("another player's key redeems nothing", async () => {
        const [first, second] = [await player(8), await player(8)]
        const idempotencyKey = randomUUID()
        await first.api.billing.redeemPoints({ idempotencyKey })
        expect(await refusal(second.api.billing.redeemPoints({ idempotencyKey }))).toBe("CONFLICT undefined")
        expect(await pointsBalance(api.db, second.id)).toBe(8)
    })

    test("7 points are one short", async () => {
        const p = await player(7)
        const error = await p.api.billing.redeemPoints({ idempotencyKey: randomUUID() }).catch(e => e as Refusal)
        expect(error).toMatchObject({ code: "FORBIDDEN", data: { code: NOT_ENOUGH_POINTS, needed: 1 } })
        expect(await pointsBalance(api.db, p.id)).toBe(7)
        expect(await periodsOf(p.id)).toEqual([])
    })

    test("a negative balance refuses", async () => {
        const p = await player(-3)
        const error = await p.api.billing.redeemPoints({ idempotencyKey: randomUUID() }).catch(e => e as Refusal)
        expect(error).toMatchObject({ data: { code: NOT_ENOUGH_POINTS, needed: 11 } })
    })

    test("the redeemed period queues right behind the one the player has", async () => {
        const p = await player(8)
        const existing = await api.db.transaction(tx => appendPeriod(tx, { userId: p.id, planId: "team", days: 10, source: "admin" }))
        const { period } = await p.api.billing.redeemPoints({ idempotencyKey: randomUUID() })
        expect(period.startsAt).toEqual(existing.endsAt)
    })

    test("the cost, days and plan follow the admin's settings", async () => {
        const before = await admin.api.billing.settings()
        expect(before).toEqual({ trialDays: 7, pointsRedeemCost: 8, pointsRedeemDays: 28, pointsRedeemPlan: "basic" })
        expect(await admin.api.billing.updateSettings({ pointsRedeemCost: 3, pointsRedeemDays: 14, pointsRedeemPlan: "team" }))
            .toEqual({ trialDays: 7, pointsRedeemCost: 3, pointsRedeemDays: 14, pointsRedeemPlan: "team" })
        try {
            const p = await player(3)
            const { balance, period } = await p.api.billing.redeemPoints({ idempotencyKey: randomUUID() })
            expect(balance).toBe(0)
            expect(period).toMatchObject({ planId: "team" })
            expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(14 * DAY)
        } finally {
            await admin.api.billing.updateSettings(before)
        }
        const entries = await api.db.select().from(auditLog).where(eq(auditLog.action, "admin.billing.settings"))
        expect(entries[0]).toMatchObject({ meta: { from: { pointsRedeemCost: 8 }, to: { pointsRedeemCost: 3 } } })
    })

    test("settings outside their bounds are refused", async () => {
        expect(await refusal(admin.api.billing.updateSettings({ pointsRedeemCost: 0 }))).toBe("BAD_REQUEST undefined")
        expect(await refusal(admin.api.billing.updateSettings({ trialDays: 1000 }))).toBe("BAD_REQUEST undefined")
    })
})

describe("an admin's adjustment", () => {
    test("is written with its note and the admin, and audited", async () => {
        const p = await player(0)
        expect(await admin.api.billing.adjustPoints({ userId: p.id, delta: 4, note: "goodwill" })).toEqual({ balance: 4 })
        expect(await admin.api.billing.adjustPoints({ userId: p.id, delta: -6, note: "chargeback" })).toEqual({ balance: -2 })
        const [boss] = await api.db.select({ id: users.id }).from(users).where(eq(users.username, "boss"))
        expect(await ledgerOf(p.id)).toMatchObject([
            { delta: 4, reason: "admin", note: "goodwill", createdBy: boss!.id },
            { delta: -6, reason: "admin", note: "chargeback", createdBy: boss!.id },
        ])
        const entries = await api.db.select().from(auditLog).where(eq(auditLog.targetId, p.id))
        expect(entries.filter(e => e.action === "admin.billing.adjust_points").map(e => e.meta)).toEqual([
            { delta: 4, note: "goodwill", balance: 4 },
            { delta: -6, note: "chargeback", balance: -2 },
        ])
    })

    test("needs a note, a delta and a real user", async () => {
        const p = await player(0)
        expect(await refusal(admin.api.billing.adjustPoints({ userId: p.id, delta: 1, note: "x" }))).toBe("BAD_REQUEST undefined")
        expect(await refusal(admin.api.billing.adjustPoints({ userId: p.id, delta: 0, note: "nothing" }))).toBe("BAD_REQUEST undefined")
        expect(await refusal(admin.api.billing.adjustPoints({ userId: randomUUID(), delta: 1, note: "nobody" }))).toBe("NOT_FOUND undefined")
    })
})

describe("while billing is off", () => {
    beforeAll(() => setBilling(false))
    afterAll(() => setBilling(true))

    test("players reach no points endpoint, and admins still adjust", async () => {
        const p = await player(8)
        expect(await refusal(p.api.billing.points({}))).toBe(`FORBIDDEN ${BILLING_NOT_LIVE}`)
        expect(await refusal(p.api.billing.redeemPoints({ idempotencyKey: randomUUID() }))).toBe(`FORBIDDEN ${BILLING_NOT_LIVE}`)
        expect(await pointsBalance(api.db, p.id)).toBe(8)
        expect(await periodsOf(p.id)).toEqual([])
    })
})
