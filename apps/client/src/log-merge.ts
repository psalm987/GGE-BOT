import type { FeedLine } from "@gge/contracts"

export const FEED_CAP = 2000

/** `current` and `incoming` as one list, newest first, each id once, at most `cap` long. Ids grow with time, so the id is the order. */
export function mergeFeed(current: readonly FeedLine[], incoming: readonly FeedLine[], cap = FEED_CAP): FeedLine[] {
    const byId = new Map<number, FeedLine>()
    for (const line of current)
        byId.set(line.id, line)
    for (const line of incoming)
        byId.set(line.id, line)
    return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, cap)
}
