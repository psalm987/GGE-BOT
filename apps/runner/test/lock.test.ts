import { EventEmitter } from "node:events"
import type pg from "pg"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { acquireRunnerLock } from "../src/lock.ts"

/** A pooled client that grants the lock, then answers health checks with `check`. */
function fakePool(check: () => Promise<unknown>) {
    const client = Object.assign(new EventEmitter(), {
        queries: [] as string[],
        released: [] as unknown[],
        query: async (text: string) => {
            client.queries.push(text)
            if (text.includes("pg_try_advisory_lock"))
                return { rows: [{ locked: true }] }
            if (text === "select 1")
                return check()
            return { rows: [] }
        },
        release: (destroy?: unknown) => { client.released.push(destroy) },
    })
    return { client, pool: { connect: async () => client } as unknown as pg.Pool }
}

const ok = () => Promise.resolve({ rows: [{ "?column?": 1 }] })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("acquireRunnerLock", () => {
    test("a healthy connection never reports the lock lost", async () => {
        const onLost = vi.fn()
        const { client, pool } = fakePool(ok)
        await acquireRunnerLock(pool, { onLost })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(client.queries.filter(q => q === "select 1")).toHaveLength(4)
        expect(onLost).not.toHaveBeenCalled()
    })

    test("a failing health check reports the lock lost once and stops checking", async () => {
        const onLost = vi.fn()
        const { client, pool } = fakePool(() => Promise.reject(new Error("Connection terminated")))
        await acquireRunnerLock(pool, { onLost })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(onLost).toHaveBeenCalledOnce()
        expect(onLost.mock.calls[0]![0]).toMatchObject({ message: "Connection terminated" })
        expect(client.queries.filter(q => q === "select 1")).toHaveLength(1)
        expect(client.released).toEqual([true])
    })

    test("a health check that hangs past its timeout reports the lock lost", async () => {
        const onLost = vi.fn()
        const { pool } = fakePool(() => new Promise(() => {}))
        await acquireRunnerLock(pool, { onLost })
        await vi.advanceTimersByTimeAsync(19_999)
        expect(onLost).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(onLost).toHaveBeenCalledOnce()
    })

    test("a connection error reports the lock lost without waiting for the next check", async () => {
        const onLost = vi.fn()
        const { client, pool } = fakePool(ok)
        await acquireRunnerLock(pool, { onLost })
        client.emit("error", new Error("terminating connection due to administrator command"))
        client.emit("error", new Error("again"))
        expect(onLost).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(client.queries.filter(q => q === "select 1")).toHaveLength(0)
    })

    test("releasing after the connection was lost does nothing more", async () => {
        const { client, pool } = fakePool(ok)
        const lock = await acquireRunnerLock(pool, { onLost: () => {} })
        client.emit("error", new Error("gone"))
        await lock!.release()
        expect(client.released).toEqual([true])
        expect(client.queries).not.toContain("select pg_advisory_unlock($1)")
    })

    test("releasing stops the checks and returns the connection", async () => {
        const onLost = vi.fn()
        const { client, pool } = fakePool(() => Promise.reject(new Error("closed")))
        const lock = await acquireRunnerLock(pool, { onLost })
        await lock!.release()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(client.released).toEqual([undefined])
        expect(client.queries).toContain("select pg_advisory_unlock($1)")
        expect(onLost).not.toHaveBeenCalled()
    })
})
