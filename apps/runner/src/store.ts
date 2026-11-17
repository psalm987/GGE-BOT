import { eq, inArray, isNull, sql } from "drizzle-orm"
import { PROXY_MAX_FAILURES, botChannel, userChannel, type BotChannelEvent, type BotNotice, type NotificationContent, type PluginState, type UserEvent } from "@gge/contracts"
import {
    botLogs, botRuns, botStatus, gameAccounts, insertNotification, proxies, publicStatus, publish, publishMany, runnerHeartbeat, servers, type Db,
} from "@gge/db"
import { logTag } from "./log-render.ts"

export type ActualState = "starting" | "running" | "stopped" | "auth_failed" | "banned" | "error" | "crash_loop"
export type StatusPatch = {
    actualState?: ActualState
    lastError?: string | null
    bannedUntil?: Date | null
    resources?: unknown
    /** Only ever `{}`: a new run starts with no plugin states. */
    pluginStates?: Record<string, never>
    heartbeat?: boolean
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

export function createStore(db: Db, { flushMs = 500 } = {}) {
    let pending: { accountId: string; level: number; message: string; parts: unknown }[] = []
    let timer: NodeJS.Timeout | undefined

    async function insertLogs(batch: typeof pending) {
        const ids = new Set((await db.select({ id: gameAccounts.id }).from(gameAccounts)
            .where(inArray(gameAccounts.id, [...new Set(batch.map(l => l.accountId))]))).map(r => r.id))
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

    /** A worker's report with the time it arrived, so the dashboard can say how old the figures are. */
    const stamped = (resources: unknown) =>
        resources && typeof resources === "object" && !Array.isArray(resources) ? { ...resources, reportedAt: new Date().toISOString() } : resources

    const upsertStatus = (tx: Tx, accountId: string, patch: StatusPatch) => {
        const set = {
            ...(patch.actualState && { actualState: patch.actualState }),
            ...(patch.lastError !== undefined && { lastError: patch.lastError }),
            ...(patch.bannedUntil !== undefined && { bannedUntil: patch.bannedUntil }),
            ...(patch.resources !== undefined && { resources: stamped(patch.resources) }),
            ...(patch.pluginStates && { pluginStates: patch.pluginStates }),
            ...(patch.heartbeat && { heartbeatAt: new Date() }),
        }
        return tx.insert(botStatus).values({ accountId, ...set }).onConflictDoUpdate({ target: botStatus.accountId, set }).returning()
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
            await db.update(botStatus).set({ actualState: "stopped", pluginStates: {} }).where(inArray(botStatus.actualState, ["starting", "running"]))
        },
    }
}

export type Store = ReturnType<typeof createStore>
