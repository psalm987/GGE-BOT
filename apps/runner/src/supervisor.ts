import { createRequire } from "node:module"
import type { BotSpec } from "./specs.ts"
import type { StatusPatch } from "./store.ts"
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

export type EndReason = "stopped" | "restart" | "crash" | "error" | "banned" | "auth_failed" | "shutoff" | "deploy"

type Terminal = { state: "banned" | "auth_failed"; reason: string; bannedUntil?: number }

type Bot = {
    spec: BotSpec
    worker?: WorkerLike
    startedAt?: number
    /** Unexpected exits in a row; reset once a run lasts STABLE_MS. */
    attempt: number
    retryTimer?: NodeJS.Timeout
    terminal?: Terminal
    fatal?: string
    /** Settles once the current worker's exit has been recorded. */
    exited?: Promise<void>
}

export type SupervisorDeps = {
    spawn: (workerData: Record<string, unknown>) => WorkerLike
    store: {
        openRun(accountId: string): Promise<number | undefined>
        closeRun(id: number | undefined, reason: string, error?: string | null): Promise<void>
        setStatus(accountId: string, patch: StatusPatch): Promise<void>
        stopAccount(accountId: string): Promise<unknown>
        log(accountId: string, level: number, parts: unknown, message: string): void
    }
    openPassword: (sealed: Buffer) => string
    renderLog: (parts: unknown) => string
    ggeConfig: Record<string, unknown>
    startGapMs: number
    maxAccounts: number
    backoff?: { baseMs: number; maxMs: number }
    eventTimeoutMs?: number
    logger?: Pick<Console, "warn" | "error">
    /** Receives each worker's metric batch. */
    onMetrics?: (batch: never) => void
}

const STABLE_MS = 10 * 60_000

export function workerDataFor(spec: BotSpec, password: string, ggeConfig: Record<string, unknown>) {
    return {
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
    private readonly endReasons = new WeakMap<WorkerLike, EndReason>()
    /** Store writes and stops started from events, so shutdown can wait for them. */
    private readonly inFlight = new Set<Promise<unknown>>()
    private readonly backoff: { baseMs: number; maxMs: number }
    private readonly log: Pick<Console, "warn" | "error">

    private readonly deps: SupervisorDeps

    constructor(deps: SupervisorDeps) {
        this.deps = deps
        this.backoff = deps.backoff ?? { baseMs: 5_000, maxMs: 5 * 60_000 }
        this.log = deps.logger ?? console
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

    reconcile(specs: Map<string, BotSpec>) {
        for (const [id, bot] of this.bots)
            if (!specs.has(id)) {
                this.bots.delete(id)
                this.track(this.stop(bot, "stopped"))
            }
        for (const spec of specs.values()) {
            const bot = this.bots.get(spec.accountId)
            if (!bot) {
                if (this.bots.size >= this.deps.maxAccounts) {
                    this.track(this.deps.store.setStatus(spec.accountId, { actualState: "error", lastError: "The runner is at capacity" }))
                    continue
                }
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

    async stopAll(reason: EndReason) {
        const bots = [...this.bots.values()]
        this.bots.clear()
        this.queue = []
        await this.draining
        await Promise.all(bots.map(bot => this.stop(bot, reason)))
        while (this.inFlight.size)
            await Promise.allSettled([...this.inFlight])
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
                await this.deps.store.setStatus(bot.spec.accountId, { actualState: "stopped" })
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
        let workerData: Record<string, unknown> = workerDataFor(spec, this.deps.openPassword(spec.passwordSealed), this.deps.ggeConfig)
        if (spec.externalEvent) {
            const target = await this.findEventServer(bot, workerData).catch(error => {
                this.log.warn("event server lookup failed", error)
                return null
            })
            if (this.bots.get(id) !== bot || bot.spec !== spec)
                return
            if (!target) {
                bot.fatal = "Couldn't find the event server"
                return this.scheduleRetry(bot)
            }
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
        bot.startedAt = Date.now()
        bot.terminal = undefined
        bot.fatal = undefined
        const runId = this.deps.store.openRun(id)
        worker.on("message", message => this.onMessage(bot, message))
        worker.on("error", error => this.log.error(`worker ${spec.name} failed`, error))
        bot.exited = new Promise(resolve => worker.once("exit", () =>
            void this.onExit(bot, worker, runId).catch(error => this.log.error("exit handling failed", error)).finally(resolve)))
    }

    private onMessage(bot: Bot, [type, payload, extra]: unknown[]) {
        const id = bot.spec.accountId
        const { store } = this.deps
        switch (type) {
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
                break
            case Action.BotState: {
                const state = payload as { state: string; reason: string; bannedUntil?: number }
                if (state.state === "banned" || state.state === "auth_failed") {
                    bot.terminal = state as Terminal
                    this.track(store.setStatus(id, {
                        actualState: state.state,
                        lastError: state.reason,
                        bannedUntil: state.bannedUntil ? new Date(state.bannedUntil) : null,
                    }))
                    this.track(store.stopAccount(id))
                    this.forget(bot, state.state)
                } else {
                    bot.fatal = state.reason
                    this.track(store.setStatus(id, { actualState: "error", lastError: state.reason }))
                }
                break
            }
            case Action.KillBot:
                // Sent after a BotState, or alone by the shutoff timer plugin.
                if (!bot.terminal) {
                    this.track(store.stopAccount(id))
                    this.forget(bot, "shutoff")
                }
                break
        }
    }

    private forget(bot: Bot, reason: EndReason) {
        if (this.bots.get(bot.spec.accountId) === bot)
            this.bots.delete(bot.spec.accountId)
        this.track(this.stop(bot, reason))
    }

    private async onExit(bot: Bot, worker: WorkerLike, runId: Promise<number | undefined>) {
        const intended = this.endReasons.get(worker)
        const reason = intended ?? bot.terminal?.state ?? (bot.fatal ? "error" : "crash")
        await this.deps.store.closeRun(await runId, reason, bot.fatal ?? bot.terminal?.reason)
        if (bot.worker === worker)
            bot.worker = undefined
        if (intended) {
            if (intended !== "restart" && !bot.terminal)
                await this.deps.store.setStatus(bot.spec.accountId, { actualState: "stopped" })
            return
        }
        if (bot.terminal || this.bots.get(bot.spec.accountId) !== bot)
            return
        if (Date.now() - (bot.startedAt ?? 0) > STABLE_MS)
            bot.attempt = 0
        await this.scheduleRetry(bot)
    }

    private async scheduleRetry(bot: Bot) {
        bot.attempt++
        const { baseMs, maxMs } = this.backoff
        const delay = Math.round(Math.min(maxMs, baseMs * 2 ** (bot.attempt - 1)) * (0.5 + Math.random()))
        const why = bot.fatal ?? "The bot stopped unexpectedly"
        bot.fatal = undefined
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
            b !== bot && !b.spec.externalEvent && b.worker && b.spec.name.toLowerCase() === bot.spec.name.toLowerCase())
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
