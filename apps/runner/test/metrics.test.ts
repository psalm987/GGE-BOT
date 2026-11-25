import { afterAll, beforeAll, expect, inject, test } from "vitest"
import { botStatus, createDb, gameAccounts, servers, users, type Db } from "@gge/db"
import { eq } from "drizzle-orm"
import { createMetrics, serveMetrics } from "../src/metrics.ts"

let db: Db
beforeAll(() => { db = createDb(inject("databaseUrl")) })
afterAll(() => db.$pool.end())

test("worker batches become Prometheus series; unknown names are dropped; nothing names an account", async () => {
    await db.insert(servers).values({ id: 26, label: "India 1", wsHost: "in1.test", zone: "EmpireEx_26" }).onConflictDoNothing()
    const [owner] = await db.insert(users).values({ username: `metrics-${Date.now()}`, passwordHash: "x" }).returning()
    const [account] = await db.insert(gameAccounts).values({ ownerId: owner!.id, name: "m", serverId: 26, passwordSealed: Buffer.from("x") }).returning()
    await db.insert(botStatus).values({ accountId: account!.id, actualState: "banned" })

    const metrics = createMetrics({ db, heapSizes: async () => [10_000_000, 30_000_000], log: { warn() {} } })
    metrics.apply({
        counters: [
            ["bot_messages_total", { direction: "out", command: "lli" }, 2],
            ["bot_gaa_cache_total", { result: "hit" }, 5],
            ["bot_daily_bonus_total", { result: "claimed" }, 1],
            ["bot_tax_collect_total", { result: "refused" }, 3],
            ["bot_attacks_total", { result: "refused", kingdom: "0" }, 2],
            ["bot_attack_refusals_total", { reason: "ATTACK_TOO_MANY_UNITS" }, 2],
            ["bot_attack_pauses_total", { reason: "REJECTIONS_IN_A_ROW" }, 1],
            ["bot_attack_idle_seconds_total", { cause: "refusal_pause" }, 300],
            ["made_up_metric", { accountId: account!.id }, 1],
        ],
        observations: [
            ["bot_game_rtt_seconds", { command: "gaa" }, [0.2, 0.3]],
            ["bot_attack_round_trip_seconds", { kingdom: "0" }, [420]],
            ["bot_attack_queue_wait_seconds", {}, [3, 40]],
        ],
    })

    const server = await serveMetrics(metrics.registry, 0, "127.0.0.1")
    const { port } = server.address() as { port: number }
    const text = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text()
    server.close()

    expect(text).toContain('bot_messages_total{direction="out",command="lli"} 2')
    expect(text).toContain('bot_gaa_cache_total{result="hit"} 5')
    expect(text).toContain('bot_daily_bonus_total{result="claimed"} 1')
    expect(text).toContain('bot_tax_collect_total{result="refused"} 3')
    expect(text).toContain('bot_game_rtt_seconds_count{command="gaa"} 2')
    expect(text).toContain('bot_attacks_total{result="refused",kingdom="0"} 2')
    expect(text).toContain('bot_attack_refusals_total{reason="ATTACK_TOO_MANY_UNITS"} 2')
    expect(text).toContain('bot_attack_pauses_total{reason="REJECTIONS_IN_A_ROW"} 1')
    expect(text).toContain('bot_attack_idle_seconds_total{cause="refusal_pause"} 300')
    expect(text).toContain('bot_attack_round_trip_seconds_count{kingdom="0"} 1')
    expect(text).toContain("bot_attack_queue_wait_seconds_count 2")
    expect(text).toContain('bot_workers{state="banned"} 1')
    expect(text).toContain('bot_worker_heap_bytes{stat="max"} 30000000')
    expect(text).toContain('bot_worker_heap_bytes{stat="avg"} 20000000')
    expect(text).toContain("nodejs_eventloop_lag_seconds")
    expect(text).not.toContain("made_up_metric")
    expect(text).not.toContain(account!.id)
    expect(text).not.toMatch(/\{[^}]*account[^}]*\}/i)

    await db.delete(users).where(eq(users.id, owner!.id))
})
