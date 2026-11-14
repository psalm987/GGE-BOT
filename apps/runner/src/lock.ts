import type pg from "pg"

/** Arbitrary but fixed: "GGE" in ASCII. */
const RUNNER_LOCK = 0x474745

/**
 * Takes the runner's session-level advisory lock on a dedicated connection.
 * While that connection lives no second runner can start, so no game account
 * is ever logged in twice. Returns null when another runner holds it.
 */
export async function acquireRunnerLock(pool: pg.Pool) {
    const client = await pool.connect()
    const { rows } = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [RUNNER_LOCK])
    if (!rows[0]?.locked) {
        client.release()
        return null
    }
    return {
        client,
        release: async () => {
            await client.query("select pg_advisory_unlock($1)", [RUNNER_LOCK]).catch(() => {})
            client.release()
        },
    }
}
