import { ORPCError } from "@orpc/server"
import { asc, desc, eq, inArray } from "drizzle-orm"
import type { AdminPeriod, GrantDays, PlanId, PlanRow, UserPlan } from "@gge/contracts"
import { licenseCodes, planPeriods, plans, pointsLedger, purchases, users, type Db } from "@gge/db"
import { stopUnentitled } from "./accounts.ts"
import { audit } from "./audit.ts"
import { listCodes } from "./codes.ts"
import { appendPeriod, endCurrentPeriod, myPlan, periodColumns } from "./plans.ts"
import { pointsBalance } from "./points.ts"
import { alertsChanged } from "./realtime.ts"

type Reader = Pick<Db, "select">

export const listPlans = (db: Reader): Promise<PlanRow[]> =>
    db.select({ id: plans.id, name: plans.name, maxAccounts: plans.maxAccounts }).from(plans).orderBy(asc(plans.id))

/** Changes how many accounts a plan runs, for everyone on it. The runner wakes up through the plans trigger. */
export async function updatePlan(db: Db, actorId: string, { id, maxAccounts }: { id: PlanId; maxAccounts: number }) {
    return db.transaction(async tx => {
        const [from] = await tx.select({ maxAccounts: plans.maxAccounts }).from(plans).where(eq(plans.id, id)).for("update")
        if (!from)
            throw new ORPCError("NOT_FOUND", { message: "No such plan" })
        const [to] = await tx.update(plans).set({ maxAccounts, updatedAt: new Date() }).where(eq(plans.id, id))
            .returning({ id: plans.id, name: plans.name, maxAccounts: plans.maxAccounts })
        await audit(tx, { actorId, action: "admin.billing.update_plan", targetType: "plan", targetId: id, meta: { from: from.maxAccounts, to: maxAccounts } })
        return to!
    })
}

async function userExists(db: Reader, userId: string) {
    const [user] = await db.select({ maxBotsOverride: users.maxBotsOverride }).from(users).where(eq(users.id, userId))
    if (!user)
        throw new ORPCError("NOT_FOUND", { message: "No such user" })
    return user
}

const adminPeriodColumns = { ...periodColumns, grantedBy: users.username, note: planPeriods.note }

export async function userPlan(db: Reader, userId: string): Promise<UserPlan> {
    const { maxBotsOverride } = await userExists(db, userId)
    const bought = db.select({ id: purchases.id }).from(purchases).where(eq(purchases.buyerId, userId))
    const [overview, periods, balance, history, codes] = await Promise.all([
        myPlan(db, userId),
        db.select(adminPeriodColumns).from(planPeriods).leftJoin(users, eq(users.id, planPeriods.grantedBy))
            .where(eq(planPeriods.userId, userId)).orderBy(desc(planPeriods.startsAt)),
        pointsBalance(db, userId),
        db.select({
            id: pointsLedger.id, delta: pointsLedger.delta, reason: pointsLedger.reason, createdAt: pointsLedger.createdAt,
            note: pointsLedger.note, createdBy: users.username,
        }).from(pointsLedger).leftJoin(users, eq(users.id, pointsLedger.createdBy))
            .where(eq(pointsLedger.userId, userId)).orderBy(desc(pointsLedger.id)).limit(100),
        listCodes(db, inArray(licenseCodes.purchaseId, bought)),
    ])
    return { current: overview.current, periods, maxBotsOverride, points: { balance, history }, codes }
}

/** An admin's gift of time, queued like any other period, with the note kept on the period and in the audit log. */
export async function grantDays(db: Db, actorId: string, { userId, planId, days, note }: GrantDays): Promise<AdminPeriod> {
    return db.transaction(async tx => {
        await userExists(tx, userId)
        const period = await appendPeriod(tx, { userId, planId, days, source: "admin", grantedBy: actorId, note })
        await alertsChanged(tx, userId)
        await audit(tx, { actorId, action: "admin.billing.grant_days", targetType: "user", targetId: userId, meta: { planId, days, note, periodId: period.id } })
        const [granted] = await tx.select(adminPeriodColumns).from(planPeriods).leftJoin(users, eq(users.id, planPeriods.grantedBy)).where(eq(planPeriods.id, period.id))
        return granted!
    })
}

/** Cuts the period covering now short. Bots the user is no longer entitled to stop in the same transaction. */
export async function endPeriodNow(db: Db, actorId: string, userId: string) {
    return db.transaction(async tx => {
        await userExists(tx, userId)
        const ended = await endCurrentPeriod(tx, userId)
        if (!ended)
            return { ended: false }
        const stopped = await stopUnentitled(tx, userId)
        await alertsChanged(tx, userId)
        await audit(tx, { actorId, action: "admin.billing.end_period", targetType: "user", targetId: userId, meta: { periodId: ended.id, wasEnding: ended.endsAt, stopped } })
        return { ended: true }
    })
}

export async function setLimitOverride(db: Db, actorId: string, userId: string, maxBotsOverride: number | null) {
    await db.transaction(async tx => {
        const before = await userExists(tx, userId)
        await tx.update(users).set({ maxBotsOverride, updatedAt: new Date() }).where(eq(users.id, userId))
        const stopped = await stopUnentitled(tx, userId)
        await alertsChanged(tx, userId)
        await audit(tx, { actorId, action: "admin.user.limit_override", targetType: "user", targetId: userId, meta: { from: before.maxBotsOverride, to: maxBotsOverride, stopped } })
    })
}
