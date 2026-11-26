/**
 * The game's public maintenance file, which the game client reads before it logs in (BasicCheckMaintenanceCommand): the
 * servers in maintenance and when each one ends, `{ "<zoneId>": <unix seconds> }`, or `[]` when there is none. A server's
 * zoneId is in 1.xml. Not to be confused with ./maintenance.ts, which prunes the database.
 */
export const MAINTENANCE_URL = "https://files.goodgamestudios.com/games-config/network/status/12/maint.json"

/** The file holds no account data, and asking for it the way a browser does says nothing about who asks. */
const HEADERS = { "User-Agent": "Mozilla/5.0" }

/**
 * Returns a lookup of when maintenance on a zone ends, in ms since the epoch, or undefined when the zone isn't in
 * maintenance. The file is read at most once every `maxAgeMs`. When it can't be read, nothing is in maintenance, so
 * logins go ahead as they would without the check.
 */
export function gameMaintenance({ fetch = globalThis.fetch, now = Date.now, log = console as Pick<Console, "warn">, maxAgeMs = 60_000, timeoutMs = 10_000 } = {}) {
    let last = { at: -Infinity, ends: new Map<string, number>() }
    let pending: Promise<void> | undefined

    async function read() {
        const response = await fetch(MAINTENANCE_URL, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok)
            throw new Error(`the maintenance file answered ${response.status}`)
        const data: unknown = await response.json()
        const ends = new Map<string, number>()
        if (data && typeof data === "object" && !Array.isArray(data))
            for (const [zoneId, end] of Object.entries(data)) {
                const endMs = Number(end) * 1000
                if (Number.isFinite(endMs) && endMs > 0)
                    ends.set(zoneId, endMs)
            }
        return ends
    }

    return async function maintenanceEndsAt(zoneId: string | undefined) {
        if (!zoneId)
            return undefined
        if (now() - last.at >= maxAgeMs) {
            pending ??= read()
                .then(ends => { last = { at: now(), ends } })
                .catch(error => {
                    log.warn("reading the game's maintenance file failed; logins go ahead", error)
                    last = { at: now(), ends: new Map() }
                })
                .finally(() => { pending = undefined })
            await pending
        }
        const end = last.ends.get(zoneId)
        return end !== undefined && end > now() ? end : undefined
    }
}
