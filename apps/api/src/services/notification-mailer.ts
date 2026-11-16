import { and, eq, gt, inArray, sql } from "drizzle-orm"
import type { FastifyBaseLogger } from "fastify"
import { describeNotification, notificationPrefs, type EmailState } from "@gge/contracts"
import { notifications, toNotification, users, type Db } from "@gge/db"
import { sendEmail } from "./email.ts"
import type { Mailer } from "./mailer.ts"

export const MAIL_WORKER = {
    pollMs: 15_000,
    /** A player's notifications wait until their newest is this old, so a burst goes out as one email. */
    settleSeconds: 30,
    /** A steady stream of new ones holds back the oldest no longer than this. */
    maxWaitSeconds: 5 * 60,
    /** A claim older than this was left by a mailer that died; another takes the row over. */
    leaseSeconds: 5 * 60,
    maxAttempts: 5,
    /** Notifications emailed to one player in any 24 hours. */
    dailyCap: 20,
    batch: 200,
}

type Row = typeof notifications.$inferSelect

/**
 * Emails players about their new notifications, one digest per player per round.
 * Each row leaves "pending" exactly once: "sent", "skipped" (email_error says why) or, after maxAttempts, "failed".
 * Several API processes may run this at once; a row is claimed by one of them.
 */
export function createNotificationMailer({ db, mailer, log, clientUrl }: { db: Db; mailer: Mailer; log: FastifyBaseLogger; clientUrl: string }) {
    const finish = (rows: Row[], emailState: EmailState, emailError: string | null) =>
        rows.length ? db.update(notifications)
            .set({ emailState, emailError, emailClaimedAt: null, ...(emailState === "sent" && { emailedAt: sql`now()` }) })
            .where(inArray(notifications.id, rows.map(row => row.id))) : undefined

    /** Takes the rows that are due and not in another mailer's hands. The claim is committed, so it outlives this statement. */
    const claim = () => db.update(notifications).set({ emailClaimedAt: sql`now()` })
        .where(inArray(notifications.id, db.select({ id: notifications.id }).from(notifications)
            .where(sql`${notifications.emailState} = 'pending'
                and (not exists (
                        select 1 from ${notifications} as newer
                        where newer.user_id = ${notifications.userId} and newer.email_state = 'pending'
                            and newer.created_at >= now() - make_interval(secs => ${MAIL_WORKER.settleSeconds}))
                    or ${notifications.createdAt} < now() - make_interval(secs => ${MAIL_WORKER.maxWaitSeconds}))
                and (${notifications.emailClaimedAt} is null or ${notifications.emailClaimedAt} < now() - make_interval(secs => ${MAIL_WORKER.leaseSeconds}))`)
            .orderBy(notifications.id).limit(MAIL_WORKER.batch).for("update", { skipLocked: true })))
        .returning()

    async function deliver(userId: string, rows: Row[]) {
        const [user] = await db.select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, status: users.status, prefs: users.notificationPrefs })
            .from(users).where(eq(users.id, userId))
        // The owner was deleted after the claim, and the rows went with them.
        if (!user)
            return
        if (user.status !== "active")
            return finish(rows, "skipped", "the user is disabled")
        if (!user.email || !user.emailVerifiedAt)
            return finish(rows, "skipped", "no verified email")

        const prefs = notificationPrefs(user.prefs)
        const wanted = rows.filter(row => prefs[toNotification(row).kind])
        await finish(rows.filter(row => !wanted.includes(row)), "skipped", "turned off in the user's settings")

        const [{ sentToday }] = await db.select({ sentToday: sql<number>`count(*)::int` }).from(notifications)
            .where(and(eq(notifications.userId, userId), eq(notifications.emailState, "sent"), gt(notifications.emailedAt, sql`now() - interval '24 hours'`))) as [{ sentToday: number }]
        const due = wanted.slice(0, Math.max(0, MAIL_WORKER.dailyCap - sentToday))
        await finish(wanted.slice(due.length), "skipped", `over the limit of ${MAIL_WORKER.dailyCap} emails a day`)
        if (!due.length)
            return

        const alerts = due.map(row => {
            const notification = toNotification(row)
            return { ...describeNotification(notification), server: notification.data.serverLabel }
        })
        if (await sendEmail({ db, mailer, log }, "bot_alerts", user.email, { alerts, link: clientUrl }, userId))
            return finish(due, "sent", null)
        const lastTry = sql`${notifications.emailAttempts} + 1 >= ${MAIL_WORKER.maxAttempts}`
        await db.update(notifications).set({
            emailAttempts: sql`${notifications.emailAttempts} + 1`,
            emailClaimedAt: null,
            emailError: "the email could not be delivered",
            emailState: sql`case when ${lastTry} then 'failed' else 'pending' end`,
        }).where(inArray(notifications.id, due.map(row => row.id)))
    }

    /** One round: every due notification is emailed, skipped, or left for a retry. */
    async function tick() {
        const claimed = await claim()
        for (const [userId, rows] of Map.groupBy(claimed, row => row.userId))
            await deliver(userId, rows.sort((a, b) => a.id - b.id))
        if (claimed.length)
            log.info({ notifications: claimed.length }, "notification emails handled")
    }

    let timer: NodeJS.Timeout | undefined
    let running: Promise<void> | undefined
    return {
        tick,
        start() {
            timer ??= setInterval(() => {
                running ??= tick().catch(error => log.error({ err: error }, "notification mailer failed")).finally(() => { running = undefined })
            }, MAIL_WORKER.pollMs)
        },
        /** Stops polling and waits for a round in progress. */
        async stop() {
            clearInterval(timer)
            timer = undefined
            await running
        },
    }
}

export type NotificationMailer = ReturnType<typeof createNotificationMailer>
