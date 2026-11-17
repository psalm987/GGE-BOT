import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { asc, eq, sql } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { UserEvent, userChannel, type PluginCatalogEntry, type Schedule } from "@gge/contracts"
import { generateSealKeyPair, openSealed, sealFor } from "@gge/crypto"
import { appSettings, botLogs, botRuns, botStatus, centrifugoOutbox, createDb, gameAccounts, notifications, planPeriods, pluginSettings, servers, users, type Db } from "@gge/db"
import type { PluginRegistry } from "../src/catalog.ts"
import { DiscordHub } from "../src/discord-hub.ts"
import { humanizeFor, parseEnv, workerConfig } from "../src/env.ts"
import { edgeDelayMs, loadSpecs } from "../src/specs.ts"
import { createStore } from "../src/store.ts"
import { Supervisor, type WorkerLike } from "../src/supervisor.ts"
import { FakeDiscord } from "./fixtures/fake-discord.ts"

const fakeBot = fileURLToPath(new URL("./fixtures/fake-bot.mjs", import.meta.url))
const keys = generateSealKeyPair()
const catalog: PluginCatalogEntry[] = [
    { key: "attack", force: true, hidden: false, options: [{ type: "Text", key: "attackDelaySeconds", default: "4.5" }] },
    { key: "feast", force: false, hidden: false, options: [{ type: "Checkbox", key: "useCoins", default: false }] },
]
const registry: PluginRegistry = { catalog, filenames: new Map([["attack", "plugins/attack/attack"], ["feast", "plugins/feast"]]) }

let db: Db
let ownerId: string
let supervisor: Supervisor
let spawned: Record<string, unknown>[]
let store: ReturnType<typeof createStore>
let metricBatches: unknown[]

beforeAll(async () => {
    db = createDb(inject("databaseUrl"))
    await db.insert(servers).values([
        { id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" },
        { id: 27, label: "India 2", wsHost: "in2.test", zone: "EmpireEx_27" },
    ]).onConflictDoNothing()
})
afterAll(() => db.$pool.end())

beforeEach(async () => {
    // Each test has its own owner and account names, so nothing needs a table-wide truncate.
    const [owner] = await db.insert(users).values({ username: `owner-${Math.random().toString(36).slice(2)}`, passwordHash: "x", maxBots: 50 }).returning()
    ownerId = owner!.id
    store = createStore(db, { flushMs: 20 })
    metricBatches = []
    supervisor = makeSupervisor()
})

function makeSupervisor(overrides: Partial<ConstructorParameters<typeof Supervisor>[0]> = {}) {
    const mine: Record<string, unknown>[] = []
    spawned = mine
    return new Supervisor({
        spawn: workerData => {
            mine.push(workerData)
            return new Worker(fakeBot, { workerData })
        },
        store,
        openSealed: sealed => openSealed(keys.privateKey, sealed),
        renderLog: parts => Array.isArray(parts) ? parts.join("") : String(parts),
        ggeConfig: { exitOnFatal: true },
        startGapMs: 50,
        maxAccounts: 10,
        backoff: { baseMs: 100, maxMs: 1000 },
        eventTimeoutMs: 2000,
        logger: { warn() {}, error() {} },
        onMetrics: batch => metricBatches.push(batch),
        ...overrides,
    })
}

afterEach(async () => {
    await supervisor.stopAll("deploy")
    await store.flushLogs()
    await db.delete(users).where(eq(users.id, ownerId))
})

async function addAccount(name: string, { running = true, externalEvent = false, serverId = 26, schedule = null as Schedule | null } = {}) {
    const [account] = await db.insert(gameAccounts).values({
        ownerId, name, serverId, externalEvent, schedule,
        passwordSealed: sealFor(keys.publicKey, `pw-${name}`),
        desiredState: running ? "running" : "stopped",
    }).returning()
    return account!.id
}

const reconcile = async () => supervisor.reconcile(await loadSpecs(db, registry))

async function until<T>(check: () => Promise<T> | T, ms = 5000): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
        const value = await check()
        if (value)
            return value
        if (Date.now() > deadline)
            throw new Error("condition not met in time")
        await new Promise(r => setTimeout(r, 20))
    }
}

const status = async (id: string) => (await db.select().from(botStatus).where(eq(botStatus.accountId, id)))[0]
const runs = (id: string) => db.select().from(botRuns).where(eq(botRuns.accountId, id)).orderBy(asc(botRuns.id))
const logs = async (id: string) => (await db.select().from(botLogs).where(eq(botLogs.accountId, id)).orderBy(asc(botLogs.id))).map(l => l.message)
const desired = async (id: string) => (await db.select().from(gameAccounts).where(eq(gameAccounts.id, id)))[0]?.desiredState

const notified = (id: string) => db.select().from(notifications).where(eq(notifications.accountId, id)).orderBy(asc(notifications.id))
/** The notification events Centrifugo would deliver to this test's owner. */
async function notificationEvents() {
    const rows = await db.select().from(centrifugoOutbox)
        .where(sql`${centrifugoOutbox.payload}->>'channel' = ${userChannel(ownerId)}`).orderBy(asc(centrifugoOutbox.id))
    return rows.map(r => UserEvent.parse((r.payload as { data: unknown }).data)).flatMap(e => e.kind === "notification" ? [e.notification] : [])
}

describe("starting and stopping", () => {
    test("starts every wanted account with its decrypted password and plugins, one login at a time", async () => {
        const a = await addAccount("ok-a")
        const b = await addAccount("ok-b")
        await addAccount("ok-idle", { running: false })
        await reconcile()

        await until(async () => (await status(a))?.actualState === "running" && (await status(b))?.actualState === "running")
        expect(spawned.map(d => d.name)).toEqual(["ok-a", "ok-b"])
        expect(spawned[0]).toMatchObject({ gameURL: "in1.test", gameServer: "EmpireEx_26", plugins: { attack: { state: true, attackDelaySeconds: "4.5", filename: "plugins/attack/attack" } } })
        expect(await until(async () => (await logs(a)).includes("password ok") && logs(a))).not.toContain("password WRONG")
        expect((await runs(a))).toHaveLength(1)
        expect(metricBatches).toContainEqual({ counters: [["bot_messages_total", { direction: "out", command: "lli" }, 1]], observations: [] })
    })

    test("each worker gets the humanize flags of its own account", async () => {
        const chosen = await addAccount("ok-chosen")
        const other = await addAccount("ok-other")
        const env = parseEnv({ DATABASE_URL: "postgres://x", SEAL_PRIVATE_KEY: "k", BOT_HUMANIZE: "pin_jitter,map_grid", BOT_HUMANIZE_ACCOUNTS: chosen })
        supervisor = makeSupervisor({ humanizeFor: humanizeFor(env) })
        await reconcile()
        await until(async () => (await status(chosen))?.actualState === "running" && (await status(other))?.actualState === "running")

        const humanize = (name: string) => (spawned.find(d => d.name === name)!.ggeConfig as { humanize: unknown }).humanize
        expect(humanize("ok-chosen")).toEqual({ pin_jitter: true, measured_timing: false, lognormal_delays: false, map_grid: true, nch: false, login_sequence: false, attack_dialog: false })
        expect(humanize("ok-other")).toEqual({ pin_jitter: false, measured_timing: false, lognormal_delays: false, map_grid: false, nch: false, login_sequence: false, attack_dialog: false })
        expect(spawned[0]!.ggeConfig).toMatchObject({ exitOnFatal: true })
    })

    test("stopping in the database stops the worker and closes its run", async () => {
        const id = await addAccount("ok-stop")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")

        await db.update(gameAccounts).set({ desiredState: "stopped" }).where(eq(gameAccounts.id, id))
        await reconcile()

        await until(async () => (await status(id))?.actualState === "stopped")
        expect((await runs(id)).map(r => r.endReason)).toEqual(["stopped"])
        expect(supervisor.running).toBe(0)
    })

    test("deleting a running account stops its worker without errors", async () => {
        const id = await addAccount("ok-delete")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")

        await db.delete(gameAccounts).where(eq(gameAccounts.id, id))
        await reconcile()

        await until(() => supervisor.running === 0)
        expect(supervisor.bots.size).toBe(0)
    })

    test("a disabled owner's bots stop", async () => {
        const id = await addAccount("ok-owner")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")

        await db.update(users).set({ status: "disabled" }).where(eq(users.id, ownerId))
        await reconcile()
        await until(async () => (await status(id))?.actualState === "stopped")
    })

    test("accounts past the capacity limit are not started and say why", async () => {
        supervisor = makeSupervisor({ maxAccounts: 1 })
        const first = await addAccount("ok-first")
        const second = await addAccount("ok-second")
        await reconcile()
        await until(async () => (await status(first))?.actualState === "running")
        expect(await status(second)).toMatchObject({ actualState: "error", lastError: "The runner is at capacity" })
    })

    test("the capacity status is written once, and the account starts when room frees up", async () => {
        const capacityWrites: string[] = []
        const setStatus = store.setStatus
        supervisor = makeSupervisor({
            maxAccounts: 1,
            store: { ...store, setStatus: (id, patch) => {
                if (patch.lastError === "The runner is at capacity")
                    capacityWrites.push(id)
                return setStatus(id, patch)
            } },
        })
        const first = await addAccount("ok-room")
        const second = await addAccount("ok-waiting")
        await reconcile()
        await until(async () => (await status(first))?.actualState === "running")
        await reconcile()
        await reconcile()
        expect(capacityWrites).toEqual([second])

        await db.update(gameAccounts).set({ desiredState: "stopped" }).where(eq(gameAccounts.id, first))
        await reconcile()
        await until(async () => (await status(second))?.actualState === "running")
    })

    test("after stopAll a late reconcile starts nothing", async () => {
        await addAccount("ok-late")
        await supervisor.stopAll("runner_lost")
        await reconcile()
        await new Promise(r => setTimeout(r, 200))
        expect(spawned).toHaveLength(0)
    })
})

describe("Discord", () => {
    const quiet = { log() {}, warn() {}, error() {} }

    test("a worker's Discord request is carried out by the runner's client, and the answer goes back to that worker", async () => {
        const client = new FakeDiscord()
        client.channel("1")
        const hub = new DiscordHub({ token: "secret-token", createClient: () => client, logger: quiet })
        hub.start()
        supervisor = makeSupervisor({ discord: hub, ggeConfig: workerConfig(parseEnv({ DATABASE_URL: "postgres://x", SEAL_PRIVATE_KEY: "k", DISCORD_TOKEN: "secret-token" })) })
        const a = await addAccount("discord-a")
        const b = await addAccount("discord-b")
        await reconcile()

        await until(async () => (await logs(a)).includes("discord reply true hello from discord-a"))
        await until(async () => (await logs(b)).includes("discord reply true hello from discord-b"))
        expect((await logs(a)).filter(l => l.startsWith("discord reply"))).toHaveLength(1)
        expect(client.channel("1").log.map(m => m.content).sort()).toEqual(["hello from discord-a", "hello from discord-b"])
        expect(client.logins).toEqual(["secret-token"])

        expect(spawned).toHaveLength(2)
        expect(spawned[0]!.ggeConfig).toMatchObject({ discordHub: true })
        expect(JSON.stringify(spawned)).not.toContain("secret-token")
        await hub.stop()
    })

    test("a stopped worker no longer hears the channels it subscribed to", async () => {
        const client = new FakeDiscord()
        const hub = new DiscordHub({ token: "t", createClient: () => client, logger: quiet })
        hub.start()
        const heard: unknown[] = []
        supervisor = makeSupervisor({
            discord: hub,
            spawn: workerData => {
                const worker = new Worker(fakeBot, { workerData })
                const post = worker.postMessage.bind(worker)
                worker.postMessage = (message: unknown) => {
                    if ((message as [number, { event?: string }])[1]?.event)
                        heard.push(message)
                    post(message)
                }
                // The fake bot never subscribes, so the test does it on the worker's behalf.
                hub.request(worker, { id: 99, op: "subscribe", args: { channelIds: ["1"] } })
                return worker
            },
        })
        const id = await addAccount("discord-sub")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        client.channel("1").receive("while running")
        expect(heard).toHaveLength(1)

        await db.update(gameAccounts).set({ desiredState: "stopped" }).where(eq(gameAccounts.id, id))
        await reconcile()
        await until(async () => (await status(id))?.actualState === "stopped")
        client.channel("1").receive("after the stop")

        expect(heard).toHaveLength(1)
        await hub.stop()
    })
})

describe("settings changes", () => {
    test("changed options are pushed into the running worker without a new login", async () => {
        const id = await addAccount("ok-opts")
        await db.insert(pluginSettings).values({ accountId: id, pluginKey: "feast", enabled: true, options: {} })
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")

        await db.update(pluginSettings).set({ options: { useCoins: true } }).where(eq(pluginSettings.accountId, id))
        await reconcile()

        await until(async () => (await logs(id)).some(l => l.includes('"useCoins":true')))
        expect(spawned).toHaveLength(1)
    })

    test("enabling a plugin restarts the bot so it loads", async () => {
        const id = await addAccount("ok-enable")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")

        await db.insert(pluginSettings).values({ accountId: id, pluginKey: "feast", enabled: true, options: {} })
        await reconcile()

        await until(() => spawned.length === 2)
        expect(spawned[1]!.plugins).toHaveProperty("feast")
        await until(async () => (await runs(id)).length === 2 && (await runs(id))[0]!.endReason === "restart")
    })
})

describe("when a bot ends on its own", () => {
    test("an unexpected exit is retried with backoff and each attempt is a run", async () => {
        const id = await addAccount("crash-loop")
        await reconcile()
        await until(async () => (await runs(id)).filter(r => r.endReason === "crash").length >= 2)
        // The run closes before the status is written, so wait for the status too.
        await until(async () => /stopped unexpectedly; retrying in \d+s/.test((await status(id))?.lastError ?? ""))
    })

    test("a worker that runs out of memory is recorded as such and retried", async () => {
        supervisor = makeSupervisor({
            spawn: workerData => new Worker(fakeBot, { workerData, resourceLimits: { maxOldGenerationSizeMb: 16 } }),
        })
        const id = await addAccount("oom-x")
        await reconcile()
        await until(async () => (await runs(id)).some(r => r.endReason === "error" && r.error === "The bot ran out of memory"), 10_000)
        await until(async () => (await status(id))?.lastError?.startsWith("The bot ran out of memory; retrying in"))
    })

    test("a fatal error is recorded and retried", async () => {
        const id = await addAccount("fatal-x")
        await reconcile()
        await until(async () => (await runs(id)).some(r => r.endReason === "error" && r.error === "tooManyImportantErrors"))
    })

    test("a rejected password stops the account until its owner acts", async () => {
        const id = await addAccount("authfail-x")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "auth_failed")
        await until(async () => (await desired(id)) === "stopped")
        await new Promise(r => setTimeout(r, 400))
        expect(spawned.map(d => d.name)).toEqual(["authfail-x"])
        expect((await runs(id)).map(r => r.endReason)).toEqual(["auth_failed"])
    })

    test("a rejected password notifies the owner once, naming the account", async () => {
        const id = await addAccount("authfail-note")
        await reconcile()
        await until(async () => (await notified(id)).length)
        await until(async () => (await runs(id))[0]?.endedAt)

        const [run] = await runs(id)
        expect(await notified(id)).toMatchObject([{
            userId: ownerId, kind: "auth_failed", dedupKey: `auth_failed:${id}:${run!.id}`, readAt: null, emailState: "pending",
            data: { accountName: "authfail-note", serverLabel: "India 1", lastError: "INVALID_PASSWORD" },
        }])
        expect(await notificationEvents()).toMatchObject([{ kind: "auth_failed", accountId: id, data: { accountName: "authfail-note" } }])
        expect((await status(id))?.actualState).toBe("auth_failed")
        expect(await desired(id)).toBe("stopped")
    })

    test("a ban notifies the owner with when it ends", async () => {
        const id = await addAccount("banned-note")
        await reconcile()
        await until(async () => (await notified(id)).length)

        expect(await notified(id)).toMatchObject([{ kind: "banned", data: { accountName: "banned-note", serverLabel: "India 1", bannedUntil: "2030-01-01T00:00:00.000Z" } }])
        expect(await notificationEvents()).toMatchObject([{ kind: "banned", accountId: id }])
        expect((await status(id))?.actualState).toBe("banned")
        expect(await desired(id)).toBe("stopped")
    })

    test("a worker that reports its ban twice notifies the owner once", async () => {
        // A real worker's second message can be lost to terminate(), so this one is scripted to deliver both.
        const worker = new EventEmitter() as EventEmitter & WorkerLike
        worker.postMessage = () => {}
        worker.terminate = async () => { worker.emit("exit", 1); return 1 }
        const reports: string[] = []
        supervisor = makeSupervisor({
            spawn: () => worker,
            store: { ...store, endAccount: (accountId, ending) => { reports.push(accountId); return store.endAccount(accountId, ending) } },
        })
        const id = await addAccount("banned-twice")
        await reconcile()
        await until(() => supervisor.running === 1)
        const ban = [20, { state: "banned", reason: "IS_BANNED" }]
        worker.emit("message", ban)
        worker.emit("message", ban)
        await supervisor.stopAll("deploy")

        expect(reports).toEqual([id, id])
        expect(await notified(id)).toHaveLength(1)
        expect(await notificationEvents()).toHaveLength(1)
        expect((await runs(id)).map(r => r.endReason)).toEqual(["banned"])
    })

    test("the shutoff timer notifies the owner and leaves the status as a plain stop", async () => {
        const id = await addAccount("shutoff-note")
        await reconcile()
        await until(async () => (await notified(id)).length)
        await until(async () => (await status(id))?.actualState === "stopped")

        expect(await notified(id)).toMatchObject([{ kind: "shutoff", data: { accountName: "shutoff-note", serverLabel: "India 1" } }])
        expect(await notificationEvents()).toMatchObject([{ kind: "shutoff", accountId: id }])
        expect((await status(id))?.lastError).toBeNull()
        expect(await desired(id)).toBe("stopped")
    })

    test("a ban is stored with when it ends and is not retried", async () => {
        const id = await addAccount("banned-x")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "banned")
        expect((await status(id))?.bannedUntil?.toISOString()).toBe("2030-01-01T00:00:00.000Z")
        await until(async () => (await desired(id)) === "stopped")
        await new Promise(r => setTimeout(r, 400))
        expect(spawned).toHaveLength(1)
    })

    test("the shutoff timer stops the account", async () => {
        const id = await addAccount("shutoff-x")
        await reconcile()
        await until(async () => (await runs(id))[0]?.endReason === "shutoff")
        await until(async () => (await desired(id)) === "stopped")
        await until(async () => (await status(id))?.actualState === "stopped")
    })
})

describe("a bot that stops responding", () => {
    const quick = { liveness: { staleMs: 300 } }

    test("a silent worker is ended, its run recorded as stale, and it is started again", async () => {
        supervisor = makeSupervisor(quick)
        const id = await addAccount("silent-x")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        expect(supervisor.checkLiveness()).toEqual([])

        await until(() => supervisor.checkLiveness().includes(id))
        await until(async () => (await runs(id))[0]?.endReason === "stale")
        expect((await runs(id))[0]!.error).toBe("The bot stopped responding")
        await until(async () => (await status(id))?.lastError?.startsWith("The bot stopped responding; retrying in"))
        await until(() => spawned.length === 2)
    })

    test("a worker whose event loop is blocked is killed and recorded as stale", async () => {
        supervisor = makeSupervisor(quick)
        const id = await addAccount("hang-x")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")

        await until(() => supervisor.checkLiveness().includes(id))
        await until(async () => (await runs(id))[0]?.endReason === "stale")
    })

    test("a worker that keeps sending heartbeats is left alone", async () => {
        supervisor = makeSupervisor(quick)
        const running = await addAccount("ok-beating")
        const loggingIn = await addAccount("login-slow")
        await reconcile()
        await until(async () => (await status(running))?.actualState === "running")
        await new Promise(r => setTimeout(r, 600))

        expect(supervisor.checkLiveness()).toEqual([])
        expect(supervisor.running).toBe(2)
        expect((await status(loggingIn))?.heartbeatAt).toBeNull()
    })

    test("a check that runs late ends nothing, because a busy runner can't tell who is silent", async () => {
        supervisor = makeSupervisor({ liveness: { staleMs: 300, intervalMs: 1000, maxLagMs: 500 } })
        const id = await addAccount("silent-lag")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        const t0 = Date.now()
        expect(supervisor.checkLiveness(t0)).toEqual([])

        expect(supervisor.checkLiveness(t0 + 1501)).toEqual([])
        expect(supervisor.running).toBe(1)
        expect(supervisor.checkLiveness(t0 + 1501 + 1500)).toEqual([id])
    })

    test("heartbeats from a running bot keep its last-seen time fresh without publishing a status event", async () => {
        const id = await addAccount("ok-seen")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        const statusEvents = async () => (await db.select().from(centrifugoOutbox)
            .where(sql`${centrifugoOutbox.payload}->'data'->>'kind' = 'status' and ${centrifugoOutbox.payload}->'data'->>'accountId' = ${id}`)).length
        const published = await statusEvents()
        const before = (await status(id))!.heartbeatAt!

        await until(async () => (await status(id))!.heartbeatAt!.getTime() > before.getTime() + 150)
        expect(await statusEvents()).toBe(published)
    })
})

describe("giving up on an account that can't start", () => {
    const quick = { backoff: { baseMs: 20, maxMs: 40 }, giveUp: { failures: 3, minAgeMs: 0 } }
    const settle = () => new Promise(r => setTimeout(r, 500))

    test("after enough failed starts in a row the account is stopped and says why", async () => {
        supervisor = makeSupervisor(quick)
        const id = await addAccount("crash-forever")
        await reconcile()

        await until(async () => (await status(id))?.actualState === "crash_loop")
        expect((await status(id))?.lastError).toBe("Stopped after 3 failed starts in a row: The bot stopped unexpectedly")
        await until(async () => (await desired(id)) === "stopped")
        expect(supervisor.bots.size).toBe(0)
        await settle()
        expect(spawned).toHaveLength(3)
        expect((await runs(id)).map(r => r.endReason)).toEqual(["crash", "crash", "crash"])
    })

    test("giving up notifies the owner once, with how often it failed and the last reason", async () => {
        supervisor = makeSupervisor(quick)
        const id = await addAccount("fatal-note")
        await reconcile()
        await until(async () => (await notified(id)).length)
        await settle()

        expect(await notified(id)).toMatchObject([{ kind: "crash_loop", data: { accountName: "fatal-note", serverLabel: "India 1", failures: 3, lastError: "tooManyImportantErrors" } }])
        expect(await notificationEvents()).toMatchObject([{ kind: "crash_loop", accountId: id }])
        expect((await status(id))?.actualState).toBe("crash_loop")
        expect(await desired(id)).toBe("stopped")
    })

    test("the last failure's reason is the one reported", async () => {
        supervisor = makeSupervisor(quick)
        const id = await addAccount("fatal-forever")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "crash_loop")
        expect((await status(id))?.lastError).toBe("Stopped after 3 failed starts in a row: tooManyImportantErrors")
    })

    test("failures keep being retried until they have gone on for long enough", async () => {
        supervisor = makeSupervisor({ ...quick, giveUp: { failures: 2, minAgeMs: 700 } })
        const id = await addAccount("crash-young")
        await reconcile()
        const started = Date.now()

        await until(async () => (await status(id))?.actualState === "crash_loop")
        expect(Date.now() - started).toBeGreaterThanOrEqual(700)
        expect((await runs(id)).length).toBeGreaterThan(2)
    })

    test.each([
        ["a rejected client version", "sysfail-x", "CLIENT_VERSION_REJECTED"],
        ["a dropped game connection", "netfail-x", "SOCKET_ERROR:1006"],
    ])("%s is no fault of the account and is retried forever", async (_, name, reason) => {
        supervisor = makeSupervisor(quick)
        const id = await addAccount(name)
        await reconcile()

        await until(async () => (await runs(id)).filter(r => r.error === reason).length >= 6)
        expect(await desired(id)).toBe("running")
        expect((await status(id))?.actualState).not.toBe("crash_loop")
    })

    test("a run that lasts long enough clears the failures before it", async () => {
        // The crash fixture runs for at least 40 ms, so every run counts as stable.
        supervisor = makeSupervisor({ ...quick, stableMs: 20 })
        const id = await addAccount("crash-stable")
        await reconcile()

        await until(async () => (await runs(id)).filter(r => r.endReason === "crash").length >= 6)
        expect(await desired(id)).toBe("running")
        expect((await status(id))?.actualState).not.toBe("crash_loop")
    })

    test("changing the account's login starts the count again", async () => {
        supervisor = makeSupervisor({ ...quick, giveUp: { failures: 4, minAgeMs: 0 } })
        const id = await addAccount("crash-edited")
        await reconcile()
        await until(async () => (await runs(id)).length >= 2)
        await db.update(gameAccounts).set({ passwordSealed: sealFor(keys.publicKey, "pw-crash-edited") }).where(eq(gameAccounts.id, id))
        await reconcile()

        await until(async () => (await status(id))?.actualState === "crash_loop")
        expect((await runs(id)).filter(r => r.endReason === "crash").length).toBeGreaterThanOrEqual(5)
    })

    test("when most of the fleet is failing together nobody is given up on", async () => {
        supervisor = makeSupervisor({ ...quick, startGapMs: 5, giveUp: { failures: 3, minAgeMs: 0, outageMinBots: 3 } })
        const ids = await Promise.all(["crash-a", "crash-b", "crash-c"].map(name => addAccount(name)))
        await reconcile()

        await until(async () => (await Promise.all(ids.map(runs))).every(r => r.length >= 6), 15_000)
        for (const id of ids) {
            expect(await desired(id)).toBe("running")
            expect((await status(id))?.actualState).not.toBe("crash_loop")
        }
    })

    test("one failing account among healthy ones is still given up on", async () => {
        supervisor = makeSupervisor({ ...quick, giveUp: { failures: 3, minAgeMs: 0, outageMinBots: 1 } })
        const healthy = await Promise.all(["ok-a", "ok-b"].map(name => addAccount(name)))
        const broken = await addAccount("crash-alone")
        await reconcile()

        await until(async () => (await status(broken))?.actualState === "crash_loop")
        for (const id of healthy)
            expect((await status(id))?.actualState).toBe("running")
    })
})

describe("external events", () => {
    test("a probe worker finds the event server, then the event bot plays there", async () => {
        const id = await addAccount("event-hero", { externalEvent: true })
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        expect(spawned[0]).toMatchObject({ externalEvent: false, plugins: {} })
        expect(spawned[1]).toMatchObject({ gameURL: "event-host.test", gameServer: "EmpireEx_99", externalEvent: true })
        expect(spawned[1]!.tempServerData).toMatchObject({ glt: { TSZ: "EmpireEx_99" } })
    })

    test("with its twin running, the twin answers and no probe is spawned", async () => {
        await addAccount("event-twin")
        await reconcile()
        await until(() => supervisor.running === 1)
        await until(async () => (await db.select().from(botStatus)).some(s => s.actualState === "running"))

        await addAccount("event-twin", { externalEvent: true })
        await reconcile()
        await until(() => spawned.length === 2)
        expect(spawned[1]).toMatchObject({ gameURL: "event-host.test", externalEvent: true })
    })

    test("a same-name account on another server is not taken for the twin", async () => {
        await addAccount("event-elsewhere", { serverId: 27 })
        await reconcile()
        await until(() => supervisor.running === 1)

        await addAccount("event-elsewhere", { externalEvent: true })
        await reconcile()
        await until(() => spawned.length === 3)
        expect(spawned[1]).toMatchObject({ gameURL: "in1.test", externalEvent: false, plugins: {} })
        expect(spawned[2]).toMatchObject({ gameURL: "event-host.test", externalEvent: true })
    })
})

describe("attack plugin cap", () => {
    const attackKeys = ["raidA", "raidB", "raidC", "raidD", "raidE"]
    const capped: PluginRegistry = {
        catalog: [...catalog, ...attackKeys.map(key => ({ key, force: false, hidden: false, options: [], category: "attack" as const }))],
        filenames: new Map([...registry.filenames, ...attackKeys.map(key => [key, `plugins/attack/${key}`] as const)]),
    }
    const reconcileCapped = async () => supervisor.reconcile(await loadSpecs(db, capped))
    const enableAttacks = (accountId: string, n: number) =>
        db.insert(pluginSettings).values(attackKeys.slice(0, n).map(pluginKey => ({ accountId, pluginKey, enabled: true, options: {} })))

    test("an account over its cap never starts and says why", async () => {
        const id = await addAccount("ok-cap-over")
        await enableAttacks(id, 5)
        await reconcileCapped()
        await until(async () => (await status(id))?.actualState === "error")
        expect(await status(id)).toMatchObject({ lastError: "TOO_MANY_ATTACK_PLUGINS" })
        expect(spawned).toHaveLength(0)
    })

    test("a per-user override of none lets it run", async () => {
        await db.update(users).set({ attackPluginCap: "none" }).where(eq(users.id, ownerId))
        const id = await addAccount("ok-cap-none")
        await enableAttacks(id, 5)
        await reconcileCapped()
        await until(async () => (await status(id))?.actualState === "running")
    })

    test("lowering the cap stops a running bot that is now over it", async () => {
        await db.update(users).set({ attackPluginCap: "6" }).where(eq(users.id, ownerId))
        const id = await addAccount("ok-cap-lowered")
        await enableAttacks(id, 5)
        await reconcileCapped()
        await until(async () => (await status(id))?.actualState === "running")

        await db.update(users).set({ attackPluginCap: "4" }).where(eq(users.id, ownerId))
        await reconcileCapped()
        await until(async () => (await status(id))?.lastError === "TOO_MANY_ATTACK_PLUGINS")
        expect(supervisor.running).toBe(0)
        expect((await status(id))?.actualState).toBe("error")
    })
})

describe("plan limits", () => {
    test("an account beyond the owner's plan is not started, while its twin rides free", async () => {
        await db.update(users).set({ maxBots: 1 }).where(eq(users.id, ownerId))
        const first = await addAccount("ok-plan-first")
        const twin = await addAccount("ok-plan-first", { externalEvent: true })
        const extra = await addAccount("ok-plan-extra")
        const { specs } = await loadSpecs(db, registry)
        expect([...specs.keys()].sort()).toEqual([first, twin].sort())
        expect(specs.has(extra)).toBe(false)
    })

    test("lowering max_bots stops the newest running worker and leaves the oldest running", async () => {
        const oldest = await addAccount("ok-plan-oldest")
        const newest = await addAccount("ok-plan-newest")
        await reconcile()
        await until(async () => (await status(oldest))?.actualState === "running" && (await status(newest))?.actualState === "running")

        await db.update(users).set({ maxBots: 1 }).where(eq(users.id, ownerId))
        await reconcile()

        await until(async () => (await status(newest))?.actualState === "stopped")
        expect(supervisor.running).toBe(1)
        expect((await status(oldest))?.actualState).toBe("running")
        expect(await desired(newest)).toBe("running")
    })
})

describe("plan periods", () => {
    const setBilling = (billingLive: boolean) => db.update(appSettings).set({ billingLive })
    afterEach(() => setBilling(false))

    const starts = new Date("2026-06-01T00:00:00Z")
    const ends = new Date("2026-06-29T00:00:00Z")
    const before = new Date("2026-06-28T23:00:00Z")
    const after = new Date("2026-06-29T00:00:01Z")
    const addPeriod = (startsAt: Date, endsAt: Date, planId: "basic" | "team" = "basic") =>
        db.insert(planPeriods).values({ userId: ownerId, planId, startsAt, endsAt, source: "purchase" })

    test("with billing off, periods change nothing: max_bots decides and no edge is set", async () => {
        const first = await addAccount("ok-period-off-1")
        const second = await addAccount("ok-period-off-2")
        await addPeriod(starts, ends)
        const { specs, nextChange } = await loadSpecs(db, registry, after)
        expect([...specs.keys()].sort()).toEqual([first, second].sort())
        expect(nextChange).toBeNull()
    })

    test("with billing live, an owner with no period runs nothing", async () => {
        await addAccount("ok-period-none")
        await setBilling(true)
        const { specs, nextChange } = await loadSpecs(db, registry, before)
        expect(specs.size).toBe(0)
        expect(nextChange).toBeNull()
    })

    test("with billing live, the plan's account runs until the period ends, which is the next change", async () => {
        const first = await addAccount("ok-period-first")
        await addAccount("ok-period-extra")
        await addPeriod(starts, ends)
        await setBilling(true)

        const covered = await loadSpecs(db, registry, before)
        expect([...covered.specs.keys()]).toEqual([first])
        expect(covered.nextChange).toEqual(ends)
        expect(edgeDelayMs(covered.nextChange, before.getTime(), 2 * 60 * 60_000)).toBe(60 * 60_000 + 1000)

        const expired = await loadSpecs(db, registry, after)
        expect(expired.specs.size).toBe(0)
        expect(expired.nextChange).toBeNull()
    })

    test("with billing live, a queued period keeps the account running and its start is the next change", async () => {
        const first = await addAccount("ok-period-queued")
        await addPeriod(starts, ends)
        await addPeriod(ends, new Date("2026-07-27T00:00:00Z"), "team")
        await setBilling(true)
        expect((await loadSpecs(db, registry, before)).nextChange).toEqual(ends)
        const next = await loadSpecs(db, registry, after)
        expect([...next.specs.keys()]).toEqual([first])
        expect(next.nextChange).toEqual(new Date("2026-07-27T00:00:00Z"))
    })

    test("with billing live, an override replaces the plan's size and an admin runs everything", async () => {
        const ids = [await addAccount("ok-period-o1"), await addAccount("ok-period-o2"), await addAccount("ok-period-o3")]
        await addPeriod(starts, ends)
        await setBilling(true)
        await db.update(users).set({ maxBotsOverride: 2 }).where(eq(users.id, ownerId))
        expect([...(await loadSpecs(db, registry, before)).specs.keys()].sort()).toEqual(ids.slice(0, 2).sort())
        await db.update(users).set({ role: "admin" }).where(eq(users.id, ownerId))
        expect((await loadSpecs(db, registry, after)).specs.size).toBe(3)
    })

    test("a running bot is stopped by the reconcile after its owner's period ends", async () => {
        const id = await addAccount("ok-period-stop")
        await addPeriod(starts, ends)
        await setBilling(true)
        supervisor.reconcile(await loadSpecs(db, registry, before))
        await until(async () => (await status(id))?.actualState === "running")
        supervisor.reconcile(await loadSpecs(db, registry, after))
        await until(async () => (await status(id))?.actualState === "stopped")
        expect(await desired(id)).toBe("running")
    })
})

describe("run windows", () => {
    // 2026-06-15 is a Monday.
    const office: Schedule = { tz: "UTC", jitterMinutes: 0, windows: [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }] }
    const before = new Date("2026-06-15T08:00:00Z")
    const inside = new Date("2026-06-15T12:00:00Z")
    const after = new Date("2026-06-15T17:00:30Z")
    const reconcileAt = async (now: Date) => supervisor.reconcile(await loadSpecs(db, registry, now))
    const settle = () => new Promise(r => setTimeout(r, 300))

    test("a running account is stopped when its window closes, and its run says the window closed", async () => {
        const id = await addAccount("ok-window-ends", { schedule: office })
        await reconcileAt(inside)
        await until(async () => (await status(id))?.actualState === "running")

        await reconcileAt(after)
        await until(async () => (await status(id))?.actualState === "stopped")
        expect((await runs(id)).map(r => r.endReason)).toEqual(["schedule"])
        expect((await status(id))?.lastError).toBeNull()
        expect(supervisor.bots.size).toBe(0)
        expect(await desired(id)).toBe("running")
    })

    test("an account outside its window starts when the window opens", async () => {
        const id = await addAccount("ok-window-opens", { schedule: office })
        await reconcileAt(before)
        await settle()
        expect(spawned).toHaveLength(0)
        expect(await status(id)).toBeUndefined()

        await reconcileAt(inside)
        await until(async () => (await status(id))?.actualState === "running")
        expect(await runs(id)).toHaveLength(1)
    })

    test("going to sleep cancels a pending retry, and the failures before it still count after it", async () => {
        supervisor = makeSupervisor({ backoff: { baseMs: 300, maxMs: 300 }, giveUp: { failures: 3, minAgeMs: 0 } })
        const id = await addAccount("crash-then-sleep", { schedule: office })
        await reconcileAt(inside)
        await until(async () => (await runs(id)).filter(r => r.endedAt).length === 2)

        await reconcileAt(after)
        await until(async () => (await status(id))?.actualState === "stopped")
        expect((await status(id))?.lastError).toBeNull()
        await new Promise(r => setTimeout(r, 600))
        expect(spawned).toHaveLength(2)
        expect(await desired(id)).toBe("running")

        await reconcileAt(inside)
        await until(async () => (await status(id))?.actualState === "crash_loop")
        expect((await status(id))?.lastError).toBe("Stopped after 3 failed starts in a row: The bot stopped unexpectedly")
        expect(spawned).toHaveLength(3)
    })

    describe("an account that fails in every short window", () => {
        // Four windows on the Monday, each shorter than the 30 minutes a streak must last before the runner gives up.
        const short: Schedule = { tz: "UTC", jitterMinutes: 0, windows: ["09:00", "09:10", "09:20", "09:31"].map(start => ({ days: [1], start, end: start.replace(/\d$/, "5") })) }
        const at = (time: string) => Date.parse(`2026-06-15T${time}:00Z`)
        let clock: number
        /** Set while the next worker to start should count as a stable run: the clock passes stableMs before its exit is handled. */
        let stableNext: boolean
        const crashes = async (id: string) => (await runs(id)).filter(r => r.endReason === "crash").length
        const reconcileNow = async () => supervisor.reconcile(await loadSpecs(db, registry, new Date(clock)))

        beforeEach(() => {
            stableNext = false
            // The real GIVE_UP: 8 failures over at least 30 minutes. The first retry waits at least 100 ms, so a sleep lands between crashes.
            supervisor = makeSupervisor({
                backoff: { baseMs: 200, maxMs: 400 },
                now: () => clock,
                spawn: workerData => {
                    const worker = new Worker(fakeBot, { workerData })
                    if (stableNext) {
                        stableNext = false
                        // Registered before the supervisor's own exit listener, so it runs first.
                        worker.once("exit", () => { clock += 11 * 60_000 })
                    }
                    return worker
                },
            })
        })

        /** Opens the window that starts at `time`, lets the account crash twice in it, then closes it. */
        async function crashTwiceIn(id: string, time: string) {
            clock = at(time) + 30_000
            const before = await crashes(id)
            await reconcileNow()
            await until(async () => await crashes(id) >= before + 2)
            clock += 5 * 60_000
            await reconcileNow()
            await until(async () => (await status(id))?.actualState === "stopped")
        }

        test("is given up on once it has failed 8 times in a row over 30 minutes", async () => {
            const id = await addAccount("crash-windowed", { schedule: short })
            for (const time of ["09:00", "09:10", "09:20"])
                await crashTwiceIn(id, time)
            expect(await crashes(id)).toBeGreaterThanOrEqual(6)
            expect(await desired(id)).toBe("running")
            expect(await notified(id)).toEqual([])

            clock = at("09:31") + 30_000
            await reconcileNow()
            await until(async () => (await status(id))?.actualState === "crash_loop")
            const failures = await crashes(id)
            expect(failures).toBeGreaterThanOrEqual(8)
            expect((await status(id))?.lastError).toBe(`Stopped after ${failures} failed starts in a row: The bot stopped unexpectedly`)
            await until(async () => (await desired(id)) === "stopped")
        })

        test("is kept when it ran stably in between", async () => {
            const id = await addAccount("crash-windowed-stable", { schedule: short })
            for (const time of ["09:00", "09:10", "09:20"])
                await crashTwiceIn(id, time)
            const before = await crashes(id)

            clock = at("09:31") + 30_000
            stableNext = true
            await reconcileNow()
            // Without the stable run the second of these would be the eighth in a row, 31 minutes in.
            await until(async () => await crashes(id) >= before + 4)
            expect((await status(id))?.actualState).not.toBe("crash_loop")
            expect(await desired(id)).toBe("running")
            expect(await notified(id)).toEqual([])
        })
    })

    test("the owner stopping a sleeping account ends its run of failures", async () => {
        supervisor = makeSupervisor({ backoff: { baseMs: 300, maxMs: 300 }, giveUp: { failures: 3, minAgeMs: 0 } })
        const id = await addAccount("crash-stopped-asleep", { schedule: office })
        await reconcileAt(inside)
        await until(async () => (await runs(id)).filter(r => r.endedAt).length === 2)
        await reconcileAt(after)
        await until(async () => (await status(id))?.actualState === "stopped")

        await db.update(gameAccounts).set({ desiredState: "stopped" }).where(eq(gameAccounts.id, id))
        await reconcileAt(after)
        await db.update(gameAccounts).set({ desiredState: "running" }).where(eq(gameAccounts.id, id))
        await reconcileAt(inside)

        // A third failure in a row would end the account; after the owner's stop it is the first.
        await until(async () => (await runs(id)).filter(r => r.endedAt).length === 3)
        await until(async () => (await status(id))?.lastError?.includes("retrying"))
        expect(await desired(id)).toBe("running")
    })

    describe("an error left on an account that goes to sleep", () => {
        let stoppedWrites: string[]
        const counting = () => {
            stoppedWrites = []
            const setStatus = store.setStatus
            return { ...store, setStatus: (id: string, patch: Parameters<typeof setStatus>[1]) => {
                if (patch.actualState === "stopped")
                    stoppedWrites.push(id)
                return setStatus(id, patch)
            } }
        }
        const reconcileWith = async (plugins: PluginRegistry, now: Date) => supervisor.reconcile(await loadSpecs(db, plugins, now))

        test("a refused account that goes to sleep is marked stopped once, with the error gone", async () => {
            const raids = ["raidA", "raidB", "raidC", "raidD", "raidE"]
            const capped: PluginRegistry = {
                catalog: [...catalog, ...raids.map(key => ({ key, force: false, hidden: false, options: [], category: "attack" as const }))],
                filenames: new Map([...registry.filenames, ...raids.map(key => [key, `plugins/attack/${key}`] as const)]),
            }
            supervisor = makeSupervisor({ store: counting() })
            const id = await addAccount("ok-refused-sleeper", { schedule: office })
            await db.insert(pluginSettings).values(raids.map(pluginKey => ({ accountId: id, pluginKey, enabled: true, options: {} })))
            await reconcileWith(capped, inside)
            await until(async () => (await status(id))?.actualState === "error")
            expect(spawned).toHaveLength(0)

            await reconcileWith(capped, after)
            await until(async () => (await status(id))?.actualState === "stopped")
            expect((await status(id))?.lastError).toBeNull()
            await reconcileWith(capped, after)
            await reconcileWith(capped, after)
            await settle()
            expect(stoppedWrites).toEqual([id])

            // The refusal comes back with the next window.
            await reconcileWith(capped, inside)
            await until(async () => (await status(id))?.actualState === "error")
        })

        test("an account waiting for room that goes to sleep is marked stopped once", async () => {
            supervisor = makeSupervisor({ maxAccounts: 1, store: counting() })
            const first = await addAccount("ok-room-taken")
            const waiting = await addAccount("ok-room-sleeper", { schedule: office })
            await reconcileAt(inside)
            await until(async () => (await status(waiting))?.lastError === "The runner is at capacity")
            await until(async () => (await status(first))?.actualState === "running")

            await reconcileAt(after)
            await until(async () => (await status(waiting))?.actualState === "stopped")
            expect((await status(waiting))?.lastError).toBeNull()
            await reconcileAt(after)
            await settle()
            expect(stoppedWrites).toEqual([waiting])
        })

        test("an error found on an account that is already asleep is cleared", async () => {
            const id = await addAccount("ok-found-asleep", { schedule: office })
            await store.setStatus(id, { actualState: "error", lastError: "The bot stopped unexpectedly; retrying in 5s" })
            const asleep = await loadSpecs(db, registry, before)
            expect([...asleep.staleErrors]).toEqual([id])
            supervisor.reconcile(asleep)
            await until(async () => (await status(id))?.actualState === "stopped")
            expect((await status(id))?.lastError).toBeNull()
            expect((await loadSpecs(db, registry, before)).staleErrors.size).toBe(0)
        })
    })

    test("the next schedule edge is the earliest among wanted accounts, awake or asleep", async () => {
        const evening: Schedule = { tz: "UTC", jitterMinutes: 0, windows: [{ days: [1], start: "20:00", end: "21:00" }] }
        await addAccount("ok-edge-none")
        expect((await loadSpecs(db, registry, inside)).nextChange).toBeNull()

        await addAccount("ok-edge-evening", { schedule: evening })
        expect((await loadSpecs(db, registry, inside)).nextChange).toEqual(new Date("2026-06-15T20:00:00Z"))

        await addAccount("ok-edge-office", { schedule: office })
        // At noon the office account is awake and stops at 17:00, before the evening one starts.
        expect((await loadSpecs(db, registry, inside)).nextChange).toEqual(new Date("2026-06-15T17:00:00Z"))
        // At 08:00 both are asleep, and the office one starts first.
        expect((await loadSpecs(db, registry, before)).nextChange).toEqual(new Date("2026-06-15T09:00:00Z"))

        await addAccount("ok-edge-unwanted", { running: false, schedule: { ...office, windows: [{ days: [1], start: "08:30", end: "08:40" }] } })
        expect((await loadSpecs(db, registry, before)).nextChange).toEqual(new Date("2026-06-15T09:00:00Z"))
    })

    test.each([
        ["an edge 12 s away is reconciled a second after it", 12_000, 13_000],
        ["an edge that has just passed is reconciled in a second", -50, 1000],
        ["an edge beyond the periodic reconcile is left to it", 29_500, undefined],
        ["an edge hours away is left to it", 5 * 3600_000, undefined],
    ])("%s", (_, away, delay) => {
        const now = Date.parse("2026-06-15T12:00:00Z")
        expect(edgeDelayMs(new Date(now + away), now, 30_000)).toBe(delay)
    })

    test("with no schedule edge ahead nothing is timed", () => {
        expect(edgeDelayMs(null, Date.now(), 30_000)).toBeUndefined()
    })

    test("an account without a schedule runs at any time", async () => {
        const id = await addAccount("ok-no-schedule")
        expect((await loadSpecs(db, registry, before)).sleeping.size).toBe(0)
        await reconcileAt(before)
        await until(async () => (await status(id))?.actualState === "running")
        await reconcileAt(after)
        await settle()
        expect((await status(id))?.actualState).toBe("running")
        expect(await runs(id)).toMatchObject([{ endReason: null }])
    })

    test("a sleeping account takes no room on the runner", async () => {
        supervisor = makeSupervisor({ maxAccounts: 1 })
        const sleeper = await addAccount("ok-room-sleeper", { schedule: office })
        const awake = await addAccount("ok-room-awake")
        await reconcileAt(before)
        await until(async () => (await status(awake))?.actualState === "running")
        expect(await status(sleeper)).toBeUndefined()
    })

    test("a sleeping account keeps its place in the plan, and an event twin follows its own schedule", async () => {
        await db.update(users).set({ maxBots: 1 }).where(eq(users.id, ownerId))
        const main = await addAccount("ok-plan-sleeper", { schedule: office })
        const twin = await addAccount("ok-plan-sleeper", { externalEvent: true })
        const extra = await addAccount("ok-plan-waiting")

        const asleep = await loadSpecs(db, registry, before)
        expect([...asleep.sleeping]).toEqual([main])
        expect([...asleep.specs.keys()]).toEqual([twin])
        expect(asleep.specs.has(extra)).toBe(false)

        const awake = await loadSpecs(db, registry, inside)
        expect(awake.sleeping.size).toBe(0)
        expect([...awake.specs.keys()].sort()).toEqual([main, twin].sort())
    })
})
