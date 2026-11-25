import { createServer } from "node:http"
import { count } from "drizzle-orm"
import client from "prom-client"
import { botStatus, type Db } from "@gge/db"

export type MetricBatch = {
    counters: [name: string, labels: Record<string, string>, value: number][]
    observations: [name: string, labels: Record<string, string>, values: number[]][]
}

type HeapSource = () => Promise<number[]>

/**
 * The runner's Prometheus registry. Workers send batches of the metrics
 * declared here; any other name is dropped, so a worker can't create
 * series. No metric is labelled by account.
 */
export function createMetrics({ db, heapSizes, log = console }: { db: Db; heapSizes: HeapSource; log?: Pick<Console, "warn"> }) {
    const registry = new client.Registry()
    client.collectDefaultMetrics({ register: registry })
    const registers = [registry]

    const counters: Record<string, client.Counter> = {
        bot_messages_total: new client.Counter({ name: "bot_messages_total", help: "Game messages by direction and command", labelNames: ["direction", "command"], registers }),
        bot_gaa_cache_total: new client.Counter({ name: "bot_gaa_cache_total", help: "Map area lookups served from cache (hit) or the server (miss)", labelNames: ["result"], registers }),
        bot_daily_bonus_total: new client.Counter({ name: "bot_daily_bonus_total", help: "Daily login bonus claims by what the game answered", labelNames: ["result"], registers }),
        bot_tax_collect_total: new client.Counter({ name: "bot_tax_collect_total", help: "Tax collections by what the game answered", labelNames: ["result"], registers }),
        bot_attacks_total: new client.Counter({ name: "bot_attacks_total", help: "Attacks by outcome (sent, refused, timed_out, castle_locked, limit_reached) and kingdom", labelNames: ["result", "kingdom"], registers }),
        bot_attack_refusals_total: new client.Counter({ name: "bot_attack_refusals_total", help: "Attacks the game refused, by error name", labelNames: ["reason"], registers }),
        bot_attack_pauses_total: new client.Counter({ name: "bot_attack_pauses_total", help: "Times the attack queue stopped to re-read the castles after refusals, by trigger", labelNames: ["reason"], registers }),
        bot_attack_idle_seconds_total: new client.Counter({ name: "bot_attack_idle_seconds_total", help: "Seconds attacking waited, by cause (no_free_commander, daily_cap, refusal_pause)", labelNames: ["cause"], registers }),
    }
    const histograms: Record<string, client.Histogram> = {
        bot_game_rtt_seconds: new client.Histogram({ name: "bot_game_rtt_seconds", help: "Time from asking for a reply to receiving it, by command", labelNames: ["command"], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30], registers }),
        bot_inbound_gap_seconds: new client.Histogram({ name: "bot_inbound_gap_seconds", help: "Longest silence from the game server between two bot heartbeats", buckets: [1, 5, 15, 30, 60, 90, 120, 180, 300], registers }),
        bot_attack_round_trip_seconds: new client.Histogram({ name: "bot_attack_round_trip_seconds", help: "Out and back travel time of each attack sent, by kingdom", labelNames: ["kingdom"], buckets: [60, 300, 600, 1800, 3600, 7200, 14400, 28800], registers }),
        bot_attack_queue_wait_seconds: new client.Histogram({ name: "bot_attack_queue_wait_seconds", help: "Time an attack waited in the account's queue before it ran", buckets: [1, 5, 15, 30, 60, 120, 300, 900, 3600], registers }),
        bot_send_wait_seconds: new client.Histogram({ name: "bot_send_wait_seconds", help: "Time a send waited for the rate limiter", buckets: [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers }),
    }

    new client.Gauge({
        name: "bot_workers", help: "Accounts by bot state", labelNames: ["state"], registers,
        async collect() {
            this.reset()
            for (const { state, n } of await db.select({ state: botStatus.actualState, n: count() }).from(botStatus).groupBy(botStatus.actualState))
                this.set({ state }, n)
        },
    })
    new client.Gauge({
        name: "bot_worker_heap_bytes", help: "V8 heap used per bot worker: max and avg across workers", labelNames: ["stat"], registers,
        async collect() {
            this.reset()
            const sizes = await heapSizes()
            if (!sizes.length)
                return
            this.set({ stat: "max" }, Math.max(...sizes))
            this.set({ stat: "avg" }, sizes.reduce((a, b) => a + b, 0) / sizes.length)
        },
    })

    function apply(batch: MetricBatch) {
        try {
            for (const [name, labels, value] of batch.counters ?? [])
                counters[name]?.inc(labels, value)
            for (const [name, labels, values] of batch.observations ?? [])
                for (const value of values)
                    histograms[name]?.observe(labels, value)
        } catch (error) {
            log.warn("dropped a malformed metric batch", error)
        }
    }

    return { registry, apply }
}

/** Serves /metrics for Prometheus on the internal network; not routed by Caddy. */
export function serveMetrics(registry: client.Registry, port: number, host = "0.0.0.0") {
    const server = createServer(async (req, res) => {
        if (req.url !== "/metrics") {
            res.writeHead(404).end()
            return
        }
        res.writeHead(200, { "content-type": registry.contentType }).end(await registry.metrics())
    })
    return new Promise<typeof server>(resolve => server.listen(port, host, () => resolve(server)))
}
