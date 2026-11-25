import { describe, expect, test } from "vitest"
import type { ReadBack, ReadBackDefence, ReadBackKhanRage, ReadBackMovement } from "@gge/contracts"
import { countdown, defencePanel, forecastTime, marchesUnderWay, rageMeter, sessionGains, sideCounts, storesByKingdom } from "../src/live-view-model.ts"

const AT = 1_800_000_000_000
const HOUR = 3_600_000

const march = (id: number, side: ReadBackMovement["side"], arrivesIn: number): ReadBackMovement => ({
    id, side, kind: "attack", kingdom: 0, from: { type: 1, x: 1, y: 2, name: "Keep" }, to: { type: 2, x: 3, y: 4, name: null },
    sender: null, troops: null, totalSeconds: 600, arrivesAt: AT + arrivesIn,
})

const readBack = (over: Partial<ReadBack> = {}): ReadBack => ({
    at: AT, castles: [], movements: [], movementCount: 0, session: { startedAt: AT - HOUR / 2, coins: 44_400, rubies: null }, ...over,
})

describe("castle stores", () => {
    const castles = [{ kingdom: 4, id: 3, name: "Storm Hold", x: 300, y: 310, type: 12 }, { kingdom: 0, id: 1, name: "Main Keep", x: 693, y: 526, type: 1 }]
    const snapshot = readBack({ castles: [
        { kingdom: 4, id: 3, readAt: AT, stock: { mead: { amount: 1000, max: 9000, perHour: -100 }, food: { amount: 950, max: 706_000, perHour: 0 } } },
        { kingdom: 0, id: 1, readAt: AT, stock: { wood: { amount: 175_000, max: 175_000, perHour: 19 } } },
        { kingdom: 0, id: 2, readAt: AT, stock: {} },
    ] })

    test("are grouped by kingdom in the game's order, each castle under the name the bot found for it", () => {
        const groups = storesByKingdom(snapshot, castles, AT)
        expect(groups.map(group => [group.kingdom, group.castles.map(c => c.castle?.name ?? null)])).toEqual([[0, ["Main Keep", null]], [4, ["Storm Hold"]]])
    })

    test("list a castle's goods in the game's order, each with where it is heading", () => {
        const [, storm] = storesByKingdom(snapshot, castles, AT)
        expect(storm!.castles[0]!.goods.map(good => [good.key, good.forecast])).toEqual([["food", null], ["mead", { state: "emptiesIn", hours: 10 }]])
    })

    test("count the forecast on from when the game listed the castle", () => {
        const [, storm] = storesByKingdom(snapshot, castles, AT + 4 * HOUR)
        expect(storm!.castles[0]!.goods[1]!.forecast).toEqual({ state: "emptiesIn", hours: 6 })
        expect(storesByKingdom(snapshot, castles, AT + 11 * HOUR)[1]!.castles[0]!.goods[1]!.forecast).toEqual({ state: "empty" })
    })
})

describe("a forecast's time", () => {
    test.each([
        [0.004, { value: 1, unit: "minute" }],
        [0.5, { value: 30, unit: "minute" }],
        [5.2, { value: 5, unit: "hour" }],
        [47, { value: 47, unit: "hour" }],
        [72, { value: 3, unit: "day" }],
    ])("%d hours is said in one unit", (hours, said) => expect(forecastTime(hours)).toEqual(said))
})

describe("marches", () => {
    const snapshot = readBack({ movements: [march(1, "incoming", 60_000), march(2, "own", 400_000), march(3, "own", 500_000), march(4, "other", 30_000)], movementCount: 4 })

    test("that have landed since the report are no longer shown", () => {
        expect(marchesUnderWay(snapshot, AT).map(m => m.id)).toEqual([1, 2, 3, 4])
        expect(marchesUnderWay(snapshot, AT + 60_000).map(m => m.id)).toEqual([2, 3])
    })

    test("are counted for each filter", () => {
        expect(sideCounts(marchesUnderWay(snapshot, AT))).toEqual({ all: 4, own: 2, incoming: 1, support: 0, other: 1 })
    })

    test("count down as a clock", () => {
        expect(countdown(397_000)).toBe("6:37")
        expect(countdown(3_723_000)).toBe("1:02:03")
        expect(countdown(400)).toBe("0:01")
        expect(countdown(-5)).toBe("0:00")
    })
})

describe("session gains", () => {
    test("come with an hourly rate once the session is old enough for one", () => {
        expect(sessionGains(readBack())).toEqual({ elapsedMs: HOUR / 2, coins: { gain: 44_400, perHour: 88_800 }, rubies: null })
        expect(sessionGains(readBack({ session: { startedAt: AT - 60_000, coins: 500, rubies: 0 } }))).toEqual({ elapsedMs: 60_000, coins: { gain: 500, perHour: null }, rubies: { gain: 0, perHour: null } })
    })
})

describe("the main castle's defence", () => {
    const tool = (amount: number) => ({ wodID: 110, amount })
    const defence: ReadBackDefence = {
        kingdom: 0, id: 1, readAt: AT,
        wall: { level: 8, defence: 315.7, troops: 5031, room: 5031, sides: { left: { share: 30, slots: [tool(686), null] }, front: { share: 40, slots: [tool(699)] }, right: { share: 30, slots: [] } } },
        gate: { level: 7, defence: null },
        moat: { level: 2, defence: 147, sides: { left: [{ wodID: 112, amount: 686 }], front: [], right: [null] } },
        courtyard: { troops: 433_000, room: 433_000, allianceRoom: 252_500 }, defenders: 8375, tools: [],
    }
    const castles = [{ kingdom: 0, id: 1, name: "Main Keep", x: 693, y: 526, type: 1 }]

    test("has one row a side, left to right, with the side's troop share and its wall and moat slots", () => {
        expect(defencePanel(defence, castles).sides).toEqual([
            { side: "left", share: 30, wall: [tool(686), null], moat: [{ wodID: 112, amount: 686 }] },
            { side: "front", share: 40, wall: [tool(699)], moat: [] },
            { side: "right", share: 30, wall: [], moat: [null] },
        ])
    })

    test("lists the wall, gate and moat with a figure the game didn't send left open", () => {
        expect(defencePanel(defence, castles).works).toEqual([
            { part: "wall", level: 8, defence: 315.7 }, { part: "gate", level: 7, defence: null }, { part: "moat", level: 2, defence: 147 },
        ])
    })

    test("names the castle when the bot found it, and not otherwise", () => {
        expect(defencePanel(defence, castles).castle?.name).toBe("Main Keep")
        expect(defencePanel(defence, []).castle).toBeNull()
    })
})

describe("the Khan rage bar", () => {
    const rage = (over: Partial<ReadBackKhanRage> = {}): ReadBackKhanRage =>
        ({ rage: 1426, needed: 2460, campLevel: 50, lastGain: 1426, lastGainAt: AT, eventRunning: true, hold: null, ...over })

    test("fills toward what a full bar takes and never reads full before it is", () => {
        expect(rageMeter(rage())).toEqual({ percent: 57, state: "filling" })
        expect(rageMeter(rage({ rage: 2459 }))).toEqual({ percent: 99, state: "filling" })
        expect(rageMeter(rage({ rage: 2700 }))).toEqual({ percent: 100, state: "full" })
    })

    test("has no percentage while the bot doesn't know what a full bar takes", () => {
        expect(rageMeter(rage({ needed: null }))).toEqual({ percent: null, state: "filling" })
    })

    test("says a taunt is held before it says the bar is full, and that the event is over before either", () => {
        expect(rageMeter(rage({ rage: 2460, hold: "toolsShort" })).state).toBe("held")
        expect(rageMeter(rage({ rage: 2460, hold: "stopped", eventRunning: false })).state).toBe("eventOver")
    })
})
