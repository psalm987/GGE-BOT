import * as z from "zod"
import { SessionGains } from "@gge/contracts"

/** Each gain the session counts, by the figure of the worker's status report it counts rises of. */
const COUNTED = { coins: "cash", rubies: "gold", aqua: "aquamarin_name" } as const
type Counted = keyof typeof COUNTED

/** A session as the runner keeps it: its gains, and the last reading of each figure, which the next rise counts from. */
export const StoredSession = SessionGains.extend({
    last: z.object({ coins: z.number(), rubies: z.number(), aqua: z.number() }).partial().default({}),
})
export type StoredSession = z.infer<typeof StoredSession>

export const startSession = (now: number): StoredSession =>
    ({ startedAt: now, endedAt: null, coins: 0, rubies: 0, aqua: 0, eventPoints: {}, last: {} })

/**
 * The session a starting worker counts into: the stored one while it is open, so reconnects and restarts of the runner
 * carry on with it, or a new one once the player has stopped the bot.
 */
export function sessionToCount(stored: unknown, now: number): StoredSession {
    const session = StoredSession.safeParse(stored)
    return session.success && session.data.endedAt === null ? session.data : startSession(now)
}

const reading = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
const eventPoints = (value: unknown) => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
    .flatMap(([id, points]) => /^\d+$/.test(id) && Number.isInteger(points) && points >= 0 ? [[id, points as number]] : []))

/**
 * Adds a worker's status report to the session. A figure counts only when it rose since the last reading, so spending
 * takes nothing off. A figure the game reports as zero or leaves out is no reading. Event points are totals, so the
 * newest reading of each event replaces the one before.
 */
export function countReport(session: StoredSession, report: unknown): StoredSession {
    if (session.endedAt !== null || !report || typeof report !== "object")
        return session
    const figures = report as Record<string, unknown>
    const next = { ...session, last: { ...session.last }, eventPoints: { ...session.eventPoints, ...eventPoints(figures.eventPoints) } }
    for (const gain of Object.keys(COUNTED) as Counted[]) {
        const value = reading(figures[COUNTED[gain]])
        if (value === undefined)
            continue
        const last = next.last[gain]
        if (last !== undefined && value > last)
            next[gain] += Math.round(value - last)
        next.last[gain] = value
    }
    return next
}
