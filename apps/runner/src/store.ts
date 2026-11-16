import { eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { botChannel, userChannel, type BotChannelEvent, type UserEvent } from "@gge/contracts"
import { botLogs, botRuns, botStatus, centrifugoOutbox, gameAccounts, publish, publishMany, runnerHeartbeat, type Db } from "@gge/db"

export type ActualState = "starting" | "running" | "stopped" | "auth_failed" | "banned" | "error" | "crash_loop"
export type StatusPatch = {
    actualState?: ActualState
    lastError?: string | null
    bannedUntil?: Date | null
    resources?: unknown
    heartbeat?: boolean
}

const isMissingAccount = (error: unknown) =>
    ((error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code) === "23503"

export const LOG_RETENTION = { perAccount: 500, days: 7 }
/** Centrifugo deletes outbox rows as it delivers them. Older rows mean it is down, and its clients refetch on reconnect anyway. */
export const OUTBOX_MAX_AGE_MS = 3600_000

const logParts = (parts: unknown) => Array.isArray(parts) ? parts as (string | number)[] : null

export function createStore(db: Db, { flushMs = 500 } = {}) {
    let pending: { accountId: string; level: number; message: string; parts: unknown }[] = []
    let timer: NodeJS.Timeout | undefined

    async function insertLogs(batch: typeof pending) {
        const ids = new Set((await db.select({ id: gameAccounts.id }).from(gameAccounts)
            .where(inArray(gameAccounts.id, [...new Set(batch.map(l => l.accountId))]))).map(r => r.id))
        const rows = batch.filter(l => ids.has(l.accountId))
        if (!rows.length)
            return
        await db.transaction(async tx => {
            const inserted = await tx.insert(botLogs).values(rows).returning({ id: botLogs.id, accountId: botLogs.accountId, ts: botLogs.ts })
            await publishMany(tx, inserted.map((row, i) => ({
                channel: botChannel(row.accountId),
                data: {
                    v: 1, kind: "log", accountId: row.accountId,
                    line: { id: row.id, ts: row.ts, level: rows[i]!.level, message: rows[i]!.message, parts: logParts(rows[i]!.parts) },
                } satisfies BotChannelEvent,
            })))
        })
    }

    async function flushLogs() {
        clearTimeout(timer)
        timer = undefined
        const batch = pending
        pending = []
        if (!batch.length)
            return
        try {
            await insertLogs(batch)
        } catch (error) {
            // An account was deleted after the existence check; drop its lines, keep the rest.
            if (!isMissingAccount(error))
                return console.error("log flush failed", error)
            await insertLogs(batch).catch(e => console.error("log flush failed", e))
        }
    }

    return {
        async openRun(accountId: string) {
            const [run] = await db.insert(botRuns).values({ accountId }).returning({ id: botRuns.id }).catch(error => {
                if (isMissingAccount(error)) return [undefined]
                throw error
            })
            return run?.id
        },

        async closeRun(id: number | undefined, endReason: string, error?: string | null) {
            if (id !== undefined)
                await db.update(botRuns).set({ endedAt: new Date(), endReason, error: error ?? null }).where(eq(botRuns.id, id))
        },

        async setStatus(accountId: string, patch: StatusPatch) {
            const set = {
                ...(patch.actualState && { actualState: patch.actualState }),
                ...(patch.lastError !== undefined && { lastError: patch.lastError }),
                ...(patch.bannedUntil !== undefined && { bannedUntil: patch.bannedUntil }),
                ...(patch.resources !== undefined && { resources: patch.resources }),
                ...(patch.heartbeat && { heartbeatAt: new Date() }),
            }
            try {
                await db.transaction(async tx => {
                    const [status] = await tx.insert(botStatus).values({ accountId, ...set })
                        .onConflictDoUpdate({ target: botStatus.accountId, set }).returning()
                    const [account] = await tx.select({ ownerId: gameAccounts.ownerId }).from(gameAccounts).where(eq(gameAccounts.id, accountId))
                    await publish(tx, userChannel(account!.ownerId), {
                        v: 1, kind: "status", accountId,
                        status: { actualState: status!.actualState, heartbeatAt: status!.heartbeatAt, lastError: status!.lastError, bannedUntil: status!.bannedUntil },
                    } satisfies UserEvent)
                })
            } catch (error) {
                if (!isMissingAccount(error)) throw error
            }
        },

        /** Records that the bot is alive. No event: nothing a subscriber shows has changed, and every bot does this twice a minute. */
        async touchHeartbeat(accountId: string) {
            await db.update(botStatus).set({ heartbeatAt: new Date() }).where(eq(botStatus.accountId, accountId))
        },

        /** The runner itself decided this account must not run again until its owner acts. */
        async stopAccount(accountId: string) {
            await db.transaction(async tx => {
                const [account] = await tx.update(gameAccounts).set({ desiredState: "stopped", updatedAt: new Date() })
                    .where(eq(gameAccounts.id, accountId)).returning({ ownerId: gameAccounts.ownerId })
                if (account)
                    await publish(tx, userChannel(account.ownerId), { v: 1, kind: "account", accountId, desiredState: "stopped" } satisfies UserEvent)
            })
        },

        log(accountId: string, level: number, parts: unknown, message: string) {
            pending.push({ accountId, level, parts, message })
            if (pending.length >= 200)
                void flushLogs()
            else
                timer ??= setTimeout(() => void flushLogs(), flushMs)
        },
        flushLogs,

        async beat(startedAt: Date, version: string, running: number) {
            await db.insert(runnerHeartbeat).values({ id: 1, startedAt, beatAt: new Date(), version, running })
                .onConflictDoUpdate({ target: runnerHeartbeat.id, set: { startedAt, beatAt: sql`now()`, version, running } })
        },

        /** Runs and statuses a crashed runner left open; nothing is running at boot. */
        async recoverFromLastRun() {
            await db.update(botRuns).set({ endedAt: new Date(), endReason: "runner_lost" }).where(isNull(botRuns.endedAt))
            await db.update(botStatus).set({ actualState: "stopped" }).where(inArray(botStatus.actualState, ["starting", "running"]))
        },

        async pruneLogs({ perAccount, days } = LOG_RETENTION) {
            await db.delete(botLogs).where(lt(botLogs.ts, sql`now() - make_interval(days => ${days})`))
            await db.execute(sql`
                delete from ${botLogs} l using (
                    select id from (
                        select id, row_number() over (partition by account_id order by id desc) as n from ${botLogs}
                    ) ranked where n > ${perAccount}
                ) old where l.id = old.id`)
        },

        async pruneOutbox(maxAgeMs = OUTBOX_MAX_AGE_MS) {
            await db.delete(centrifugoOutbox).where(lt(centrifugoOutbox.createdAt, sql`now() - make_interval(secs => ${maxAgeMs / 1000})`))
        },
    }
}

export type Store = ReturnType<typeof createStore>
