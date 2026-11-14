import type pg from "pg"

/** Arbitrary but fixed: "GGE" in ASCII. */
const RUNNER_LOCK = 0x474745
const CHECK_EVERY_MS = 15_000
const CHECK_TIMEOUT_MS = 5_000

/**
 * Takes the runner's session-level advisory lock on a dedicated connection.
 * While that connection lives no second runner can start, so no game account
 * is ever logged in twice. Returns null when another runner holds it.
 *
 * If the connection fails, Postgres frees the lock and another runner may take
 * it, so onLost fires once and the caller must stop every bot.
 */
export async function acquireRunnerLock(pool: pg.Pool, { onLost }: { onLost: (error: unknown) => void }) {
    const client = await pool.connect()
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [RUNNER_LOCK])
    if (!rows[0]?.locked) {
        client.release()
        return null
    }

    let ended = false
    const lose = (error: unknown) => {
        if (ended)
            return
        ended = true
        clearInterval(timer)
        client.release(true)
        onLost(error)
    }
    client.on("error", lose)
    const timer = setInterval(() => {
        let timeout: NodeJS.Timeout | undefined
        void Promise.race([
            client.query("select 1"),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("lock connection check timed out")), CHECK_TIMEOUT_MS) }),
        ]).catch(lose).finally(() => clearTimeout(timeout))
    }, CHECK_EVERY_MS)

    return {
        client,
        release: async () => {
            if (ended)
                return
            ended = true
            clearInterval(timer)
            await client.query("select pg_advisory_unlock($1)", [RUNNER_LOCK]).catch(() => {})
            client.release()
            client.off("error", lose)
        },
    }
}
