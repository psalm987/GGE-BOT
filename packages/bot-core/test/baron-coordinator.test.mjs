import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { createBaronCoordinator } = require("../baronCoordinator.js")

const MINUTE = 60_000
const lord = { lordID: 1, lordPosition: 0 }

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-11-27T12:00:00Z").getTime() }))
afterEach(() => vi.useRealTimers())

/** A stand-in kingdom: its nearest ready tower in tiles (undefined: nothing to attack now), and what the coordinator may ask of it. */
const kingdom = ({ tiles, mayUse = () => true, freeCommanders = 1, radius = 50, canWiden = true, widened = [] } = {}) => {
    const state = { tiles, radius, canWiden, freeCommanders }
    return Object.assign(state, {
        hooks: {
            nearestReady: () => state.tiles,
            mayUse,
            freeCommanders: () => state.freeCommanders,
            radius: () => state.radius,
            canWiden: () => state.canWiden,
            widen: () => { widened.push(state.key); state.radius += 10 },
        },
    })
}
const registerAll = (coordinator, kingdoms) => {
    for (const [key, k] of Object.entries(kingdoms)) {
        k.key = key
        coordinator.register(key, k.hooks)
    }
    return kingdoms
}

describe("which kingdom a shared commander goes to", () => {
    test("the kingdom with a clearly shorter round trip gets it", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ tiles: 40 }), BS: kingdom({ tiles: 10 }) })
        expect(coordinator.handOverTo("GE", lord)).toBe("BS")
        expect(coordinator.handOverTo("BS", lord)).toBeUndefined()
    })

    test("another kingdom's trip must be under 0.85 of this one's", () => {
        const coordinator = createBaronCoordinator()
        const { BS } = registerAll(coordinator, { GE: kingdom({ tiles: 100 }), BS: kingdom({ tiles: 90 }) })
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
        BS.tiles = 85
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
        BS.tiles = 84
        expect(coordinator.handOverTo("GE", lord)).toBe("BS")
    })

    test("of several clearly shorter trips, the shortest wins", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ tiles: 50 }), BS: kingdom({ tiles: 20 }), EW: kingdom({ tiles: 10 }), FP: kingdom({ tiles: 30 }) })
        expect(coordinator.handOverTo("GE", lord)).toBe("EW")
    })

    test("only a kingdom that may use the commander can get it", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ tiles: 40 }), BS: kingdom({ tiles: 10, mayUse: commander => commander.lordID != 1 }) })
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
        expect(coordinator.handOverTo("GE", { lordID: 2, lordPosition: 1 })).toBe("BS")
    })

    test("a kingdom with nothing to attack now never gets it, and one with nothing to attack keeps it to free it", () => {
        const coordinator = createBaronCoordinator()
        const { GE, BS } = registerAll(coordinator, { GE: kingdom({ tiles: 40 }), BS: kingdom({ tiles: undefined }) })
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
        GE.tiles = undefined
        BS.tiles = 1
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
    })

    test("a stopped kingdom no longer takes part", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ tiles: 40 }), BS: kingdom({ tiles: 10 }) })
        coordinator.unregister("BS")
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
    })
})

describe("the travel speed each kingdom learns", () => {
    test("a trip is its tiles at the speed the kingdom learned from its own attacks", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ tiles: 20 }), BS: kingdom({ tiles: 10 }) })
        coordinator.learnSpeed("GE", 20, 20)
        coordinator.learnSpeed("BS", 10, 50)
        expect(coordinator.handOverTo("GE", lord)).toBeUndefined()
        expect(coordinator.handOverTo("BS", lord)).toBe("GE")
    })

    test("before a kingdom learns its own, it takes the average of the kingdoms that have, else 60 seconds a tile", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom(), BS: kingdom(), FP: kingdom() })
        expect(coordinator.msPerTile("FP")).toBe(60_000)
        coordinator.learnSpeed("GE", 10, 10)
        coordinator.learnSpeed("BS", 10, 30)
        expect(coordinator.msPerTile("FP")).toBe(2000)
    })

    test("each new attack counts a quarter toward the speed, and a reply with no trip teaches nothing", () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom() })
        coordinator.learnSpeed("GE", 20, 20)
        expect(coordinator.msPerTile("GE")).toBe(1000)
        coordinator.learnSpeed("GE", 10, 50)
        expect(coordinator.msPerTile("GE")).toBe(2000)
        coordinator.learnSpeed("GE", 10, 0)
        coordinator.learnSpeed("GE", 0, 30)
        coordinator.learnSpeed("GE", 10, NaN)
        expect(coordinator.msPerTile("GE")).toBe(2000)
    })
})

describe("a wait the coordinator can cut short", () => {
    test("a kingdom handed a commander wakes at once; otherwise its wait runs out", async () => {
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom(), BS: kingdom() })
        const woke = []
        coordinator.sleep("GE", MINUTE).then(() => woke.push(["GE", Date.now()]))
        coordinator.sleep("BS", MINUTE).then(() => woke.push(["BS", Date.now()]))
        const start = Date.now()
        await vi.advanceTimersByTimeAsync(1000)
        coordinator.wake("BS")
        await vi.advanceTimersByTimeAsync(0)
        expect(woke).toEqual([["BS", start + 1000]])
        await vi.advanceTimersByTimeAsync(MINUTE)
        expect(woke).toEqual([["BS", start + 1000], ["GE", start + MINUTE]])
    })
})

describe("widening a kingdom's search", () => {
    const run = ms => vi.advanceTimersByTimeAsync(ms)

    test("one kingdom widens once every kingdom has had nothing to attack for 5 minutes while commanders were free", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ widened }), BS: kingdom({ widened, radius: 40 }) })
        await run(4.5 * MINUTE)
        expect(widened).toEqual([])
        await run(MINUTE)
        expect(widened).toEqual(["BS"])
    })

    test("never while any kingdom has a tower to attack", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ widened }), BS: kingdom({ widened, tiles: 30 }) })
        await run(30 * MINUTE)
        expect(widened).toEqual([])
    })

    test("never while no commander sits free", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ widened, freeCommanders: 0 }), BS: kingdom({ widened, freeCommanders: 0 }) })
        await run(30 * MINUTE)
        expect(widened).toEqual([])
    })

    test("a tower getting ready starts the 5 minutes over", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        const { BS } = registerAll(coordinator, { GE: kingdom({ widened }), BS: kingdom({ widened }) })
        await run(4 * MINUTE)
        BS.tiles = 20
        await run(MINUTE)
        BS.tiles = undefined
        await run(4 * MINUTE)
        expect(widened).toEqual([])
        await run(1.5 * MINUTE)
        expect(widened).toEqual(["GE"])
    })

    test("one kingdom at a time: the smallest search first, and of those the fastest trips", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ widened, radius: 50 }), BS: kingdom({ widened, radius: 40 }), EW: kingdom({ widened, radius: 40 }) })
        coordinator.learnSpeed("EW", 10, 10)
        coordinator.learnSpeed("BS", 10, 20)
        coordinator.learnSpeed("GE", 10, 30)
        await run(5.5 * MINUTE)
        expect(widened).toEqual(["EW"])
        await run(5.5 * MINUTE)
        expect(widened).toEqual(["EW", "BS"])
        await run(16.5 * MINUTE)
        expect(widened).toEqual(["EW", "BS", "EW", "BS", "GE"])
    })

    test("a kingdom that cannot widen is passed over, and with none that can, nothing widens", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ widened, radius: 40, canWiden: false }), BS: kingdom({ widened, radius: 50 }) })
        await run(5.5 * MINUTE)
        expect(widened).toEqual(["BS"])
        coordinator.unregister("BS")
        await run(30 * MINUTE)
        expect(widened).toEqual(["BS"])
    })

    test("a stopped kingdom's ready tower no longer keeps the others from widening", async () => {
        const widened = []
        const coordinator = createBaronCoordinator()
        registerAll(coordinator, { GE: kingdom({ widened }), BS: kingdom({ widened, tiles: 10, canWiden: false }) })
        await run(10 * MINUTE)
        expect(widened).toEqual([])
        coordinator.unregister("BS")
        await run(5.5 * MINUTE)
        expect(widened).toEqual(["GE"])
    })
})
