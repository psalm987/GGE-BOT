/**
 * Fixed-window counter per key, in memory. Enough for the single API
 * process this deployment runs; a second replica would need a shared store.
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
    const hits = new Map<string, { count: number; resetAt: number }>()
    return {
        /** Counts one attempt; false once the key is over its limit for this window. */
        hit(key: string) {
            const now = Date.now()
            const entry = hits.get(key)
            if (!entry || entry.resetAt <= now) {
                hits.set(key, { count: 1, resetAt: now + windowMs })
                if (hits.size > 10_000)
                    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
                return true
            }
            entry.count++
            return entry.count <= max
        },
        reset(key: string) {
            hits.delete(key)
        },
    }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>
