import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const ALLIANCE = 9
const units = [
    { wodID: 10, role: "ranged", fightType: "0" },
    { wodID: 11, role: "melee", fightType: "0" },
    { wodID: 611, toolCategory: "Basic", fightType: "0" },
]
const owners = [
    { OID: 1, N: "Raider", AID: 2, AN: "Wolves" },
    { OID: 3, N: "Friend", AID: ALLIANCE, AN: "Lambs" },
    { OID: 5, N: "Ada", AID: ALLIANCE, AN: "Lambs" },
    { OID: 6, N: "Stranger", AID: 4, AN: "Others" },
]

/** A `gam` movement entry: by default Raider (alliance 2) attacking Ada's Keep (alliance 9), 600 s out. */
function march({ id = 42, type = 0, from = 1, to = 5, army, ...m } = {}) {
    return {
        M: { MID: id, T: type, KID: 0, OID: from, SID: from, TID: to, TT: 600, PT: 0, HBW: -1,
            TA: [1, 3, 4, to, 0, 0, 0, 0, 0, 0, "Ada's Keep"], SA: [1, 0, 0, from, 0, 0, 0, 0, 0, 0, "Wolf Den"], ...m },
        ...(army && { GA: army }),
    }
}

function detector() {
    const bot = fakeBot()
    bot.playerInfo.alliance = { id: ALLIANCE }
    loadModule("plugins/incoming.js", { bot, items: { units } })
    const seen = []
    for (const name of ["incoming:new", "incoming:updated", "incoming:cleared"])
        bot.events.on(name, attack => seen.push([name, attack.movementId, attack.army]))
    const gam = (...marches) => bot.xtHandler.emit("gam", { M: marches, O: owners }, 0)
    return { bot, seen, gam }
}

describe("the incoming attack detector", () => {
    test("reports a player outside the alliance attacking a member, with when it lands", () => {
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(1_800_000_000_000)
        const { bot, gam } = detector()
        const reported = []
        bot.events.on("incoming:new", attack => reported.push(attack))

        gam(march({ PT: 100 }))

        expect(reported).toHaveLength(1)
        expect(reported[0]).toMatchObject({
            movementId: 42, kingdom: 0, arrivesAt: 1_800_000_500_000,
            attacker: { ownerID: 1, name: "Raider", allianceName: "Wolves" },
            sourceCastle: { x: 0, y: 0 },
            defender: { ownerID: 5, name: "Ada" },
            targetCastle: { x: 3, y: 4 },
        })
        expect(reported[0].army).toBeUndefined()
        expect(reported[0].waves).toBeUndefined()
    })

    test("counts the soldiers of a visible army, tools left out", () => {
        const { bot, gam } = detector()
        const reported = []
        bot.events.on("incoming:new", attack => reported.push(attack))

        gam(march({ army: { L: [[10, 50], [611, 5]], M: [[11, 100]], R: [[10, 30]], RW: [[11, 20]] } }))

        expect(reported[0].army).toBe(200)
        expect(reported[0].waves.middle).toEqual([{ unitInfo: units[1], amount: 100 }])
    })

    test("ignores attacks by NPCs, by alliance members and on players outside the alliance, and other movement types", () => {
        const { seen, gam } = detector()

        gam(
            march({ id: 1, from: -801 }),
            march({ id: 2, from: 3 }),
            march({ id: 3, to: 6 }),
            march({ id: 4, type: 1 }),
            march({ id: 5, type: 2 }),
        )

        expect(seen).toEqual([])
    })

    test("each movement type the alert covered still counts as an attack", () => {
        const { seen, gam } = detector()

        gam(...[0, 25, 31, 24, 29].map((type, i) => march({ id: 100 + i, type })))

        expect(seen.map(([name, id]) => [name, id])).toEqual([100, 101, 102, 103, 104].map(id => ["incoming:new", id]))
    })

    test("an attack sighted again is not reported twice, and its army is reported once it becomes visible", () => {
        // Sent directly: newMovement in protocols.js assigns before it compares canSeeArmy, so it never re-emits a sighting.
        const bot = fakeBot()
        bot.playerInfo.alliance = { id: ALLIANCE }
        const movementEvents = new EventEmitter()
        loadModule("plugins/incoming.js", { bot, extra: { "protocols.js": { movementEvents } } })
        const seen = []
        for (const name of ["incoming:new", "incoming:updated"])
            bot.events.on(name, attack => seen.push([name, attack.movementId, attack.army]))
        const sighting = canSeeArmy => ({
            id: 42, type: 0, kingdomID: 0, totalTime: 600_000, deltaTime: Date.now(), canSeeArmy,
            sourceOwner: { ownerID: 1, allianceID: 2 }, targetOwner: { ownerID: 5, allianceID: ALLIANCE },
            left: [{ unitInfo: units[0], amount: 50 }], middle: [], right: [], courtyard: [],
        })

        movementEvents.emit("outgoing", sighting(false))
        movementEvents.emit("outgoing", sighting(false))
        movementEvents.emit("outgoing", sighting(true))
        movementEvents.emit("outgoing", sighting(true))

        expect(seen).toEqual([["incoming:new", 42, undefined], ["incoming:updated", 42, 50]])
    })

    test("is cleared when it lands", async () => {
        vi.useFakeTimers()
        const { seen, gam } = detector()

        gam(march({ PT: 590 }))
        await vi.advanceTimersByTimeAsync(9_999)
        expect(seen.map(([name]) => name)).toEqual(["incoming:new"])

        await vi.advanceTimersByTimeAsync(1)
        expect(seen.map(([name]) => name)).toEqual(["incoming:new", "incoming:cleared"])
    })

    test("is cleared early when the game removes the movement, and only once", async () => {
        vi.useFakeTimers()
        const { bot, seen, gam } = detector()

        gam(march())
        bot.xtHandler.emit("dms", { MID: [42] }, 0)
        await vi.advanceTimersByTimeAsync(700_000)

        expect(seen.map(([name, id]) => [name, id])).toEqual([["incoming:new", 42], ["incoming:cleared", 42]])
    })
})
