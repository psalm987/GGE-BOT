import { describe, expect, test } from "vitest"
import { BotStatus, ReadBack, SessionGains } from "../src/index.ts"

const session = { startedAt: 1_800_000_000_000, endedAt: null, coins: 44_400, rubies: 12, aqua: 9_000, eventPoints: { "72": 3_500 } }

describe("a session's gains", () => {
    test("count only rises, so no figure is ever negative", () => {
        expect(SessionGains.safeParse(session).success).toBe(true)
        expect(SessionGains.safeParse({ ...session, coins: -5 }).success).toBe(false)
    })
    test("name each event by its id", () => {
        expect(SessionGains.safeParse({ ...session, eventPoints: { khan: 1 } }).success).toBe(false)
    })
    test("ride in the status, not in the worker's read-back snapshot", () => {
        expect(BotStatus.shape.session.parse(undefined)).toBeNull()
        const snapshot = ReadBack.parse({ at: 0, castles: [], movements: [], movementCount: 0, session: { startedAt: 0, coins: 1, rubies: 2 } })
        expect(snapshot).not.toHaveProperty("session")
    })
})
