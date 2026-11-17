import { createHash } from "node:crypto"
import { BlockList, isIP } from "node:net"
import { Counter } from "prom-client"

const CACHE_SIZE = 10_000
const CACHE_TTL_MS = 24 * 3600_000
const TIMEOUT_MS = 300

const lookups = new Counter({
    name: "geoip_lookups_total",
    help: "Country lookups for the language auto-detect, by outcome.",
    labelNames: ["result"] as const,
})

const nonPublic = new BlockList()
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const)
    nonPublic.addSubnet(net, prefix, "ipv4")
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const)
    nonPublic.addSubnet(net, prefix, "ipv6")

function isPublic(ip: string) {
    const family = isIP(ip)
    if (!family) return false
    // ::ffff:a.b.c.d is an IPv4 address in IPv6 clothes; Fastify reports it that way on a dual-stack socket.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
    if (mapped) return !nonPublic.check(mapped, "ipv4")
    return !nonPublic.check(ip, family === 4 ? "ipv4" : "ipv6")
}

/**
 * Resolves an IP to an ISO country code through an atlas service (alisinabh/atlas, MaxMind GeoLite2).
 * The IP is held in memory for the request only: the cache is keyed by its hash, and nothing is stored or logged.
 * Any failure answers null, so the caller falls back to the browser's language.
 */
export function createGeoip({ url, timeoutMs = TIMEOUT_MS }: { url: string | undefined; timeoutMs?: number }) {
    const cache = new Map<string, { country: string | null; expiresAt: number }>()

    async function ask(ip: string): Promise<string | null> {
        const response = await fetch(`${url}/geoip/lookup/country/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) {
            // atlas answers 400 for addresses it has no country for (special-use or malformed).
            if (response.status === 400) return null
            throw new Error(`atlas answered ${response.status}`)
        }
        const body = await response.json() as { results?: Record<string, { country?: { iso_code?: string }; registered_country?: { iso_code?: string } }> }
        const found = body.results?.[ip]
        return found?.country?.iso_code ?? found?.registered_country?.iso_code ?? null
    }

    return async function lookupCountry(ip: string): Promise<string | null> {
        if (!url || !isPublic(ip)) {
            lookups.inc({ result: "skipped" })
            return null
        }
        const key = createHash("sha256").update(ip).digest("hex")
        const now = Date.now()
        const hit = cache.get(key)
        if (hit && hit.expiresAt > now) {
            cache.delete(key)
            cache.set(key, hit)
            lookups.inc({ result: hit.country ? "ip" : "none" })
            return hit.country
        }
        let country: string | null
        try {
            country = await ask(ip)
        } catch {
            lookups.inc({ result: "error" })
            return null
        }
        cache.delete(key)
        cache.set(key, { country, expiresAt: now + CACHE_TTL_MS })
        if (cache.size > CACHE_SIZE)
            cache.delete(cache.keys().next().value!)
        lookups.inc({ result: country ? "ip" : "none" })
        return country
    }
}

export type Geoip = ReturnType<typeof createGeoip>
