import { and, desc, eq, lt, lte, sql } from "drizzle-orm"
import { NOT_ENOUGH_POINTS, type BillingSettings, type PointsRedemption, type PointsSummary } from "@gge/contracts"
import { appSettings, planPeriods, pointsLedger, users, type Db } from "@gge/db"
import { audit } from "./audit.ts"
import { appendPeriod, lockUser, periodColumns } from "./plans.ts"
import { alertsChanged } from "./realtime.ts"
import { fail } from "../errors.ts"

type Reader = Pick<Db, "select">

const settingsColumns = {
    trialDays: appSettings.trialDays, pointsRedeemCost: appSettings.pointsRedeemCost,
    pointsRedeemDays: appSettings.pointsRedeemDays, pointsRedeemPlan: appSettings.pointsRedeemPlan,
}

export async function billingSettings(db: Reader): Promise<BillingSettings> {
    const [settings] = await db.select(settingsColumns).from(appSettings)
    return settings!
}

export async function updateBillingSettings(db: Db, actorId: string, changes: Partial<BillingSettings>) {
    return db.transaction(async tx => {
        const [from] = await tx.select(settingsColumns).from(appSettings).for("update")
        const [to] = await tx.update(appSettings).set({ ...changes, updatedAt: new Date() }).returning(settingsColumns)
        await audit(tx, { actorId, action: "admin.billing.settings", meta: { from, to } })
        return to!
    })
}

/** The user's points up to and including ledger row `upTo`, or all of them. */
export async function pointsBalance(db: Reader, userId: string, upTo?: number) {
    const [row] = await db.select({ balance: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` }).from(pointsLedger)
        .where(and(eq(pointsLedger.userId, userId), upTo === undefined ? undefined : lte(pointsLedger.id, upTo)))
    return row!.balance
}

export async function pointsSummary(db: Reader, userId: string, { before, limit }: { before?: number; limit: number }): Promise<PointsSummary> {
    const [balance, settings, history] = await Promise.all([
        pointsBalance(db, userId),
        billingSettings(db),
        db.select({ id: pointsLedger.id, delta: pointsLedger.delta, reason: pointsLedger.reason, createdAt: pointsLedger.createdAt }).from(pointsLedger)
            .where(and(eq(pointsLedger.userId, userId), before ? lt(pointsLedger.id, before) : undefined))
            .orderBy(desc(pointsLedger.id)).limit(limit),
    ])
    return { balance, cost: settings.pointsRedeemCost, days: settings.pointsRedeemDays, plan: settings.pointsRedeemPlan, history }
}

/**
 * Spends the redeem cost on a period queued behind the user's last. The lock on the user row makes two requests take
 * turns, so the second sees the first's deduction, and a request repeating a key gets the first one's answer.
 */
export async function redeemPoints(db: Db, userId: string, idempotencyKey: string, now = new Date()): Promise<PointsRedemption> {
    return db.transaction(async tx => {
        await lockUser(tx, userId)
        const [earlier] = await tx.select({ id: pointsLedger.id, userId: pointsLedger.userId, periodId: pointsLedger.periodId })
            .from(pointsLedger).where(eq(pointsLedger.idempotencyKey, idempotencyKey))
        if (earlier) {
            const [period] = earlier.userId === userId && earlier.periodId
                ? await tx.select(periodColumns).from(planPeriods).where(eq(planPeriods.id, earlier.periodId))
                : []
            if (!period)
                throw fail("CONFLICT", "REDEMPTION_REPEATED")
            return { balance: await pointsBalance(tx, userId, earlier.id), period }
        }
        const { pointsRedeemCost: cost, pointsRedeemDays: days, pointsRedeemPlan: planId } = await billingSettings(tx)
        const balance = await pointsBalance(tx, userId)
        if (balance < cost) {
            const needed = cost - balance
            throw fail("FORBIDDEN", NOT_ENOUGH_POINTS, { count: needed })
        }
        const period = await appendPeriod(tx, { userId, planId, days, source: "points" }, now)
        await tx.insert(pointsLedger).values({ userId, delta: -cost, reason: "redeem", periodId: period.id, idempotencyKey })
        return { balance: balance - cost, period }
    })
}

/** An admin's correction, in either direction. The note says why and is kept with the row and in the audit log. */
export async function adjustPoints(db: Db, actorId: string, { userId, delta, note }: { userId: string; delta: number; note: string }) {
    return db.transaction(async tx => {
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update")
        if (!user)
            throw fail("NOT_FOUND", "USER_NOT_FOUND")
        await tx.insert(pointsLedger).values({ userId, delta, reason: "admin", note, createdBy: actorId })
        const balance = await pointsBalance(tx, userId)
        await alertsChanged(tx, userId)
        await audit(tx, { actorId, action: "admin.billing.adjust_points", targetType: "user", targetId: userId, meta: { delta, note, balance } })
        return { balance }
    })
}
