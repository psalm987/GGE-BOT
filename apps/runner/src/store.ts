import { createRequire } from "node:module"
import { and, asc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm"
import {
    PLUGIN_MEMORY_MAX_BYTES, PROBLEMS_KEPT, PROXY_MAX_FAILURES, botChannel, userChannel,
    type BotChannelEvent, type BotNotice, type GameRefusal, type NotificationContent, type PluginFinishReason, type PluginMemory, type PluginMemoryWrite, type PluginState, type UserEvent,
} from "@gge/contracts"
import {
    botLogs, botProblems, botRuns, botStatus, gameAccounts, insertNotification, pluginMemory, pluginSettings, proxies, publicStatus, publish, publishMany, runnerHeartbeat, servers, type Db,
} from "@gge/db"
import type { StoredSession } from "./farm-session.ts"
import { logTag } from "./log-render.ts"

const { TOWER_LOG_TAG, readTowerAttack } = createRequire(import.meta.url)("@gge/bot-core/attackLog.js") as {
    TOWER_LOG_TAG: string
    readTowerAttack(parts: unknown): { plugin: string; tools: number } | null
}

/** The attacks a tower plugin sent lately, each with the time it was logged (ms) and the tools it carried. By plugin key. */
export type AttackHistory = Record<string, { at: number; tools: number }[]>
const HISTORY_MS = 24 * 60 * 60_000

export type ActualState = "starting" | "running" | "stopped" | "auth_failed" | "banned" | "error" | "crash_loop"
export type StatusPatch = {
    actualState?: ActualState
    lastError?: string | null
    bannedUntil?: Date | null
    resources?: unknown
    /** Only ever `{}`: a new run starts with no plugin states. */
    pluginStates?: Record<string, never>
    heartbeat?: boolean
    /** The session as the supervisor counts it. A write never reopens the same session once it has ended. */
    session?: StoredSession
    /** The player stopped the bot, or the runner did for good: the open session ends now. */
    endSession?: true
}

type Detail<C> = C extends { kind: infer K; data: infer D } ? { kind: K } & Omit<D, "accountName" | "serverLabel"> : never
/** What to tell the owner about a run that ended: the kind and its details. The store adds the account's name and server. */
export type EndNotice = Detail<NotificationContent>

/** How an account that the runner itself stops is left. A status is written only when `actualState` is given. */
export type AccountEnding = Pick<StatusPatch, "actualState" | "lastError" | "bannedUntil"> & {
    /** `runId` is the run that ended, so a second report of the same ending is recognised. */
    notification: EndNotice & { runId: number | undefined }
}

const isMissingAccount = (error: unknown) =>
    ((error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code) === "23503"

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

const logParts = (parts: unknown) => Array.isArray(parts) ? parts as (string | number)[] : null

/** One plugin's request refused with one error, as often as it came between two flushes. */
type ProblemRow = Omit<GameRefusal, "at"> & { accountId: string; count: number; firstAt: Date; lastAt: Date }
type Batch = { logs: { accountId: string; level: number; message: string; parts: unknown }[]; problems: Map<string, ProblemRow> }
const emptyBatch = (): Batch => ({ logs: [], problems: new Map() })

export function createStore(db: Db, { flushMs = 500 } = {}) {
    let pending = emptyBatch()
    let timer: NodeJS.Timeout | undefined

    const existing = async (accountIds: string[]) => new Set((await db.select({ id: gameAccounts.id }).from(gameAccounts)
        .where(inArray(gameAccounts.id, [...new Set(accountIds)]))).map(r => r.id))

    async function insertLogs(batch: Batch["logs"]) {
        const ids = await existing(batch.map(l => l.accountId))
        const rows = batch.filter(l => ids.has(l.accountId)).map(l => ({ ...l, plugin: logTag(l.parts) }))
        if (!rows.length)
            return
        await db.transaction(async tx => {
            const inserted = await tx.insert(botLogs).values(rows).returning({ id: botLogs.id, accountId: botLogs.accountId, ts: botLogs.ts })
            await publishMany(tx, inserted.map((row, i) => ({
                channel: botChannel(row.accountId),
                data: {
                    v: 1, kind: "log", accountId: row.accountId,
                    line: { id: row.id, ts: row.ts, level: rows[i]!.level, message: rows[i]!.message, parts: logParts(rows[i]!.parts), plugin: rows[i]!.plugin },
                } satisfies BotChannelEvent,
            })))
        })
    }

    /** Adds the batch's counts to each account's problems, then forgets all but the PROBLEMS_KEPT seen most lately. */
    async function upsertProblems(batch: Batch["problems"]) {
        const ids = await existing([...batch.values()].map(p => p.accountId))
        const rows = [...batch.values()].filter(p => ids.has(p.accountId))
        if (!rows.length)
            return
        await db.transaction(async tx => {
            await tx.insert(botProblems).values(rows).onConflictDoUpdate({
                target: [botProblems.accountId, botProblems.plugin, botProblems.command, botProblems.error],
                set: { count: sql`${botProblems.count} + excluded.count`, lastAt: sql`greatest(${botProblems.lastAt}, excluded.last_at)` },
            })
            const ranked = tx.select({ id: botProblems.id, rank: sql<number>`row_number() over (partition by ${botProblems.accountId} order by ${botProblems.lastAt} desc, ${botProblems.id} desc)`.as("rank") })
                .from(botProblems).where(inArray(botProblems.accountId, [...new Set(rows.map(p => p.accountId))])).as("ranked")
            await tx.delete(botProblems).where(inArray(botProblems.id, tx.select({ id: ranked.id }).from(ranked).where(gt(ranked.rank, PROBLEMS_KEPT))))
        })
    }

    /** Writes one part of a batch. An account deleted after the existence check fails it once; the retry leaves that account out. */
    async function write<T>(what: string, part: T, insert: (part: T) => Promise<void>) {
        try {
            await insert(part)
        } catch (error) {
            if (!isMissingAccount(error))
                return console.error(`${what} flush failed`, error)
            await insert(part).catch(e => console.error(`${what} flush failed`, e))
        }
    }

    async function writeBatch({ logs, problems }: Batch) {
        if (logs.length)
            await write("log", logs, insertLogs)
        if (problems.size)
            await write("problem", problems, upsertProblems)
    }

    // Flushes run one after another, so a caller that awaits flush (recentAttacks, shutdown) also waits for a
    // flush the timer already started, instead of reading the tables before those rows are committed.
    let flushing: Promise<void> = Promise.resolve()
    function flush() {
        clearTimeout(timer)
        timer = undefined
        const batch = pending
        pending = emptyBatch()
        flushing = flushing.then(() => writeBatch(batch))
        return flushing
    }
    const flushSoon = () => {
        if (pending.logs.length >= 200)
            void flush()
        else
            timer ??= setTimeout(() => void flush(), flushMs)
    }

    /** A worker's report with the time it arrived, so the dashboard can say how old the figures are. */
    const stamped = (resources: unknown) =>
        resources && typeof resources === "object" && !Array.isArray(resources) ? { ...resources, reportedAt: new Date().toISOString() } : resources

    /** The stored session, unless it is this same session already ended: a report still in flight when the bot stopped doesn't reopen it. */
    const sessionWrite = (session: StoredSession) => sql`case
        when ${botStatus.session}->>'endedAt' is not null and (${botStatus.session}->>'startedAt')::bigint = ${session.startedAt} then ${botStatus.session}
        else excluded.session end`
    /** The open session ended now; an ended one, or none, stays as it is. */
    const sessionEnd = () => sql`case
        when ${botStatus.session} is not null and ${botStatus.session}->>'endedAt' is null then jsonb_set(${botStatus.session}, '{endedAt}', to_jsonb(${Date.now()}::bigint))
        else ${botStatus.session} end`

    const upsertStatus = (tx: Tx, accountId: string, patch: StatusPatch) => {
        const set = {
            ...(patch.actualState && { actualState: patch.actualState }),
            ...(patch.lastError !== undefined && { lastError: patch.lastError }),
            ...(patch.bannedUntil !== undefined && { bannedUntil: patch.bannedUntil }),
            ...(patch.resources !== undefined && { resources: stamped(patch.resources) }),
            ...(patch.pluginStates && { pluginStates: patch.pluginStates }),
            ...(patch.heartbeat && { heartbeatAt: new Date() }),
        }
        const session = patch.endSession ? sessionEnd() : patch.session && sessionWrite(patch.session)
        return tx.insert(botStatus).values({ accountId, ...set, ...(patch.session && !patch.endSession && { session: patch.session }) })
            .onConflictDoUpdate({ target: botStatus.accountId, set: { ...set, ...(session && { session }) } }).returning()
    }
    const statusEvent = (status: typeof botStatus.$inferSelect): UserEvent => ({
        v: 1, kind: "status", accountId: status.accountId,
        status: publicStatus(status),
    })

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
            try {
                await db.transaction(async tx => {
                    const [status] = await upsertStatus(tx, accountId, patch)
                    const [account] = await tx.select({ ownerId: gameAccounts.ownerId }).from(gameAccounts).where(eq(gameAccounts.id, accountId))
                    await publish(tx, userChannel(account!.ownerId), statusEvent(status!))
                })
            } catch (error) {
                if (!isMissingAccount(error)) throw error
            }
        },

        /**
         * Each tower plugin's attacks of the last 24 hours, oldest first, read from the log lines kept for the account.
         * A starting bot counts them against its daily limits, so a restart doesn't hand the limits back. Lines the
         * log's retention has dropped are not counted.
         */
        async recentAttacks(accountId: string, now = Date.now()): Promise<AttackHistory> {
            await flush()
            const rows = await db.select({ ts: botLogs.ts, parts: botLogs.parts }).from(botLogs)
                .where(and(eq(botLogs.accountId, accountId), eq(botLogs.plugin, TOWER_LOG_TAG), gte(botLogs.ts, new Date(now - HISTORY_MS))))
                .orderBy(asc(botLogs.id))
            const history: AttackHistory = {}
            for (const row of rows) {
                const attack = readTowerAttack(row.parts)
                if (attack)
                    (history[attack.plugin] ??= []).push({ at: row.ts.getTime(), tools: attack.tools })
            }
            return history
        },

        /** The account's stored session with its readings; the supervisor decides whether a starting bot carries on with it. */
        async session(accountId: string): Promise<unknown> {
            const [row] = await db.select({ session: botStatus.session }).from(botStatus).where(eq(botStatus.accountId, accountId))
            return row?.session
        },

        /**
         * The day's wheel spins in the account's last status report (plugins/wheelSpin.js checks the day). A starting bot
         * carries on from it, so a restart doesn't hand the daily spin limit back. Undefined when nothing was reported.
         */
        async wheelSpins(accountId: string): Promise<unknown> {
            const [row] = await db.select({ resources: botStatus.resources }).from(botStatus).where(eq(botStatus.accountId, accountId))
            return (row?.resources as { wheelSpins?: unknown } | null | undefined)?.wheelSpins
        },

        /** What each plugin kept on the account in earlier runs, which a starting bot is handed. */
        async pluginMemory(accountId: string): Promise<PluginMemory> {
            const rows = await db.select({ plugin: pluginMemory.plugin, data: pluginMemory.data }).from(pluginMemory).where(eq(pluginMemory.accountId, accountId))
            return Object.fromEntries(rows.map(row => [row.plugin, row.data])) as PluginMemory
        },

        /**
         * Keeps one plugin's value under its key, or forgets the key for a null value. Refused, leaving the memory as it
         * was, when the plugin's memory would pass PLUGIN_MEMORY_MAX_BYTES as JSON text, which the bot measures the same
         * way. Also false for a deleted account.
         */
        async rememberForPlugin(accountId: string, { plugin, key, value }: PluginMemoryWrite): Promise<boolean> {
            const fits = (data: object) => Buffer.byteLength(JSON.stringify(data)) <= PLUGIN_MEMORY_MAX_BYTES
            // Checked before the row exists too, so a refused first write leaves no empty memory behind.
            if (!fits({ [key]: value }))
                return false
            try {
                return await db.transaction(async tx => {
                    await tx.insert(pluginMemory).values({ accountId, plugin }).onConflictDoNothing()
                    const [row] = await tx.select({ data: pluginMemory.data }).from(pluginMemory)
                        .where(and(eq(pluginMemory.accountId, accountId), eq(pluginMemory.plugin, plugin))).for("update")
                    const { [key]: _, ...rest } = row!.data
                    const data = value === null ? rest : { ...rest, [key]: value }
                    if (!fits(data))
                        return false
                    await tx.update(pluginMemory).set({ data, updatedAt: new Date() })
                        .where(and(eq(pluginMemory.accountId, accountId), eq(pluginMemory.plugin, plugin)))
                    return true
                })
            } catch (error) {
                if (!isMissingAccount(error)) throw error
                return false
            }
        },

        /** Merges one plugin's report into the account's states and tells the owner, in one statement and one transaction. */
        async setPluginState(accountId: string, plugin: string, state: PluginState) {
            try {
                await db.transaction(async tx => {
                    const [status] = await tx.insert(botStatus)
                        .values({ accountId, pluginStates: { [plugin]: state } })
                        .onConflictDoUpdate({
                            target: botStatus.accountId,
                            set: { pluginStates: sql`${botStatus.pluginStates} || jsonb_build_object(${plugin}::text, ${JSON.stringify(state)}::jsonb)` },
                        })
                        .returning()
                    const [account] = await tx.select({ ownerId: gameAccounts.ownerId }).from(gameAccounts).where(eq(gameAccounts.id, accountId))
                    await publish(tx, userChannel(account!.ownerId), statusEvent(status!))
                })
            } catch (error) {
                if (!isMissingAccount(error)) throw error
            }
        },

        /** Records that the bot is alive. No event: nothing a subscriber shows has changed, and every bot does this twice a minute. */
        async touchHeartbeat(accountId: string) {
            await db.update(botStatus).set({ heartbeatAt: new Date() }).where(eq(botStatus.accountId, accountId))
        },

        /**
         * The runner itself decided this account must not run again until its owner acts.
         * Saves the status (when one is given), stops the account and notifies the owner, all or nothing.
         * Reporting the same run's ending twice notifies once. A deleted account is left alone.
         */
        async endAccount(accountId: string, { notification, ...status }: AccountEnding) {
            await db.transaction(async tx => {
                const [account] = await tx.update(gameAccounts).set({ desiredState: "stopped", updatedAt: new Date() })
                    .where(eq(gameAccounts.id, accountId))
                    .returning({ ownerId: gameAccounts.ownerId, name: gameAccounts.name, serverId: gameAccounts.serverId })
                if (!account)
                    return
                const channel = userChannel(account.ownerId)
                await tx.update(botStatus).set({ session: sessionEnd() }).where(eq(botStatus.accountId, accountId))
                if (status.actualState)
                    await publish(tx, channel, statusEvent((await upsertStatus(tx, accountId, status))[0]!))
                await publish(tx, channel, { v: 1, kind: "account", accountId, desiredState: "stopped" } satisfies UserEvent)

                const [server] = await tx.select({ label: servers.label }).from(servers).where(eq(servers.id, account.serverId))
                const { runId, kind, ...details } = notification
                // The details are the ones `kind` calls for; taking them apart loses that pairing for the compiler.
                const content = { kind, data: { ...details, accountName: account.name, serverLabel: server!.label } } as NotificationContent
                await insertNotification(tx, {
                    ...content, userId: account.ownerId, accountId,
                    // Without a run there is nothing to recognise a repeat by, so each report stands alone.
                    dedupKey: `${kind}:${accountId}:${runId ?? `at-${Date.now()}`}`,
                })
            })
        },

        /**
         * A running bot asked to tell the account's owner something. The store adds the account's name and server.
         * The same notice key for the same account notifies once. A deleted account is left alone.
         */
        async notifyOwner(accountId: string, { kind, key, data }: BotNotice) {
            await db.transaction(async tx => {
                const [account] = await tx.select({ ownerId: gameAccounts.ownerId, name: gameAccounts.name, label: servers.label })
                    .from(gameAccounts).innerJoin(servers, eq(servers.id, gameAccounts.serverId)).where(eq(gameAccounts.id, accountId))
                if (!account)
                    return
                const content = { kind, data: { ...data, accountName: account.name, serverLabel: account.label } } as NotificationContent
                await insertNotification(tx, { ...content, userId: account.ownerId, accountId, dedupKey: `${kind}:${accountId}:${key}` })
            })
        },

        /**
         * An event plugin is done: it is switched off in the account's saved settings, the ones the player edits, and the
         * owner is told. A plugin that is off already, or a deleted account, is left alone.
         */
        async finishPlugin(accountId: string, plugin: string, reason: PluginFinishReason) {
            await db.transaction(async tx => {
                const [switched] = await tx.update(pluginSettings).set({ enabled: false })
                    .where(and(eq(pluginSettings.accountId, accountId), eq(pluginSettings.pluginKey, plugin), eq(pluginSettings.enabled, true)))
                    .returning({ accountId: pluginSettings.accountId })
                if (!switched)
                    return
                const [account] = await tx.select({ ownerId: gameAccounts.ownerId, name: gameAccounts.name, label: servers.label })
                    .from(gameAccounts).innerJoin(servers, eq(servers.id, gameAccounts.serverId)).where(eq(gameAccounts.id, accountId))
                await insertNotification(tx, {
                    kind: "plugin_finished", data: { plugin, reason, accountName: account!.name, serverLabel: account!.label },
                    userId: account!.ownerId, accountId,
                    // Only the write that switched it off gets here, so each switch-off is its own event.
                    dedupKey: `plugin_finished:${accountId}:${plugin}:${Date.now()}`,
                })
            })
        },

        /** A bot logged in through this proxy, which ends its run of failures. */
        async proxyOk(proxyId: string) {
            await db.update(proxies).set({ consecutiveFailures: 0, lastOkAt: new Date() }).where(eq(proxies.id, proxyId))
        },

        /**
         * A bot couldn't connect through this proxy. The proxy is turned off at PROXY_MAX_FAILURES in a row.
         * With `counts` false the error is recorded and the count stays where it is.
         */
        async proxyFailed(proxyId: string, error: string, { counts }: { counts: boolean }) {
            await db.transaction(async tx => {
                const [proxy] = await tx.update(proxies)
                    .set({ lastError: error, lastErrorAt: new Date(), ...(counts && { consecutiveFailures: sql`${proxies.consecutiveFailures} + 1` }) })
                    .where(eq(proxies.id, proxyId))
                    .returning({ failures: proxies.consecutiveFailures, enabled: proxies.enabled })
                // A separate write, so only the one that turns the proxy off touches `enabled` and wakes the runner.
                if (proxy?.enabled && proxy.failures >= PROXY_MAX_FAILURES)
                    await tx.update(proxies)
                        .set({ enabled: false, disabledReason: `Turned off after ${proxy.failures} failed connections in a row: ${error}`, updatedAt: new Date() })
                        .where(eq(proxies.id, proxyId))
            })
        },

        log(accountId: string, level: number, parts: unknown, message: string) {
            pending.logs.push({ accountId, level, parts, message })
            flushSoon()
        },

        /** The game refused one of the account's requests. Repeats before the next flush are counted, not written one by one. */
        noteRefusal(accountId: string, { plugin, command, error, at }: GameRefusal) {
            const key = JSON.stringify([accountId, plugin, command, error])
            const when = new Date(at)
            const known = pending.problems.get(key)
            if (known) {
                known.count++
                if (when > known.lastAt) known.lastAt = when
                if (when < known.firstAt) known.firstAt = when
            } else
                pending.problems.set(key, { accountId, plugin, command, error, count: 1, firstAt: when, lastAt: when })
            flushSoon()
        },
        flush,

        async beat(startedAt: Date, version: string, running: number) {
            await db.insert(runnerHeartbeat).values({ id: 1, startedAt, beatAt: new Date(), version, running })
                .onConflictDoUpdate({ target: runnerHeartbeat.id, set: { startedAt, beatAt: sql`now()`, version, running } })
        },

        /** Runs and statuses a crashed runner left open; nothing is running at boot. */
        async recoverFromLastRun() {
            await db.update(botRuns).set({ endedAt: new Date(), endReason: "runner_lost" }).where(isNull(botRuns.endedAt))
            await db.update(botStatus).set({ actualState: "stopped", pluginStates: {} }).where(inArray(botStatus.actualState, ["starting", "running"]))
        },
    }
}

export type Store = ReturnType<typeof createStore>
