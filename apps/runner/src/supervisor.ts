import { createRequire } from "node:module"
import type { BotSpec, Wanted } from "./specs.ts"
import type { AccountEnding, EndNotice, StatusPatch } from "./store.ts"
import { resolveEventServer, type EventData } from "./event-server.ts"

const require = createRequire(import.meta.url)
const Action = require("@gge/bot-core/actions.json") as Record<string, number>

/** The part of worker_threads.Worker the supervisor uses. */
export interface WorkerLike {
    postMessage(message: unknown): void
    terminate(): Promise<number>
    on(event: "message", listener: (message: unknown[]) => void): this
    on(event: "error", listener: (error: Error) => void): this
    once(event: "exit", listener: (code: number) => void): this
    off(event: "message", listener: (message: unknown[]) => void): this
    getHeapStatistics?(): Promise<{ used_heap_size: number }>
}

/** `schedule` is a stop because the account's run window closed; the account is still wanted. */
export type EndReason = "stopped" | "restart" | "crash" | "error" | "stale" | "banned" | "auth_failed" | "shutoff" | "deploy" | "runner_lost" | "schedule"

/** The status a stop on purpose leaves. An error from the window that just closed says nothing about the next one. */
const stoppedBy = (reason: EndReason): StatusPatch => reason === "schedule" ? { actualState: "stopped", lastError: null } : { actualState: "stopped" }

type Terminal = { state: "banned" | "auth_failed"; reason: string; bannedUntil?: number }

/** Why a run is ending on its own, learned before the worker's exit is handled. */
type Failure = { endReason: "error" | "stale"; message: string }

const CRASHED = "The bot stopped unexpectedly"
const STOPPED_RESPONDING = "The bot stopped responding"
const EVENT_SERVER_NOT_FOUND = "Couldn't find the event server"

/**
 * Whose fault an unexpected end is, which decides whether it counts toward
 * giving up on the account. Only "account" counts, and even then not while
 * the fleet is failing together, so a bad deploy doesn't stop every bot.
 */
export type Blame = "account" | "outside"

/** A worker's reason for failing to reach or sign in to its proxy starts with this. */
const PROXY_FAILURE = "PROXY_"

/**
 * Failures the account can't cause: the game, the network, the client version,
 * the event server or a proxy. They retry with backoff forever, so a game
 * outage never stops a player's bot.
 */
const OUTSIDE = {
    exact: ["CLIENT_VERSION_REJECTED", EVENT_SERVER_NOT_FOUND, "CONNECTION_STALE", "LOGIN_TIMEOUT", "TOO_MANY_TIMEOUTS"],
    prefixes: [PROXY_FAILURE, "SOCKET_ERROR:"],
}

/** The short-lived worker that looks up the event server stopped, for the reason it reported. */
class ProbeFailed extends Error {
    readonly reason: string
    constructor(reason: string) {
        super(`the event server probe stopped: ${reason}`)
        this.reason = reason
    }
}

export function blameFor(why: string): Blame {
    return OUTSIDE.exact.includes(why) || OUTSIDE.prefixes.some(prefix => why.startsWith(prefix)) ? "outside" : "account"
}

/** How often checkLiveness expects to be called, and what it tolerates. */
export const LIVENESS = { intervalMs: 30_000, staleMs: 90_000, maxLagMs: 15_000 }

/**
 * An account is given up on after `failures` counted failures in a row over at
 * least `minAgeMs`. A fleet outage puts that on hold: at least `outageMinBots`
 * accounts ended early within `outageWindowMs`, and they are at least
 * `outageShare` of the accounts started in that window.
 */
export const GIVE_UP = { failures: 8, minAgeMs: 30 * 60_000, outageWindowMs: 10 * 60_000, outageMinBots: 5, outageShare: 0.5 }

type Bot = {
    spec: BotSpec
    worker?: WorkerLike
    startedAt?: number
    /** When the current worker last sent anything. */
    lastBeat?: number
    /** Unexpected exits in a row, which set the retry delay; reset once a run lasts stableMs. */
    attempt: number
    retryTimer?: NodeJS.Timeout
    terminal?: Terminal
    failure?: Failure
    /** The proxy the newest worker connects through, which its outcome is reported against. */
    proxyId?: string
    /** The newest run's id, which names that run's ending in a notification. */
    runId?: Promise<number | undefined>
    /** Settles once the current worker's exit has been recorded. */
    exited?: Promise<void>
}

export type SupervisorDeps = {
    spawn: (workerData: Record<string, unknown>) => WorkerLike
    store: {
        openRun(accountId: string): Promise<number | undefined>
        closeRun(id: number | undefined, reason: string, error?: string | null): Promise<void>
        setStatus(accountId: string, patch: StatusPatch): Promise<void>
        touchHeartbeat(accountId: string): Promise<void>
        endAccount(accountId: string, ending: AccountEnding): Promise<void>
        proxyOk(proxyId: string): Promise<void>
        proxyFailed(proxyId: string, error: string, options: { counts: boolean }): Promise<void>
        log(accountId: string, level: number, parts: unknown, message: string): void
    }
    /** Opens a sealed game password or proxy URL. */
    openSealed: (sealed: Buffer) => string
    renderLog: (parts: unknown) => string
    ggeConfig: Record<string, unknown>
    startGapMs: number
    maxAccounts: number
    backoff?: { baseMs: number; maxMs: number }
    /** A run this long is healthy: what came before it is forgotten. */
    stableMs?: number
    liveness?: Partial<typeof LIVENESS>
    giveUp?: Partial<typeof GIVE_UP>
    eventTimeoutMs?: number
    /** The clock, in ms since the epoch. */
    now?: () => number
    logger?: Pick<Console, "warn" | "error">
    /** Receives each worker's metric batch. */
    onMetrics?: (batch: never) => void
}

export function workerDataFor(spec: BotSpec, password: string, ggeConfig: Record<string, unknown>, proxyUrl?: string) {
    return {
        ...(proxyUrl && { proxyUrl }),
        name: spec.name,
        pass: password,
        gameURL: spec.host,
        gameServer: spec.zone,
        gameID: spec.serverId,
        externalEvent: spec.externalEvent,
        plugins: spec.plugins,
        ggeConfig,
    }
}

/**
 * Owns one worker per account the database wants running. reconcile() moves
 * toward the wanted set; worker messages and exits move each bot through
 * starting, running, stopped, and retry-with-backoff.
 */
export class Supervisor {
    readonly bots = new Map<string, Bot>()
    private queue: string[] = []
    private draining: Promise<void> | undefined
    /** Wanted accounts left unstarted for lack of room, told so once. */
    private readonly atCapacity = new Set<string>()
    private readonly refused = new Set<string>()
    /**
     * Failures in a row that count toward giving up, by account id. A streak outlives the bot, so sleeping between
     * run windows doesn't end it. It ends when a run lasts stableMs, the account's login changes, the account is
     * no longer wanted, or the runner gives up.
     */
    private readonly streaks = new Map<string, { count: number; since: number; restartKey: string }>()
    /** Sleeping accounts whose stale error is being cleared right now. */
    private readonly clearing = new Set<string>()
    /** Set by stopAll: a reconcile still in flight must not start bots during shutdown. */
    private closed = false
    private readonly endReasons = new WeakMap<WorkerLike, EndReason>()
    /** Store writes and stops started from events, so shutdown can wait for them. */
    private readonly inFlight = new Set<Promise<unknown>>()
    private readonly backoff: { baseMs: number; maxMs: number }
    private readonly stableMs: number
    private readonly liveness: typeof LIVENESS
    private readonly giveUp: typeof GIVE_UP
    private lastLivenessCheck: number | undefined
    /** When each account last started and last ended early, to tell one broken account from a fleet outage. */
    private readonly lastStart = new Map<string, number>()
    private readonly lastEarlyEnd = new Map<string, number>()
    private readonly log: Pick<Console, "warn" | "error">
    private readonly now: () => number

    private readonly deps: SupervisorDeps

    constructor(deps: SupervisorDeps) {
        this.deps = deps
        this.backoff = deps.backoff ?? { baseMs: 5_000, maxMs: 5 * 60_000 }
        this.stableMs = deps.stableMs ?? 10 * 60_000
        this.liveness = { ...LIVENESS, ...deps.liveness }
        this.giveUp = { ...GIVE_UP, ...deps.giveUp }
        this.log = deps.logger ?? console
        this.now = deps.now ?? Date.now
    }

    get running() {
        return [...this.bots.values()].filter(b => b.worker).length
    }

    /** V8 heap in use by each live worker, for the memory gauge. */
    async heapSizes() {
        const workers = [...this.bots.values()].flatMap(b => b.worker?.getHeapStatistics ? [b.worker] : [])
        const stats = await Promise.allSettled(workers.map(w => w.getHeapStatistics!()))
        return stats.flatMap(s => s.status === "fulfilled" ? [s.value.used_heap_size] : [])
    }

    reconcile({ specs, sleeping, staleErrors }: Wanted) {
        if (this.closed)
            return
        // A bot's own stop clears its status, so only accounts without one are cleared here.
        for (const id of staleErrors)
            if (!this.bots.has(id))
                this.clearStaleError(id)
        for (const [id, bot] of this.bots)
            if (!specs.has(id)) {
                // Dropping the bot drops its retry timer and backoff with it. Its failure streak stays while it sleeps.
                this.bots.delete(id)
                this.track(this.stop(bot, sleeping.has(id) ? "schedule" : "stopped"))
            }
        for (const id of this.streaks.keys())
            if (!specs.has(id) && !sleeping.has(id))
                this.streaks.delete(id)
        for (const id of this.atCapacity)
            if (!specs.has(id))
                this.atCapacity.delete(id)
        for (const id of this.refused)
            if (!specs.get(id)?.refusal)
                this.refused.delete(id)
        for (const spec of specs.values()) {
            if (spec.refusal) {
                const running = this.bots.get(spec.accountId)
                const reason = spec.refusal
                if (running) {
                    this.bots.delete(spec.accountId)
                    // Stopping writes "stopped"; the refusal goes on top of it.
                    this.track(this.stop(running, "stopped").then(() => this.tellRefused(spec.accountId, reason)))
                } else {
                    this.tellRefused(spec.accountId, reason)
                }
                continue
            }
            const bot = this.bots.get(spec.accountId)
            if (!bot) {
                if (this.bots.size >= this.deps.maxAccounts) {
                    this.tellAtCapacity(spec.accountId)
                    continue
                }
                this.atCapacity.delete(spec.accountId)
                this.bots.set(spec.accountId, { spec, attempt: 0 })
                this.enqueue(spec.accountId)
            } else if (bot.spec.restartKey !== spec.restartKey) {
                bot.spec = spec
                bot.attempt = 0
                this.track(this.restart(bot))
            } else if (bot.spec.optionsKey !== spec.optionsKey) {
                bot.spec = spec
                bot.worker?.postMessage([Action.SetPluginOptions, { plugins: spec.plugins }])
            } else {
                bot.spec = spec
            }
        }
    }

    /** A sleeping account's status still says error, which is about a window that has closed. */
    private clearStaleError(id: string) {
        if (this.clearing.has(id))
            return
        this.clearing.add(id)
        this.track(this.deps.store.setStatus(id, stoppedBy("schedule")).finally(() => this.clearing.delete(id)))
    }

    private tellRefused(id: string, reason: string) {
        if (this.refused.has(id))
            return
        this.refused.add(id)
        this.track(this.deps.store.setStatus(id, { actualState: "error", lastError: reason }).catch(error => {
            this.refused.delete(id)
            throw error
        }))
    }

    private tellAtCapacity(id: string) {
        if (this.atCapacity.has(id))
            return
        this.atCapacity.add(id)
        this.track(this.deps.store.setStatus(id, { actualState: "error", lastError: "The runner is at capacity" }).catch(error => {
            this.atCapacity.delete(id)
            throw error
        }))
    }

    /**
     * Ends every worker that has sent nothing for staleMs, so its exit is
     * recorded as "stale" and retried. Call every LIVENESS.intervalMs.
     * Returns the accounts it ended.
     */
    checkLiveness(now = this.now()) {
        const { intervalMs, staleMs, maxLagMs } = this.liveness
        const late = this.lastLivenessCheck !== undefined && now - this.lastLivenessCheck > intervalMs + maxLagMs
        this.lastLivenessCheck = now
        // A late check means this thread was too busy to read the workers' messages, so their silence proves nothing.
        if (late)
            return []
        const stale = [...this.bots.values()].filter(bot => bot.worker && now - (bot.lastBeat ?? now) > staleMs)
        for (const bot of stale) {
            bot.failure ??= { endReason: "stale", message: STOPPED_RESPONDING }
            void bot.worker!.terminate()
        }
        return stale.map(bot => bot.spec.accountId)
    }

    async stopAll(reason: EndReason) {
        this.closed = true
        const bots = [...this.bots.values()]
        this.bots.clear()
        this.queue = []
        await this.draining
        await Promise.all(bots.map(bot => this.stop(bot, reason)))
        while (this.inFlight.size)
            await Promise.allSettled(this.inFlight)
    }

    private track(work: Promise<unknown>) {
        const tracked: Promise<unknown> = work
            .catch(error => this.log.error("store write failed", error))
            .finally(() => this.inFlight.delete(tracked))
        this.inFlight.add(tracked)
    }

    private enqueue(id: string) {
        if (!this.queue.includes(id))
            this.queue.push(id)
        void this.drain()
    }

    private drain() {
        this.draining ??= (async () => {
            while (this.queue.length) {
                await this.start(this.queue.shift()!).catch(error => this.log.error("start failed", error))
                if (this.queue.length)
                    await new Promise(r => setTimeout(r, this.deps.startGapMs))
            }
        })().finally(() => { this.draining = undefined })
        return this.draining
    }

    private async stop(bot: Bot, reason: EndReason) {
        clearTimeout(bot.retryTimer)
        bot.retryTimer = undefined
        this.queue = this.queue.filter(id => id !== bot.spec.accountId)
        const worker = bot.worker
        if (!worker) {
            if (!bot.terminal && reason !== "restart")
                await this.deps.store.setStatus(bot.spec.accountId, stoppedBy(reason))
            return
        }
        this.endReasons.set(worker, reason)
        const exited = bot.exited
        await worker.terminate()
        await exited
        if (bot.worker === worker)
            bot.worker = undefined
    }

    private async restart(bot: Bot) {
        await this.stop(bot, "restart")
        if (this.bots.get(bot.spec.accountId) === bot)
            this.enqueue(bot.spec.accountId)
    }

    private async start(id: string) {
        const bot = this.bots.get(id)
        if (!bot || bot.worker)
            return
        const spec = bot.spec
        const { openSealed } = this.deps
        let workerData: Record<string, unknown> = workerDataFor(spec, openSealed(spec.passwordSealed), this.deps.ggeConfig, spec.proxy ? openSealed(spec.proxy.urlSealed) : undefined)
        bot.proxyId = spec.proxy?.id
        if (spec.externalEvent) {
            let lookupFailure: string | undefined
            const target = await this.findEventServer(bot, workerData).catch(error => {
                this.log.warn("event server lookup failed", error)
                lookupFailure = error instanceof ProbeFailed ? error.reason : undefined
                return null
            })
            if (this.bots.get(id) !== bot || bot.spec !== spec)
                return
            if (!target)
                return this.failed(bot, lookupFailure?.startsWith(PROXY_FAILURE) ? lookupFailure : EVENT_SERVER_NOT_FOUND)
            workerData = { ...workerData, gameURL: target.host, gameServer: target.zone, tempServerData: target.data }
        }
        if (this.bots.get(id) !== bot || bot.worker)
            return
        // Written before the worker exists, so nothing it reports can be overwritten by it.
        await this.deps.store.setStatus(id, { actualState: "starting", lastError: null, bannedUntil: null })
        if (this.bots.get(id) !== bot || bot.worker)
            return

        const worker = this.deps.spawn(workerData)
        bot.worker = worker
        bot.startedAt = bot.lastBeat = this.now()
        this.lastStart.set(id, bot.startedAt)
        bot.terminal = undefined
        bot.failure = undefined
        const runId = bot.runId = this.deps.store.openRun(id)
        worker.on("message", message => this.onMessage(bot, message))
        worker.on("error", error => {
            // Emitted before "exit", so onExit records it as the run's error.
            if ((error as NodeJS.ErrnoException).code === "ERR_WORKER_OUT_OF_MEMORY")
                bot.failure = { endReason: "error", message: "The bot ran out of memory" }
            this.log.error(`worker ${spec.name} failed`, error)
        })
        bot.exited = new Promise(resolve => worker.once("exit", () =>
            void this.onExit(bot, worker, runId).catch(error => this.log.error("exit handling failed", error)).finally(resolve)))
    }

    private onMessage(bot: Bot, [type, payload, extra]: unknown[]) {
        const id = bot.spec.accountId
        const { store } = this.deps
        bot.lastBeat = this.now()
        switch (type) {
            case Action.Heartbeat:
                if ((payload as { phase?: string }).phase === "running")
                    this.track(store.touchHeartbeat(id))
                break
            case Action.GetLogs:
                store.log(id, Number(payload), extra, this.deps.renderLog(extra))
                break
            case Action.Metrics:
                this.deps.onMetrics?.(payload as never)
                break
            case Action.StatusUser:
                this.track(store.setStatus(id, { resources: payload, heartbeat: true }))
                break
            case Action.Started:
                this.track(store.setStatus(id, { actualState: "running", heartbeat: true }))
                if (bot.proxyId)
                    this.track(store.proxyOk(bot.proxyId))
                break
            case Action.BotState: {
                const state = payload as { state: string; reason: string; bannedUntil?: number }
                if (state.state === "banned" || state.state === "auth_failed") {
                    bot.terminal = state as Terminal
                    const bannedUntil = state.bannedUntil ? new Date(state.bannedUntil) : null
                    this.end(bot, { actualState: state.state, lastError: state.reason, bannedUntil }, state.state === "banned"
                        ? { kind: "banned", bannedUntil: bannedUntil?.toISOString() ?? null }
                        : { kind: "auth_failed", lastError: state.reason })
                    this.forget(bot, state.state)
                } else {
                    bot.failure = { endReason: "error", message: state.reason }
                    this.track(store.setStatus(id, { actualState: "error", lastError: state.reason }))
                }
                break
            }
            case Action.KillBot:
                // Sent after a BotState, or alone by the shutoff timer plugin.
                if (!bot.terminal) {
                    // No status here: the worker's exit writes "stopped".
                    this.end(bot, {}, { kind: "shutoff" })
                    this.forget(bot, "shutoff")
                }
                break
        }
    }

    /** Stops the account for good and tells its owner why, as one write. */
    private end(bot: Bot, status: Omit<AccountEnding, "notification">, notice: EndNotice) {
        const { runId } = bot
        this.track((async () => this.deps.store.endAccount(bot.spec.accountId, { ...status, notification: { ...notice, runId: await runId } }))())
    }

    private forget(bot: Bot, reason: EndReason) {
        if (this.bots.get(bot.spec.accountId) === bot)
            this.bots.delete(bot.spec.accountId)
        this.track(this.stop(bot, reason))
    }

    private async onExit(bot: Bot, worker: WorkerLike, runId: Promise<number | undefined>) {
        const intended = this.endReasons.get(worker)
        const failure = bot.failure
        const reason = intended ?? bot.terminal?.state ?? failure?.endReason ?? "crash"
        await this.deps.store.closeRun(await runId, reason, failure?.message ?? bot.terminal?.reason)
        if (bot.worker === worker)
            bot.worker = undefined
        if (intended) {
            if (intended !== "restart" && !bot.terminal)
                await this.deps.store.setStatus(bot.spec.accountId, stoppedBy(intended))
            return
        }
        if (bot.terminal || this.bots.get(bot.spec.accountId) !== bot)
            return
        const now = this.now()
        if (now - (bot.startedAt ?? 0) > this.stableMs) {
            bot.attempt = 0
            this.streaks.delete(bot.spec.accountId)
        } else {
            this.lastEarlyEnd.set(bot.spec.accountId, now)
        }
        await this.failed(bot, failure?.message ?? CRASHED)
    }

    /** A start or run failed: retry it, unless this account has now failed often enough to give up on. */
    private async failed(bot: Bot, why: string) {
        const now = this.now()
        const { accountId, restartKey } = bot.spec
        bot.failure = undefined
        // While most of the fleet is failing, the cause is more likely the game or the network than every proxy at once.
        if (bot.proxyId && why.startsWith(PROXY_FAILURE))
            this.track(this.deps.store.proxyFailed(bot.proxyId, why, { counts: !this.fleetOutage(now) }))
        if (blameFor(why) === "account") {
            let streak = this.streaks.get(accountId)
            // A changed login is a new thing to try, so what failed before it doesn't count.
            if (streak?.restartKey !== restartKey)
                this.streaks.set(accountId, streak = { count: 0, since: now, restartKey })
            streak.count++
            if (streak.count >= this.giveUp.failures && now - streak.since >= this.giveUp.minAgeMs && !this.fleetOutage(now))
                return this.giveUpOn(bot, streak.count, why)
        }
        await this.scheduleRetry(bot, why)
    }

    private fleetOutage(now: number) {
        const { outageWindowMs, outageMinBots, outageShare } = this.giveUp
        const recent = (times: Map<string, number>) => {
            for (const [id, at] of times)
                if (now - at > outageWindowMs)
                    times.delete(id)
            return times.size
        }
        const endedEarly = recent(this.lastEarlyEnd)
        return endedEarly >= outageMinBots && endedEarly >= outageShare * recent(this.lastStart)
    }

    private giveUpOn(bot: Bot, failures: number, why: string) {
        this.bots.delete(bot.spec.accountId)
        this.streaks.delete(bot.spec.accountId)
        this.end(bot, { actualState: "crash_loop", lastError: `Stopped after ${failures} failed starts in a row: ${why}` }, { kind: "crash_loop", failures, lastError: why })
    }

    private async scheduleRetry(bot: Bot, why: string) {
        bot.attempt++
        const { baseMs, maxMs } = this.backoff
        const delay = Math.round(Math.min(maxMs, baseMs * 2 ** (bot.attempt - 1)) * (0.5 + Math.random()))
        await this.deps.store.setStatus(bot.spec.accountId, { actualState: "error", lastError: `${why}; retrying in ${Math.ceil(delay / 1000)}s` })
        bot.retryTimer = setTimeout(() => {
            bot.retryTimer = undefined
            if (this.bots.get(bot.spec.accountId) === bot)
                this.enqueue(bot.spec.accountId)
        }, delay)
    }

    /**
     * An external-event account plays on a temporary server. A logged-in bot
     * finds which: the account's non-event twin if it is running, otherwise a
     * short-lived worker with no plugins.
     */
    private async findEventServer(bot: Bot, workerData: Record<string, unknown>) {
        const twin = [...this.bots.values()].find(b =>
            b !== bot && !b.spec.externalEvent && b.worker && b.spec.serverId === bot.spec.serverId
            && b.spec.name.toLowerCase() === bot.spec.name.toLowerCase())
        let data: EventData
        if (twin?.worker) {
            data = await this.requestEventData(twin.worker, false)
        } else {
            const probe = this.deps.spawn({ ...workerData, externalEvent: false, plugins: {} })
            try {
                data = await this.requestEventData(probe, true)
            } finally {
                await probe.terminate()
            }
        }
        const target = resolveEventServer(data)
        return target && { ...target, data }
    }

    private requestEventData(worker: WorkerLike, waitForLogin: boolean) {
        return new Promise<EventData>((resolve, reject) => {
            const timer = setTimeout(() => {
                worker.off("message", onMessage)
                reject(new Error("timed out waiting for event data"))
            }, this.deps.eventTimeoutMs ?? 60_000)
            const onMessage = ([type, payload]: unknown[]) => {
                if (type === Action.Started)
                    worker.postMessage([Action.GetExternalEvent])
                // A probe that reports why it is stopping will never answer.
                if (waitForLogin && type === Action.BotState) {
                    clearTimeout(timer)
                    worker.off("message", onMessage)
                    reject(new ProbeFailed((payload as { reason: string }).reason))
                }
                if (type === Action.GetExternalEvent) {
                    clearTimeout(timer)
                    worker.off("message", onMessage)
                    resolve(payload as EventData)
                }
            }
            worker.on("message", onMessage)
            if (!waitForLogin)
                worker.postMessage([Action.GetExternalEvent])
        })
    }
}
