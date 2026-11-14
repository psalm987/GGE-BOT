import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { asc, eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import type { PluginCatalogEntry } from "@gge/contracts"
import { generateSealKeyPair, openSealed, sealFor } from "@gge/crypto"
import { botLogs, botRuns, botStatus, createDb, gameAccounts, pluginSettings, servers, users, type Db } from "@gge/db"
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
    await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" }).onConflictDoNothing()
})
afterAll(() => db.$pool.end())

beforeEach(async () => {
    // Each test has its own owner and account names, so nothing needs a table-wide truncate.
    const [owner] = await db.insert(users).values({ username: `owner-${Math.random().toString(36).slice(2)}`, passwordHash: "x" }).returning()
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

async function addAccount(name: string, { running = true, externalEvent = false } = {}) {
    const [account] = await db.insert(gameAccounts).values({
        ownerId, name, serverId: 26, externalEvent,
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
        expect((await status(id))?.lastError).toMatch(/stopped unexpectedly; retrying in \d+s/)
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
})
