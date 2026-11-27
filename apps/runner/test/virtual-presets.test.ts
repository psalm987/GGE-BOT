import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { asc, eq } from "drizzle-orm"
import pg from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, test } from "vitest"
import { emptyPlan, type ManualPlan, type PluginCatalogEntry } from "@gge/contracts"
import { generateSealKeyPair, openSealed, sealFor } from "@gge/crypto"
import { botLogs, botStatus, createDb, gameAccounts, pluginSettings, servers, users, virtualPresets, type Db } from "@gge/db"
import type { PluginRegistry } from "@gge/bot-core/pluginRegistry.mts"
import { loadSpecs } from "../src/specs.ts"
import { createStore } from "../src/store.ts"
import { Supervisor } from "../src/supervisor.ts"

const fakeBot = fileURLToPath(new URL("./fixtures/fake-bot.mjs", import.meta.url))
const keys = generateSealKeyPair()
const catalog: PluginCatalogEntry[] = [
    { key: "attack", force: true, hidden: false, options: [] },
    { key: "raid", force: false, hidden: false, category: "attack", options: [{ type: "Waves", key: "waves" }, { type: "Waves", key: "backup" }] },
]
const registry: PluginRegistry = { catalog, filenames: new Map([["attack", "plugins/attack/attack"], ["raid", "plugins/attack/raid"]]) }

const planWith = (preset: number): ManualPlan => ({ ...emptyPlan(), waves: emptyPlan().waves.map((wave, i) => i === 0 ? { kind: "preset" as const, preset } : wave) })

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
    const [owner] = await db.insert(users).values({ username: `owner-${Math.random().toString(36).slice(2)}`, passwordHash: "x", maxBots: 50 }).returning()
    ownerId = owner!.id
    store = createStore(db, { flushMs: 20 })
    spawned = []
    supervisor = new Supervisor({
        spawn: workerData => {
            spawned.push(workerData)
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
    })
})

afterEach(async () => {
    await supervisor.stopAll("deploy")
    await store.flush()
    await db.delete(users).where(eq(users.id, ownerId))
})

async function addAccount(name: string, running = true) {
    const [account] = await db.insert(gameAccounts).values({
        ownerId, name, serverId: 26, passwordSealed: sealFor(keys.publicKey, `pw-${name}`), desiredState: running ? "running" : "stopped",
    }).returning()
    return account!.id
}
const addPreset = async (accountId: string, name: string, plan: ManualPlan) =>
    (await db.insert(virtualPresets).values({ accountId, name, plan }).returning())[0]!.id
const useWaves = (accountId: string, options: Record<string, unknown>) =>
    db.insert(pluginSettings).values({ accountId, pluginKey: "raid", enabled: true, options })
const virtual = (presetId: string) => ({ kind: "virtual", presetId })
const specOf = async (id: string) => (await loadSpecs(db, registry)).specs.get(id)!
const logs = async (id: string) => (await db.select().from(botLogs).where(eq(botLogs.accountId, id)).orderBy(asc(botLogs.id))).map(l => l.message)
const status = async (id: string) => (await db.select().from(botStatus).where(eq(botStatus.accountId, id)))[0]

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

describe("virtual presets in a bot's spec", () => {
    test("every Waves option naming a preset of the account is swapped for the preset's plan, whatever the option's key", async () => {
        const id = await addAccount("ok-swap")
        const wall = await addPreset(id, "Wall", planWith(3))
        const gate = await addPreset(id, "Gate", planWith(9))
        await useWaves(id, { waves: virtual(wall), backup: virtual(gate) })
        expect((await specOf(id)).plugins.raid).toMatchObject({ waves: planWith(3), backup: planWith(9) })
    })

    test("a written plan is left alone", async () => {
        const id = await addAccount("ok-own")
        await useWaves(id, { waves: planWith(5) })
        expect((await specOf(id)).plugins.raid).toMatchObject({ waves: planWith(5) })
    })

    test("a preset that is gone stays a virtual reference, for the bot to stop that plugin over", async () => {
        const id = await addAccount("ok-gone")
        const wall = await addPreset(id, "Wall", planWith(3))
        await useWaves(id, { waves: virtual(wall) })
        await db.delete(virtualPresets).where(eq(virtualPresets.id, wall))
        expect((await specOf(id)).plugins.raid!.waves).toEqual(virtual(wall))
    })

    test("a preset of another account is never used", async () => {
        const id = await addAccount("ok-mine")
        const other = await addAccount("ok-other", false)
        const theirs = await addPreset(other, "Theirs", planWith(8))
        await useWaves(id, { waves: virtual(theirs) })
        expect((await specOf(id)).plugins.raid!.waves).toEqual(virtual(theirs))
    })

    test("a stored plan that no longer parses is left as a virtual reference", async () => {
        const id = await addAccount("ok-rot")
        const rotten = (await db.insert(virtualPresets).values({ accountId: id, name: "Rotten", plan: { kind: "manual", waves: 1 } }).returning())[0]!.id
        await useWaves(id, { waves: virtual(rotten) })
        expect((await specOf(id)).plugins.raid!.waves).toEqual(virtual(rotten))
    })

    test("editing or deleting a preset changes the spec's optionsKey and not its restartKey, so a running bot is told, not relogged", async () => {
        const id = await addAccount("ok-keys")
        const wall = await addPreset(id, "Wall", planWith(3))
        await useWaves(id, { waves: virtual(wall) })
        const before = await specOf(id)
        await db.update(virtualPresets).set({ plan: planWith(4) }).where(eq(virtualPresets.id, wall))
        const edited = await specOf(id)
        expect(edited.optionsKey).not.toBe(before.optionsKey)
        await db.delete(virtualPresets).where(eq(virtualPresets.id, wall))
        const deleted = await specOf(id)
        expect(deleted.optionsKey).not.toBe(edited.optionsKey)
        expect(new Set([before.restartKey, edited.restartKey, deleted.restartKey]).size).toBe(1)
    })
})

describe("a preset change reaching a running bot", () => {
    test("an edit and a delete are pushed into the running worker without a new login", async () => {
        const id = await addAccount("ok-live")
        const wall = await addPreset(id, "Wall", planWith(3))
        await useWaves(id, { waves: virtual(wall) })
        const reconcile = async () => supervisor.reconcile(await loadSpecs(db, registry))
        await reconcile()
        await until(async () => (await status(id))?.actualState === "running")
        expect(spawned[0]!.plugins).toMatchObject({ raid: { waves: planWith(3) } })

        await db.update(virtualPresets).set({ plan: planWith(4) }).where(eq(virtualPresets.id, wall))
        await reconcile()
        await until(async () => (await logs(id)).some(l => l.startsWith("options ") && l.includes(JSON.stringify(planWith(4)))))

        await db.delete(virtualPresets).where(eq(virtualPresets.id, wall))
        await reconcile()
        await until(async () => (await logs(id)).some(l => l.startsWith("options ") && l.includes(JSON.stringify(virtual(wall)))))
        expect(spawned).toHaveLength(1)
    })

    test("creating, editing and deleting a preset each wake the runner", async () => {
        const id = await addAccount("ok-wake", false)
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
        let preset = ""
        try {
            expect(await notifiedBy(async () => { preset = await addPreset(id, "Wall", planWith(1)) }), "created").toBe(1)
            expect(await notifiedBy(() => db.update(virtualPresets).set({ plan: planWith(2) }).where(eq(virtualPresets.id, preset))), "edited").toBe(1)
            expect(await notifiedBy(() => db.delete(virtualPresets).where(eq(virtualPresets.id, preset))), "deleted").toBe(1)
        } finally {
            await listener.end()
        }
    })
})
