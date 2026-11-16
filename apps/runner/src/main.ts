import { createRequire } from "node:module"
import { Worker } from "node:worker_threads"
import { sql } from "drizzle-orm"
import { CHANNELS, createDb, servers } from "@gge/db"
import { openSealed } from "@gge/crypto"
import { publishCatalog, readPluginRegistry } from "./catalog.ts"
import { parseEnv, workerConfig } from "./env.ts"
import { readServers, refreshGameData } from "./game-data.ts"
import { acquireRunnerLock } from "./lock.ts"
import { createLogRenderer } from "./log-render.ts"
import { createMetrics, serveMetrics, type MetricBatch } from "./metrics.ts"
import { loadSpecs } from "./specs.ts"
import { createStore } from "./store.ts"
import { LIVENESS, Supervisor } from "./supervisor.ts"

const require = createRequire(import.meta.url)
const paths = require("@gge/bot-core/paths.js") as { data: string }
const ggeBotPath = require.resolve("@gge/bot-core/ggeBot.js")
const VERSION = process.env.GGE_VERSION ?? "dev"

const env = parseEnv()
const db = createDb(env.DATABASE_URL)
const store = createStore(db)
const ggeConfig = workerConfig(env)

let applyMetrics: (batch: MetricBatch) => void = () => {}
const supervisor = new Supervisor({
    spawn: workerData => new Worker(ggeBotPath, { workerData, resourceLimits: { maxOldGenerationSizeMb: env.WORKER_MAX_OLD_MB } }),
    onMetrics: (batch: MetricBatch) => applyMetrics(batch),
    store,
    openPassword: sealed => openSealed(env.SEAL_PRIVATE_KEY, sealed),
    renderLog: createLogRenderer(),
    ggeConfig,
    startGapMs: env.START_GAP_MS,
    maxAccounts: env.MAX_ACCOUNTS,
})

const lock = await acquireRunnerLock(db.$pool, {
    onLost: async error => {
        // Postgres has already freed the lock and another runner may log these accounts in, so stop ours first.
        console.error("Lost the runner lock's connection; stopping every bot and exiting.", error)
        await Promise.race([
            supervisor.stopAll("runner_lost").then(() => store.flushLogs()).catch(e => console.error("stopping the bots failed", e)),
            new Promise(resolve => setTimeout(resolve, 20_000)),
        ])
        process.exit(1)
    },
})
if (!lock) {
    console.error("Another runner holds the lock; exiting so no account logs in twice.")
    await db.$pool.end()
    process.exit(1)
}

await store.recoverFromLastRun()

if (env.REFRESH_GAME_DATA)
    await refreshGameData(paths.data)
for (const server of await readServers(paths.data))
    await db.insert(servers).values(server).onConflictDoUpdate({ target: servers.id, set: { ...server, updatedAt: sql`now()` } })

const registry = readPluginRegistry(ggeConfig)
await publishCatalog(db, registry.catalog)

const metrics = createMetrics({ db, heapSizes: () => supervisor.heapSizes() })
applyMetrics = metrics.apply
const metricsServer = await serveMetrics(metrics.registry, env.METRICS_PORT)

let reconciling: Promise<void> | undefined
let again = false
async function reconcile() {
    if (reconciling) {
        again = true
        return reconciling
    }
    reconciling = (async () => {
        do {
            again = false
            supervisor.reconcile(await loadSpecs(db, registry))
        } while (again)
    })().catch(error => console.error("reconcile failed", error)).finally(() => { reconciling = undefined })
    return reconciling
}

// The lock's connection doubles as the listener: if it drops, we lose both together.
lock.client.on("notification", () => void reconcile())
await lock.client.query(`listen ${CHANNELS.desired}`)

const startedAt = new Date()
const timers = [
    setInterval(() => {
        supervisor.checkLiveness()
        void reconcile()
    }, LIVENESS.intervalMs),
    setInterval(() => void store.beat(startedAt, VERSION, supervisor.running).catch(e => console.error("heartbeat failed", e)), 10_000),
    setInterval(() => void store.pruneLogs().catch(e => console.error("log prune failed", e)), 3600_000),
    setInterval(() => void store.pruneOutbox().catch(e => console.error("outbox prune failed", e)), 3600_000),
]
await store.beat(startedAt, VERSION, 0)
await reconcile()
console.log(`runner ${VERSION} started`)

for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, async () => {
        timers.forEach(clearInterval)
        metricsServer.close()
        await supervisor.stopAll("deploy")
        await store.flushLogs()
        await lock.release()
        await db.$pool.end()
        process.exit(0)
    })
