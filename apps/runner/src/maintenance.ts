import { and, isNotNull, lt, or, sql, type SQL } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import {
    auditLog, botLogs, botRuns, centrifugoOutbox, emailTokens, loginChallenges, notifications, sessions, type Db,
} from "@gge/db"

export const LOG_RETENTION = { perAccount: 500, days: 7 }
/** Centrifugo deletes outbox rows as it delivers them. Older rows mean it is down, and its clients refetch on reconnect anyway. */
export const OUTBOX_MAX_AGE_MS = 3600_000
/** A read notification is kept this long, and any notification no longer than `anyDays`. */
export const NOTIFICATION_RETENTION = { readDays: 30, anyDays: 180 }
export const EMAIL_TOKEN_GRACE_DAYS = 1
export const RUN_RETENTION_DAYS = 90
/** Rows one delete statement may remove, so an hour's prune never holds a long lock. */
export const PRUNE_BATCH = 5000

export type Prune = { name: string; run: () => Promise<number> }

const ago = (unit: "days" | "secs", n: number) => sql`now() - make_interval(${sql.raw(unit)} => ${n})`

type WithId = PgTable & { id: unknown }

/** Deletes the rows `where` selects, `batch` at a time, and returns how many went. */
async function purge(db: Db, table: WithId, where: SQL, batch: number) {
    let total = 0
    for (;;) {
        const { rowCount } = await db.execute(sql`delete from ${table} where id in (select id from ${table} where ${where} limit ${batch})`)
        total += rowCount ?? 0
        if ((rowCount ?? 0) < batch)
            return total
    }
}

export const prunes = (db: Db, { auditDays = 365, batch = PRUNE_BATCH } = {}): Prune[] => [
    { name: "sessions", run: () => purge(db, sessions, lt(sessions.expiresAt, sql`now()`), batch) },
    { name: "email_tokens", run: () => purge(db, emailTokens, lt(emailTokens.expiresAt, ago("days", EMAIL_TOKEN_GRACE_DAYS)), batch) },
    { name: "login_challenges", run: () => purge(db, loginChallenges, lt(loginChallenges.expiresAt, sql`now()`), batch) },
    { name: "audit_log", run: () => purge(db, auditLog, lt(auditLog.ts, ago("days", auditDays)), batch) },
    {
        name: "bot_runs",
        run: () => purge(db, botRuns, and(lt(botRuns.startedAt, ago("days", RUN_RETENTION_DAYS)), isNotNull(botRuns.endedAt))!, batch),
    },
    { name: "bot_logs_old", run: () => purge(db, botLogs, lt(botLogs.ts, ago("days", LOG_RETENTION.days)), batch) },
    {
        name: "bot_logs_over_cap",
        run: () => purge(db, botLogs, sql`id in (
            select id from (select id, row_number() over (partition by account_id order by id desc) as n from ${botLogs}) ranked
            where n > ${LOG_RETENTION.perAccount})`, batch),
    },
    {
        name: "notifications",
        run: () => purge(db, notifications, or(
            and(isNotNull(notifications.readAt), lt(notifications.createdAt, ago("days", NOTIFICATION_RETENTION.readDays))),
            lt(notifications.createdAt, ago("days", NOTIFICATION_RETENTION.anyDays)),
        )!, batch),
    },
    { name: "centrifugo_outbox", run: () => purge(db, centrifugoOutbox, lt(centrifugoOutbox.createdAt, ago("secs", OUTBOX_MAX_AGE_MS / 1000)), batch) },
]

/** Runs every prune in order. One that throws is logged and the rest still run. */
export async function runPrunes(list: Prune[], log: Pick<Console, "log" | "error"> = console) {
    const deleted: Record<string, number> = {}
    for (const { name, run } of list)
        try {
            deleted[name] = await run()
        } catch (error) {
            log.error(`prune ${name} failed`, error)
        }
    const total = Object.values(deleted).reduce((a, b) => a + b, 0)
    if (total)
        log.log(`pruned ${total} rows: ${Object.entries(deleted).filter(([, n]) => n).map(([name, n]) => `${name} ${n}`).join(", ")}`)
    return deleted
}
