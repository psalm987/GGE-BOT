import { and, desc, eq, gt, gte, lte, sql } from "drizzle-orm"
import type { PeriodSource, PlanId } from "@gge/contracts"
import { appSettings, planPeriods, users, type Db } from "@gge/db"

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">

const DAY_MS = 24 * 60 * 60 * 1000

/** Every write to a user's periods or points takes this first, so they take turns with each other and with the plan checks in accounts.ts. */
export async function lockUser(tx: Tx, userId: string) {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update")
    if (!user)
        throw new Error(`No user ${userId} to change the plan of`)
}

export type NewPeriod = {
    userId: string
    planId: PlanId
    days: number
    source: PeriodSource
    purchaseId?: string
    codeId?: string
    grantedBy?: string
    note?: string
}

/**
 * The one way to give a user time on a plan. The period starts where their last one ends, or at `now` when
 * that has passed, so periods queue and never overlap. Call it in the transaction that pays for the time.
 * A second "trial" for one user is refused by the plan_periods_one_trial index.
 */
export async function appendPeriod(tx: Tx, { userId, days, ...period }: NewPeriod, now = new Date()) {
    await lockUser(tx, userId)
    const [last] = await tx.select({ endsAt: planPeriods.endsAt }).from(planPeriods)
        .where(eq(planPeriods.userId, userId)).orderBy(desc(planPeriods.endsAt)).limit(1)
    const startsAt = last && last.endsAt > now ? last.endsAt : now
    const [row] = await tx.insert(planPeriods)
        .values({ ...period, userId, startsAt, endsAt: new Date(startsAt.getTime() + days * DAY_MS) }).returning()
    return row!
}

/**
 * Gives the user their one free trial, queued like any other period. Returns undefined, and changes nothing, when
 * they have had it. Callers decide whether billing is live.
 */
export async function grantTrial(tx: Tx, userId: string, now = new Date()) {
    await lockUser(tx, userId)
    const [had] = await tx.select({ id: planPeriods.id }).from(planPeriods)
        .where(and(eq(planPeriods.userId, userId), eq(planPeriods.source, "trial")))
    if (had)
        return undefined
    const [settings] = await tx.select({ trialDays: appSettings.trialDays }).from(appSettings)
    return appendPeriod(tx, { userId, planId: "basic", days: settings?.trialDays ?? 7, source: "trial" }, now)
}

/**
 * Ends the period the user is in at `now` and moves every period queued behind it earlier by the time cut off,
 * so the next one starts at `now` and the queue keeps no gap. Returns the period as it was, or undefined when
 * the user is in none, which also makes a repeat do nothing.
 */
export async function endCurrentPeriod(tx: Tx, userId: string, now = new Date()) {
    await lockUser(tx, userId)
    const [current] = await tx.select().from(planPeriods)
        .where(and(eq(planPeriods.userId, userId), lte(planPeriods.startsAt, now), gt(planPeriods.endsAt, now)))
    if (!current)
        return undefined
    // A period that starts exactly now would be left with no length, which the table refuses.
    if (current.startsAt.getTime() === now.getTime())
        await tx.delete(planPeriods).where(eq(planPeriods.id, current.id))
    else
        await tx.update(planPeriods).set({ endsAt: now }).where(eq(planPeriods.id, current.id))
    const cut = sql`make_interval(secs => ${(current.endsAt.getTime() - now.getTime()) / 1000})`
    await tx.update(planPeriods)
        .set({ startsAt: sql`${planPeriods.startsAt} - ${cut}`, endsAt: sql`${planPeriods.endsAt} - ${cut}` })
        .where(and(eq(planPeriods.userId, userId), gte(planPeriods.startsAt, current.endsAt)))
    return current
}
