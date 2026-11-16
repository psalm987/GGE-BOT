import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { asc, eq, inArray } from "drizzle-orm"
import pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { NO_PROXY_FREE, PROXY_MAX_FAILURES, type PluginCatalogEntry } from "@gge/contracts"
import { generateSealKeyPair, openSealed, sealFor } from "@gge/crypto"
import { botRuns, botStatus, createDb, gameAccounts, proxies, servers, users, type Db } from "@gge/db"
import type { PluginRegistry } from "../src/catalog.ts"
import { assignProxies } from "../src/proxies.ts"
import { loadSpecs } from "../src/specs.ts"
import { createStore } from "../src/store.ts"
import { Supervisor } from "../src/supervisor.ts"

const fakeBot = fileURLToPath(new URL("./fixtures/fake-bot.mjs", import.meta.url))
const keys = generateSealKeyPair()
const catalog: PluginCatalogEntry[] = [{ key: "attack", force: true, hidden: false, options: [] }]
const registry: PluginRegistry = { catalog, filenames: new Map([["attack", "plugins/attack/attack"]]) }

let db: Db
let ownerId: string
let supervisor: Supervisor
let spawned: Record<string, unknown>[]
let store: ReturnType<typeof createStore>

beforeAll(async () => {
    db = createDb(inject("databaseUrl"))
    await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" }).onConflictDoNothing()
})
afterAll(() => db.$pool.end())

beforeEach(async () => {
    await db.delete(proxies)
    const [owner] = await db.insert(users).values({ username: `owner-${Math.random().toString(36).slice(2)}`, passwordHash: "x", maxBots: 50 }).returning()
    ownerId = owner!.id
    store = createStore(db, { flushMs: 20 })
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
        startGapMs: 10,
        maxAccounts: 20,
        backoff: { baseMs: 20, maxMs: 40 },
        eventTimeoutMs: 2000,
        logger: { warn() {}, error() {} },
        ...overrides,
    })
}

afterEach(async () => {
    await supervisor.stopAll("deploy")
    await store.flushLogs()
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(proxies)
})

/** Accounts are created a second apart in call order, which is the order they are placed in. */
let made = 0
async function addAccount(name: string, { running = true, externalEvent = false } = {}) {
    const [account] = await db.insert(gameAccounts).values({
        ownerId, name, serverId: 26, externalEvent,
        passwordSealed: sealFor(keys.publicKey, `pw-${name}`),
        desiredState: running ? "running" : "stopped",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, made++)),
    }).returning()
    return account!.id
}

const urlOf = (label: string) => `socks5h://user:secret-${label}@${label}.proxy.test:1080`
/** Proxies get ids in label order, so "the lowest id" is the first label. */
async function addProxy(label: string, { maxAccounts = 3, enabled = true, consecutiveFailures = 0 } = {}) {
    const id = `00000000-0000-4000-8000-${label.charCodeAt(0).toString(16).padStart(12, "0")}`
    await db.insert(proxies).values({ id, label, maxAccounts, enabled, consecutiveFailures, urlSealed: sealFor(keys.publicKey, urlOf(label)), hostHint: `socks5h://${label}.proxy.test:1080` })
    return id
}

const proxyOf = async (accountId: string) => (await db.select({ proxyId: gameAccounts.proxyId }).from(gameAccounts).where(eq(gameAccounts.id, accountId)))[0]!.proxyId
const proxyRow = async (id: string) => (await db.select().from(proxies).where(eq(proxies.id, id)))[0]!
const status = async (id: string) => (await db.select().from(botStatus).where(eq(botStatus.accountId, id)))[0]
const runs = (id: string) => db.select().from(botRuns).where(eq(botRuns.accountId, id)).orderBy(asc(botRuns.id))
const specsNow = async (options?: { proxyRequired: boolean }) => (await loadSpecs(db, registry, new Date(), options)).specs

/** One round of what the runner does on every change: place accounts, then move the bots toward what is wanted. */
async function reconcile(options?: { proxyRequired: boolean }) {
    await assignProxies(db)
    supervisor.reconcile(await loadSpecs(db, registry, new Date(), options))
}

async function until<T>(check: () => Promise<T> | T, ms = 5000): Promise<Exclude<T, false | null | undefined>> {
    const deadline = Date.now() + ms
    for (;;) {
        const value = await check()
        if (value)
            return value as Exclude<T, false | null | undefined>
        if (Date.now() > deadline)
            throw new Error("condition not met in time")
        await new Promise(r => setTimeout(r, 20))
    }
}

describe("assigning accounts to proxies", () => {
    test("each account goes to the least-loaded proxy, the lowest id among equals, and no proxy goes over its limit", async () => {
        const a = await addProxy("a", { maxAccounts: 2 })
        const b = await addProxy("b", { maxAccounts: 1 })
        const accounts = [await addAccount("ok-1"), await addAccount("ok-2"), await addAccount("ok-3"), await addAccount("ok-4")]

        expect(await assignProxies(db)).toBe(3)

        expect(await Promise.all(accounts.map(proxyOf))).toEqual([a, b, a, null])
    })

    test("an account that isn't wanted gets no proxy", async () => {
        await addProxy("a")
        const idle = await addAccount("ok-idle", { running: false })
        await assignProxies(db)
        expect(await proxyOf(idle)).toBeNull()
    })

    test("an account keeps its proxy: a second round moves nothing, and a stopped account still holds its place", async () => {
        const a = await addProxy("a", { maxAccounts: 1 })
        const first = await addAccount("ok-first")
        await assignProxies(db)
        await db.update(gameAccounts).set({ desiredState: "stopped" }).where(eq(gameAccounts.id, first))
        const second = await addAccount("ok-second")

        expect(await assignProxies(db)).toBe(0)

        expect(await proxyOf(first)).toBe(a)
        expect(await proxyOf(second)).toBeNull()
    })

    test("a round waits for the one before it, so two can't both fill a proxy's last place", async () => {
        const a = await addProxy("a", { maxAccounts: 1 })
        const older = await addAccount("ok-older")
        const newer = await addAccount("ok-newer")

        // An earlier round that saw only `newer` is about to commit while the next round starts.
        let next: Promise<number> | undefined
        await db.transaction(async tx => {
            await tx.select().from(proxies).for("update")
            await tx.update(gameAccounts).set({ proxyId: a }).where(eq(gameAccounts.id, newer))
            next = assignProxies(db)
            await new Promise(r => setTimeout(r, 300))
        })
        await next

        expect([await proxyOf(older), await proxyOf(newer)]).toEqual([null, a])
    })

    test("an event twin takes no place and runs through its main's proxy", async () => {
        const a = await addProxy("a", { maxAccounts: 1 })
        const main = await addAccount("ok-pair")
        const twin = await addAccount("ok-pair", { externalEvent: true })

        await assignProxies(db)

        expect(await proxyOf(main)).toBe(a)
        expect(await proxyOf(twin)).toBeNull()
        const specs = await specsNow()
        expect(specs.get(twin)!.proxy?.id).toBe(a)
        expect(specs.get(main)!.proxy?.id).toBe(a)
    })

    test("a twin wanted alone still runs through its main's proxy, which is placed for it", async () => {
        const a = await addProxy("a")
        const main = await addAccount("ok-solo", { running: false })
        const twin = await addAccount("ok-solo", { externalEvent: true })

        await assignProxies(db)

        expect(await proxyOf(main)).toBe(a)
        expect((await specsNow()).get(twin)!.proxy?.id).toBe(a)
    })

    test("a proxy pinned to an account that later became a twin is given back", async () => {
        const a = await addProxy("a", { maxAccounts: 1 })
        const twin = await addAccount("ok-late", { externalEvent: true })
        await assignProxies(db)
        expect(await proxyOf(twin)).toBe(a)

        const main = await addAccount("ok-late")
        await assignProxies(db)

        expect(await proxyOf(twin)).toBeNull()
        expect(await proxyOf(main)).toBe(a)
    })

    test("the accounts of a proxy that was turned off move to another, and stay there when it comes back", async () => {
        const a = await addProxy("a")
        const b = await addProxy("b")
        const accounts = [await addAccount("ok-m1"), await addAccount("ok-m2")]
        await assignProxies(db)
        expect(await Promise.all(accounts.map(proxyOf))).toEqual([a, b])

        await db.update(proxies).set({ enabled: false }).where(eq(proxies.id, a))
        await assignProxies(db)
        expect(await Promise.all(accounts.map(proxyOf))).toEqual([b, b])

        await db.update(proxies).set({ enabled: true }).where(eq(proxies.id, a))
        expect(await assignProxies(db)).toBe(0)
    })

    test("with the only proxy turned off, its accounts are left without one", async () => {
        const a = await addProxy("a")
        const account = await addAccount("ok-lone")
        await assignProxies(db)
        await db.update(proxies).set({ enabled: false }).where(eq(proxies.id, a))

        await assignProxies(db)

        expect(await proxyOf(account)).toBeNull()
        expect((await specsNow()).get(account)!.proxy).toBeNull()
    })

    test("with no proxies configured nothing changes and the bot connects directly", async () => {
        const account = await addAccount("ok-direct")

        expect(await assignProxies(db)).toBe(0)
        await reconcile()

        await until(async () => (await status(account))?.actualState === "running")
        expect(await proxyOf(account)).toBeNull()
        expect(spawned).toHaveLength(1)
        expect(spawned[0]).not.toHaveProperty("proxyUrl")
    })
})

describe("starting bots through a proxy", () => {
    test("the worker gets the proxy's opened URL", async () => {
        await addProxy("a")
        const account = await addAccount("ok-via")
        await reconcile()
        await until(async () => (await status(account))?.actualState === "running")
        expect(spawned.map(d => d.proxyUrl)).toEqual([urlOf("a")])
    })

    test("the event-server probe connects through the same proxy as the bot it is for", async () => {
        await addProxy("a")
        const account = await addAccount("event-probe", { externalEvent: true })
        await reconcile()
        await until(async () => (await status(account))?.actualState === "running")
        expect(spawned.map(d => [d.externalEvent, d.proxyUrl])).toEqual([[false, urlOf("a")], [true, urlOf("a")]])
    })

    test("moving an account to another proxy changes its restart key and restarts its bot on the new one", async () => {
        const a = await addProxy("a", { maxAccounts: 1 })
        const b = await addProxy("b")
        const account = await addAccount("ok-move")
        await reconcile()
        await until(async () => (await status(account))?.actualState === "running")
        const before = (await specsNow()).get(account)!.restartKey

        await db.update(proxies).set({ enabled: false }).where(eq(proxies.id, a))
        await reconcile()

        await until(() => spawned.length === 2)
        expect(await proxyOf(account)).toBe(b)
        expect((await specsNow()).get(account)!.restartKey).not.toBe(before)
        expect(spawned.map(d => d.proxyUrl)).toEqual([urlOf("a"), urlOf("b")])
        expect((await until(async () => (await runs(account)).length === 2 && runs(account)))[0]!.endReason).toBe("restart")
    })

    test("a new URL for the same proxy restarts its bots", async () => {
        const a = await addProxy("a")
        const account = await addAccount("ok-reseal")
        await reconcile()
        await until(async () => (await status(account))?.actualState === "running")

        const replaced = "http://other:pw@replaced.proxy.test:8080"
        await db.update(proxies).set({ urlSealed: sealFor(keys.publicKey, replaced) }).where(eq(proxies.id, a))
        await reconcile()

        await until(() => spawned.length === 2)
        expect(spawned[1]!.proxyUrl).toBe(replaced)
    })

    test("with PROXY_REQUIRED an account that no proxy has room for doesn't start and says why", async () => {
        await addProxy("a", { maxAccounts: 1 })
        const placed = await addAccount("ok-placed")
        const left = await addAccount("ok-left")

        await reconcile({ proxyRequired: true })

        await until(async () => (await status(placed))?.actualState === "running")
        expect(await until(() => status(left))).toMatchObject({ actualState: "error", lastError: NO_PROXY_FREE })
        expect(spawned.map(d => d.name)).toEqual(["ok-placed"])
        expect(await runs(left)).toHaveLength(0)
    })

    test("with PROXY_REQUIRED and no proxies at all, nothing starts", async () => {
        const account = await addAccount("ok-none")
        await reconcile({ proxyRequired: true })
        expect(await until(() => status(account))).toMatchObject({ actualState: "error", lastError: NO_PROXY_FREE })
        expect(spawned).toHaveLength(0)
    })

    test("without PROXY_REQUIRED an account that no proxy has room for connects directly", async () => {
        await addProxy("a", { maxAccounts: 1 })
        await addAccount("ok-in")
        const over = await addAccount("ok-over")
        await reconcile()
        await until(async () => (await status(over))?.actualState === "running")
        expect(spawned.find(d => d.name === "ok-over")).not.toHaveProperty("proxyUrl")
    })
})

describe("proxy health", () => {
    test("a bot that logs in through a proxy clears its failure count and records when", async () => {
        const a = await addProxy("a", { consecutiveFailures: 3 })
        const account = await addAccount("ok-heal")
        await reconcile()
        await until(async () => (await status(account))?.actualState === "running")

        const healed = await until(async () => { const row = await proxyRow(a); return row.consecutiveFailures === 0 && row })
        expect(healed.lastOkAt).toBeInstanceOf(Date)
        expect(healed.enabled).toBe(true)
    })

    test(`${PROXY_MAX_FAILURES} proxy failures in a row turn the proxy off, and its account moves on`, async () => {
        const a = await addProxy("a")
        const account = await addAccount("proxyfail-x")
        await reconcile()

        const off = await until(async () => { const row = await proxyRow(a); return !row.enabled && row })
        expect(off).toMatchObject({ consecutiveFailures: PROXY_MAX_FAILURES, lastError: "PROXY_ECONNREFUSED" })
        expect(off.disabledReason).toBe(`Turned off after ${PROXY_MAX_FAILURES} failed connections in a row: PROXY_ECONNREFUSED`)
        expect(off.lastErrorAt).toBeInstanceOf(Date)
        expect((await runs(account)).filter(r => r.error === "PROXY_ECONNREFUSED")).toHaveLength(PROXY_MAX_FAILURES)

        await reconcile()
        await until(async () => (await status(account))?.actualState === "running")
        expect(await proxyOf(account)).toBeNull()
        expect(spawned.at(-1)).not.toHaveProperty("proxyUrl")
    })

    test("a failure that isn't the proxy's leaves the proxy's count alone", async () => {
        const a = await addProxy("a")
        const account = await addAccount("netfail-x")
        await reconcile()
        await until(async () => (await runs(account)).filter(r => r.endedAt).length >= 3)
        expect(await proxyRow(a)).toMatchObject({ consecutiveFailures: 0, enabled: true, lastError: null })
    })

    test("proxy failures never count toward giving up on the account", async () => {
        await addProxy("a", { maxAccounts: 1 })
        supervisor = makeSupervisor({ giveUp: { failures: 2, minAgeMs: 0 } })
        const account = await addAccount("proxyfail-keep")
        await reconcile({ proxyRequired: true })

        await until(async () => (await runs(account)).filter(r => r.endedAt).length >= 4)

        const [row] = await db.select().from(gameAccounts).where(eq(gameAccounts.id, account))
        expect(row!.desiredState).toBe("running")
        expect((await status(account))!.actualState).not.toBe("crash_loop")
    })

    test("while most of the fleet is failing, proxy failures are recorded but don't turn the proxy off", async () => {
        const a = await addProxy("a", { maxAccounts: 2 })
        supervisor = makeSupervisor({ giveUp: { outageMinBots: 2, outageShare: 0.5 } })
        const accounts = [await addAccount("proxyfail-f1"), await addAccount("proxyfail-f2")]
        await reconcile()

        await until(async () => (await db.select().from(botRuns).where(inArray(botRuns.accountId, accounts))).filter(r => r.endedAt).length >= 3 * PROXY_MAX_FAILURES)

        const row = await proxyRow(a)
        expect(row.enabled).toBe(true)
        expect(row.consecutiveFailures).toBeLessThan(PROXY_MAX_FAILURES)
        expect(row.lastError).toBe("PROXY_ECONNREFUSED")
    })
})

describe("waking the runner", () => {
    test("adding, turning off, re-pointing, resizing or removing a proxy notifies the runner; a new label and the runner's health writes don't", async () => {
        const listener = new pg.Client({ connectionString: inject("databaseUrl") })
        await listener.connect()
        let notifications = 0
        listener.on("notification", n => { if (n.channel === "gge_desired") notifications++ })
        await listener.query("listen gge_desired")
        const notifiedBy = async (change: () => Promise<unknown>) => {
            const before = notifications
            await change()
            await listener.query("select 1")
            return notifications - before
        }
        const update = (set: Partial<typeof proxies.$inferInsert>) => () => db.update(proxies).set(set).where(eq(proxies.id, a))
        let a = ""
        try {
            expect(await notifiedBy(async () => { a = await addProxy("a") }), "added").toBe(1)
            expect(await notifiedBy(update({ enabled: false })), "turned off").toBe(1)
            expect(await notifiedBy(update({ urlSealed: sealFor(keys.publicKey, urlOf("b")) })), "re-pointed").toBe(1)
            expect(await notifiedBy(update({ maxAccounts: 9 })), "resized").toBe(1)
            expect(await notifiedBy(update({ label: "renamed" })), "renamed").toBe(0)
            expect(await notifiedBy(() => store.proxyOk(a)), "a bot logged in").toBe(0)
            expect(await notifiedBy(() => store.proxyFailed(a, "PROXY_AUTH", { counts: true })), "a bot failed").toBe(0)
            expect(await notifiedBy(() => db.delete(proxies).where(eq(proxies.id, a))), "removed").toBe(1)
        } finally {
            await listener.end()
        }
    })

    test("a round that moves nothing writes nothing, so it doesn't wake the runner again", async () => {
        await addProxy("a")
        await addAccount("ok-quiet")
        await assignProxies(db)
        const listener = new pg.Client({ connectionString: inject("databaseUrl") })
        await listener.connect()
        let notifications = 0
        listener.on("notification", () => notifications++)
        await listener.query("listen gge_desired")
        try {
            await assignProxies(db)
            await listener.query("select 1")
            expect(notifications).toBe(0)
        } finally {
            await listener.end()
        }
    })
})
