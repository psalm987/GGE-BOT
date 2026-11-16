import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { asc, eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import type { PluginCatalogEntry } from "@gge/contracts"
import { generateSealKeyPair, openSealed, sealFor } from "@gge/crypto"
import { CHANNELS, botLogs, botRuns, botStatus, createDb, gameAccounts, pluginSettings, servers, users, type Db } from "@gge/db"
import type { PluginRegistry } from "../src/catalog.ts"
import { loadSpecs } from "../src/specs.ts"
import { createStore } from "../src/store.ts"
import { Supervisor } from "../src/supervisor.ts"

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
        openPassword: sealed => openSealed(keys.privateKey, sealed),
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

async function addAccount(name: string, { running = true, externalEvent = false, serverId = 26 } = {}) {
    const [account] = await db.insert(gameAccounts).values({
        ownerId, name, serverId, externalEvent,
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

    test("heartbeats from a running bot keep its last-seen time fresh without notifying subscribers", async () => {
        const id = await addAccount("ok-seen")
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        const listener = await db.$pool.connect()
        try {
            const notified: string[] = []
            listener.on("notification", n => {
                const event = JSON.parse(n.payload!) as { kind: string; accountId: string }
                if (event.kind === "status" && event.accountId === id)
                    notified.push(n.payload!)
            })
            await listener.query(`listen ${CHANNELS.bot}`)
            const before = (await status(id))!.heartbeatAt!

            await until(async () => (await status(id))!.heartbeatAt!.getTime() > before.getTime() + 150)
            expect(notified).toEqual([])
        } finally {
            listener.release(true)
        }
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
        const specs = await loadSpecs(db, registry)
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
