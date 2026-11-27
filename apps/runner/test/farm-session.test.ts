import { describe, expect, test } from "vitest"
import { countReport, sessionToCount, startSession } from "../src/farm-session.ts"

const T0 = 1_800_000_000_000
const count = (...reports: object[]) => reports.reduce(countReport, startSession(T0))

describe("a session's gains", () => {
    test("count only rises, so buying a feast takes nothing off", () => {
        const session = count({ cash: 1_000 }, { cash: 1_500 }, { cash: 900 }, { cash: 1_200 })
        expect(session.coins).toBe(800)
    })

    test("count coins, rubies and Storm Islands aquamarine each on its own", () => {
        const session = count({ cash: 10, gold: 5, aquamarin_name: 100 }, { cash: 20, gold: 7, aquamarin_name: 400 })
        expect(session).toMatchObject({ coins: 10, rubies: 2, aqua: 300 })
    })

    test("start from the first reading, and skip a figure the game reports as zero or leaves out", () => {
        const session = count({ cash: 5_000 }, { gold: 3 }, { cash: 0 }, { cash: 5_100 })
        expect(session).toMatchObject({ coins: 100, rubies: 0, aqua: 0 })
    })

    test("keep each event's latest points total", () => {
        const session = count({ eventPoints: { "72": 100 } }, { eventPoints: { "80": 9, "72": 350 } }, { eventPoints: { khan: 1, "71": -4 } })
        expect(session.eventPoints).toEqual({ "72": 350, "80": 9 })
    })

    test("stop counting once the session has ended", () => {
        const ended = { ...count({ cash: 1_000 }), endedAt: T0 + 60_000 }
        expect(countReport(ended, { cash: 9_000 })).toBe(ended)
    })
})

describe("the session a starting worker counts into", () => {
    test("is the stored one while it is open, with the rise across the reconnect counted", () => {
        const stored = count({ cash: 1_000 }, { cash: 1_400 })
        const resumed = sessionToCount(JSON.parse(JSON.stringify(stored)), T0 + 3_600_000)
        expect(resumed.startedAt).toBe(T0)
        expect(countReport(resumed, { cash: 1_600 }).coins).toBe(600)
    })

    test("is a new one once the player stopped the bot, or when nothing usable is stored", () => {
        const later = T0 + 3_600_000
        expect(sessionToCount({ ...count({ cash: 1_000 }, { cash: 1_400 }), endedAt: T0 + 60_000 }, later)).toEqual(startSession(later))
        expect(sessionToCount(null, later)).toEqual(startSession(later))
        expect(sessionToCount({ startedAt: "yesterday" }, later)).toEqual(startSession(later))
    })
})
