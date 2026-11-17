import { and, eq, gt, lte, max, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import type { NotificationContent, PlanPeriod } from "@gge/contracts"
import { insertNotification, isBillingLive, planPeriods, users, type Db } from "@gge/db"

const DAY_MS = 24 * 60 * 60 * 1000

export const PLAN_EXPIRY = {
    pollMs: 5 * 60_000,
    /** Days before the end of a player's cover that they are reminded, nearest first. */
    reminderDays: [1, 7],
    /** A plan that ended longer ago than this is not announced: the sweeper was off, or billing was. */
    expiredLookbackDays: 7,
    /** First key of the advisory lock a sweep takes per user; the second is the hash of the user id. */
    lockKey: 0x504c414e,
}

type Notice = NotificationContent & { dedupKey: string }

/**
 * What a player should hear at `now` about the end of their plan, from all their periods; null for nothing.
 * Cover is the run of back-to-back periods around `now`. A reminder goes out once its day count is reached, unless the
 * run was never that long, so a 7-day trial isn't told on its first day that it ends in 7 days. Only the nearest
 * reminder goes out. An ended run is announced unless another period is queued after a gap.
 * Each key carries the end, so time added later sets up the reminders again.
 */
function planNotice(periods: Pick<PlanPeriod, "startsAt" | "endsAt">[], now: Date): Notice | null {
    const at = now.getTime()
    const runs: { start: number; end: number }[] = []
    for (const { startsAt, endsAt } of periods.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
        const last = runs.at(-1)
        if (last && startsAt.getTime() <= last.end)
            last.end = Math.max(last.end, endsAt.getTime())
        else
            runs.push({ start: startsAt.getTime(), end: endsAt.getTime() })
    }
    const current = runs.find(run => run.start <= at && at < run.end)
    if (current) {
        const left = current.end - at
        const days = PLAN_EXPIRY.reminderDays.find(n => left <= n * DAY_MS && current.end - current.start > n * DAY_MS)
        if (days === undefined)
            return null
        const endsAt = new Date(current.end).toISOString()
        return { kind: "plan_expiring", data: { endsAt, daysLeft: Math.ceil(left / DAY_MS) }, dedupKey: `plan_expiring:${days}:${endsAt}` }
    }
    const last = runs.at(-1)
    if (!last || last.end > at || at - last.end > PLAN_EXPIRY.expiredLookbackDays * DAY_MS)
        return null
    const endedAt = new Date(last.end).toISOString()
    return { kind: "plan_expired", data: { endedAt }, dedupKey: `plan_expired:${endedAt}` }
}

/**
 * Tells players their plan is about to end, or has. It only notifies: the runner stops a player's bots at the end
 * of their cover and starts them again when time is added. Does nothing while billing is off.
 * Several API processes may run it at once; each player is handled by one of them at a time, and a notification
 * already sent is never sent again.
 */
export function createPlanExpirySweeper({ db, log }: { db: Db; log: FastifyBaseLogger }) {
    async function sweepUser(userId: string, now: Date) {
        return db.transaction(async tx => {
            const { rows: [lock] } = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${PLAN_EXPIRY.lockKey}, hashtext(${userId}::text)) as locked`)
            if (!lock?.locked)
                return false
            const periods = await tx.select({ startsAt: planPeriods.startsAt, endsAt: planPeriods.endsAt }).from(planPeriods).where(eq(planPeriods.userId, userId))
            const notice = planNotice(periods, now)
            return !!notice && !!await insertNotification(tx, { userId, ...notice })
        })
    }

    /** One round over every player whose cover ends within the reminder window or ended within the lookback. */
    async function tick(now = new Date()) {
        if (!await isBillingLive(db))
            return
        const lastEnd = max(planPeriods.endsAt)
        const due = await db.select({ userId: planPeriods.userId }).from(planPeriods)
            .innerJoin(users, eq(users.id, planPeriods.userId))
            .where(and(eq(users.role, "user"), eq(users.status, "active")))
            .groupBy(planPeriods.userId)
            .having(and(
                gt(lastEnd, new Date(now.getTime() - PLAN_EXPIRY.expiredLookbackDays * DAY_MS)),
                lte(lastEnd, new Date(now.getTime() + Math.max(...PLAN_EXPIRY.reminderDays) * DAY_MS)),
            ))
        let sent = 0
        for (const { userId } of due)
            if (await sweepUser(userId, now))
                sent++
        if (sent)
            log.info({ notifications: sent }, "plan expiry notifications sent")
    }

    let timer: NodeJS.Timeout | undefined
    let running: Promise<void> | undefined
    return {
        tick,
        start() {
            timer ??= setInterval(() => {
                running ??= tick().catch(error => log.error({ err: error }, "plan expiry sweep failed")).finally(() => { running = undefined })
            }, PLAN_EXPIRY.pollMs)
        },
        /** Stops sweeping and waits for a round in progress. */
        async stop() {
            clearInterval(timer)
            timer = undefined
            await running
        },
    }
}

export type PlanExpirySweeper = ReturnType<typeof createPlanExpirySweeper>
