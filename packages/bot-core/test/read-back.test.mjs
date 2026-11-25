import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { READ_BACK_MAX_CASTLES, READ_BACK_MAX_MOVEMENTS, ReadBack } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const ActionType = require("../actions.json")
const { MAX_CASTLES, MAX_MOVEMENTS } = require("../readBack.js")
const castleLists = require("./fixtures/protocol/read-back-castles.json")
const khan = require("./fixtures/protocol/khan-20261122.json")

const NOW = 1_800_000_000_000
const ME = 2000001
const units = [{ wodID: 271, role: "melee" }, { wodID: 272, role: "ranged" }, { wodID: 950, toolCategory: "Basic" }, { wodID: 10, role: "ranged" }]
const owners = [{ OID: ME, N: "Ada", AID: 9 }, { OID: 3, N: "Friend", AID: 9 }, { OID: 6, N: "Raider", AID: 4 }]

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

/** A `gam` entry: by default the account's own attack on a baron tower, 600 s long with 100 s behind it. */
const march = ({ id, type = 0, from = ME, to = -1, target = [2, 5, 6, 77, -1], source = [1, 693, 526, 1000001, ME, 8, 8, 7, 7, 2, "Main Keep"], army = {}, ...m }) =>
    ({ M: { MID: id, T: type, KID: 0, OID: from, SID: from, TID: to, TT: 600, PT: 100, HBW: -1, TA: target, SA: source, ...m }, ...army })
const myKeep = [1, 693, 526, 1000001, ME, 8, 8, 7, 7, 2, "Main Keep"]

/** The game's side of a signed-in bot. `report` has the game list its coins, which is when the worker reports its status. */
function session() {
    const bot = fakeBot()
    bot.playerInfo.playerID = ME
    const reports = []
    const parentPort = { on() {}, postMessage: ([type, payload]) => type == ActionType.StatusUser && reports.push(structuredClone(payload.readBack)) }
    loadModule("protocols.js", { bot, items: { units }, parentPort })
    const emit = (command, payload) => bot.xtHandler.emit(command, payload, 0)
    const report = (coins = 1000, rubies = 50) => {
        emit("gcu", { C1: coins, C2: rubies })
        return reports.at(-1)
    }
    return { emit, report, reports }
}

describe("the read-back snapshot in the worker's status report", () => {
    test("lists each castle's stores with what an hour adds or takes", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)
        emit("dcl", castleLists.dcl)

        vi.setSystemTime(NOW + 90_000)
        const { castles } = report()

        expect(castles.map(castle => [castle.kingdom, castle.id])).toEqual([[0, 1000001], [0, 1000002], [4, 1000003]])
        expect(castles[0].readAt, "when the game listed the stores, not when the report left").toBe(NOW)
        expect(castles[0].stock.wood).toEqual({ amount: 175000, max: 175000, perHour: 19 })
        expect(castles[0].stock.stone).toEqual({ amount: 139641, max: 175000, perHour: 1623 })
        expect(castles[0].stock.food, "food is what the castle makes less what its troops eat").toEqual({ amount: 763000, max: 763000, perHour: 22611 })
        expect(castles[2].stock.mead, "a castle that only drinks its mead").toEqual({ amount: 7400000, max: 9000000, perHour: -53972 })
    })

    test("leaves out a good the castle neither holds nor makes", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)
        emit("dcl", castleLists.dcl)

        expect(Object.keys(report().castles[2].stock)).toEqual(["food", "mead", "aqua"])
    })

    test("has no stores for a castle the game hasn't listed stores for", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)

        expect(report().castles).toEqual([])
    })

    test("reads a captured Khan taunt as an attack coming in, with its soldiers and when it lands", () => {
        const { emit, report } = session()
        emit("gam", khan.gam[1].payload)

        const { movements, movementCount } = report()

        expect(movementCount).toBe(1)
        expect(movements).toEqual([{
            id: 436025526, side: "incoming", kind: "attack", kingdom: 0,
            from: { type: 35, x: 114, y: 320, name: null },
            to: { type: 1, x: 293, y: 226, name: "<redacted>" },
            sender: null,
            // The 271s and 272s of the three flanks; the 950s are tools.
            troops: 35 + 77 + 70 + 56 + 63 + 70,
            totalSeconds: 400,
            arrivesAt: NOW + 397_000,
        }])
    })

    test("tells the account's own marches, friendly troops coming to it and other players' marches apart", () => {
        const { emit, report } = session()
        emit("gam", { O: owners, M: [
            march({ id: 1 }),
            march({ id: 2, to: ME, target: myKeep, source: [2, 5, 6, 77, -1] }),
            march({ id: 3, type: 1, from: 3, to: ME, target: myKeep, source: [1, 1, 1, 30, 3, 0, 0, 0, 0, 0, "Friend Hall"], army: { A: [[10, 250]] } }),
            march({ id: 4, from: 6, to: 3 }),
        ] })

        const byId = Object.fromEntries(report().movements.map(m => [m.id, m]))

        expect(byId[1]).toMatchObject({ side: "own", kind: "attack", sender: null, troops: null })
        expect(byId[2]).toMatchObject({ side: "own", kind: "return", to: { name: "Main Keep" } })
        expect(byId[3]).toMatchObject({ side: "support", kind: "station", sender: "Friend", troops: 250, from: { name: "Friend Hall" } })
        expect(byId[4]).toMatchObject({ side: "other", kind: "attack", sender: "Raider" })
    })

    test("leaves out an army that already stands in its castle", () => {
        const { emit, report } = session()
        emit("gam", { O: owners, M: [march({ id: 1, type: 1, PT: 600, TT: 600 }), march({ id: 2 })] })

        expect(report().movements.map(m => m.id)).toEqual([2])
    })

    test("keeps the marches at the account first when there are more than it carries, and says how many there were", () => {
        const { emit, report } = session()
        const others = Array.from({ length: MAX_MOVEMENTS + 20 }, (_, i) => march({ id: 100 + i, from: 6, to: 3, PT: 500 - i }))
        emit("gam", { O: owners, M: [...others, march({ id: 1, PT: 0 }), march({ id: 2, from: 6, to: ME, target: myKeep, PT: 0 })] })

        const snapshot = report()

        expect(snapshot.movementCount).toBe(MAX_MOVEMENTS + 22)
        expect(snapshot.movements).toHaveLength(MAX_MOVEMENTS)
        expect(snapshot.movements.slice(0, 2).map(m => [m.id, m.side])).toEqual([[2, "incoming"], [1, "own"]])
        expect(snapshot.movements[2].arrivesAt, "the rest by who lands first").toBeLessThan(snapshot.movements[3].arrivesAt)
    })

    test("counts coins and rubies gained since the game first reported them", () => {
        const { report } = session()

        expect(report(1000, 50).session).toEqual({ startedAt: NOW, coins: 0, rubies: 0 })
        vi.setSystemTime(NOW + 60_000)
        expect(report(45_400, 48).session).toEqual({ startedAt: NOW, coins: 44_400, rubies: -2 })
    })

    test("is a snapshot the app accepts, and small enough to ride in every status report", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)
        emit("dcl", castleLists.dcl)
        emit("gam", { O: owners, M: Array.from({ length: 80 }, (_, i) => march({ id: i + 1, from: 6, to: ME, target: myKeep, source: [1, 1, 1, 30, 6, 0, 0, 0, 0, 0, "A castle with a long name"], army: { GA: { L: [[271, 4200]] } } })) })

        const snapshot = report()

        expect(ReadBack.safeParse(snapshot).error).toBeUndefined()
        expect(JSON.stringify(snapshot).length).toBeLessThan(16_000)
    })

    test("caps its lists where the app's schema does", () => {
        expect([MAX_CASTLES, MAX_MOVEMENTS]).toEqual([READ_BACK_MAX_CASTLES, READ_BACK_MAX_MOVEMENTS])
    })
})
