import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { KHAN_TAUNT_HOLDS, READ_BACK_MAX_CASTLES, READ_BACK_MAX_DEFENCE_SLOTS, READ_BACK_MAX_DEFENCE_TOOLS, READ_BACK_MAX_MOVEMENTS, ReadBack } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const ActionType = require("../actions.json")
const { MAX_CASTLES, MAX_MOVEMENTS, MAX_DEFENCE_SLOTS, MAX_DEFENCE_TOOLS } = require("../readBack.js")
const { TAUNT_HOLDS } = require("../khan.js")
const castleLists = require("./fixtures/protocol/read-back-castles.json")
const khan = require("./fixtures/protocol/khan-20261122.json")

const NOW = 1_800_000_000_000
const ME = 2000001
const units = [
    { wodID: 271, role: "melee" }, { wodID: 272, role: "ranged" }, { wodID: 950, toolCategory: "Basic", typ: "Attack" }, { wodID: 10, role: "ranged" },
    { wodID: 220, role: "melee", fightType: "1" }, { wodID: 222, role: "melee", fightType: "1" },
    { wodID: 110, typ: "Defence" }, { wodID: 112, typ: "Defence" }, { wodID: 622, typ: "Defence" },
]
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
    return { emit, report, reports, bot }
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
        expect([MAX_CASTLES, MAX_MOVEMENTS, MAX_DEFENCE_SLOTS, MAX_DEFENCE_TOOLS])
            .toEqual([READ_BACK_MAX_CASTLES, READ_BACK_MAX_MOVEMENTS, READ_BACK_MAX_DEFENCE_SLOTS, READ_BACK_MAX_DEFENCE_TOOLS])
    })
})

const dfc = khan.dfc_1.reply.payload
/** The castle lists, with soldiers in the main castle: 8,375 defenders and 100 attackers. */
function castlesWithTroops() {
    const dcl = structuredClone(castleLists.dcl)
    dcl.C[0].AI[0].AC = [[220, 959], [222, 7416], [271, 100], [110, 5]]
    return dcl
}

describe("the main castle's defence in the snapshot", () => {
    test("is absent until the game has listed the defence", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)

        expect(report()).not.toHaveProperty("defence")
    })

    test("reads a captured defence: the works, each side's slots, the room and the tools in storage", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)
        emit("dcl", castlesWithTroops())
        emit("dfc", dfc)

        vi.setSystemTime(NOW + 90_000)
        const { defence } = report()

        const balistraria = amount => ({ wodID: 110, amount })
        expect(defence).toEqual({
            kingdom: 0, id: 1000001, readAt: NOW,
            wall: {
                level: 8, defence: 315.7, troops: 5031, room: 5031,
                sides: {
                    left: { share: 30, slots: Array(4).fill(balistraria(686)) },
                    front: { share: 40, slots: [balistraria(699), { wodID: 622, amount: 303 }, balistraria(699), balistraria(699), { wodID: 622, amount: 303 }, balistraria(699)] },
                    right: { share: 30, slots: Array(4).fill(balistraria(686)) },
                },
            },
            // The capture has no gate figure.
            gate: { level: 7, defence: null },
            moat: { level: 2, defence: 147, sides: { left: [{ wodID: 112, amount: 686 }], front: [{ wodID: 112, amount: 699 }], right: [{ wodID: 112, amount: 686 }] } },
            courtyard: { troops: 433000, room: 433000, allianceRoom: 252500 },
            defenders: 959 + 7416,
            tools: [{ wodID: 110, amount: 50497 }, { wodID: 112, amount: 41263 }, { wodID: 622, amount: 5309 }],
        })
    })

    test("shows an empty slot as empty, the gate figure when the game sends one, and only defence tools from storage", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)
        emit("dfc", { ...dfc, GD: 306.6, dfw: { ...dfc.dfw, L: { S: [[110, 12], [-1, 0]], UP: 30, UC: 0 } }, gui: { I: [[271, 4000], [950, 800], [110, 0], [622, 9]] } })

        const { defence } = report()

        expect(defence.wall.sides.left.slots).toEqual([{ wodID: 110, amount: 12 }, null])
        expect(defence.gate).toEqual({ level: 7, defence: 306.6 })
        expect(defence.tools).toEqual([{ wodID: 622, amount: 9 }])
    })

    test("ignores a defence the game refused and one of another castle", () => {
        const { emit, report, bot } = session()
        emit("gcl", castleLists.gcl)
        bot.xtHandler.emit("dfc", dfc, 28)
        emit("dfc", { ...dfc, A: [4, 658, 562, 1000002, ME, 8, 8, 7, 7, 2, "North Post"] })

        expect(report()).not.toHaveProperty("defence")
    })

    test("keeps within its caps and stays a snapshot the app accepts", () => {
        const { emit, report } = session()
        emit("gcl", castleLists.gcl)
        const many = Array.from({ length: 30 }, () => [110, 999])
        emit("dfc", { ...dfc, dfw: { ...dfc.dfw, M: { S: many, UP: 40, UC: 0 } }, gui: { I: Array.from({ length: 60 }, (_, i) => [[110, 112, 622][i % 3], 1000 + i]) } })

        const snapshot = report()

        expect(snapshot.defence.wall.sides.front.slots).toHaveLength(MAX_DEFENCE_SLOTS)
        expect(snapshot.defence.tools).toHaveLength(MAX_DEFENCE_TOOLS)
        expect(snapshot.defence.tools[0].amount, "the largest stocks first").toBe(1059)
        expect(ReadBack.safeParse(snapshot).error).toBeUndefined()
        expect(JSON.stringify(snapshot.defence).length).toBeLessThan(2_000)
    })
})

describe("reading the main castle's defence for the snapshot", () => {
    const dfcSent = bot => bot.sent.filter(([command]) => command == "dfc")
    function signedIn() {
        const game = session()
        game.emit("gcl", castleLists.gcl)
        game.bot.events.emit("load")
        return game
    }

    test("asks the game a few minutes after sign-in, the way the defence screen does", async () => {
        const { bot } = signedIn()

        await vi.advanceTimersByTimeAsync(119_000)
        expect(dfcSent(bot)).toEqual([])
        await vi.advanceTimersByTimeAsync(4 * 60_000 + 1000)
        expect(dfcSent(bot)).toEqual([["dfc", { CX: 693, CY: 526, AID: 1000001, KID: -1 }]])
    })

    test("asks again no sooner than 15 minutes after the last answer, and within 25", async () => {
        const { bot, emit } = signedIn()
        await vi.advanceTimersByTimeAsync(6 * 60_000)
        emit("dfc", dfc)

        await vi.advanceTimersByTimeAsync(15 * 60_000 - 1000)
        expect(dfcSent(bot)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(10 * 60_000 + 2000)
        expect(dfcSent(bot)).toHaveLength(2)
    })

    test("doesn't ask while a defence another part of the bot read is fresh", async () => {
        const { bot, emit } = signedIn()
        await vi.advanceTimersByTimeAsync(60_000)
        emit("dfc", dfc)

        await vi.advanceTimersByTimeAsync(15 * 60_000)
        expect(dfcSent(bot), "the Khan gate's read stands in for the first one").toEqual([])
        await vi.advanceTimersByTimeAsync(11 * 60_000)
        expect(dfcSent(bot)).toHaveLength(1)
    })

    test("stops asking once the worker unloads", async () => {
        const { bot } = signedIn()
        bot.events.emit("unload")

        await vi.advanceTimersByTimeAsync(60 * 60_000)
        expect(dfcSent(bot)).toEqual([])
    })
})

describe("the Khan rage bar in the snapshot", () => {
    const state = { rage: 1426, needed: 2460, campLevel: 50, lastGain: 1426, lastGainAt: NOW - 5000, eventRunning: true, hold: "toolsShort" }

    test("is absent while no Khan plugin shares one", () => {
        const { report } = session()

        expect(report()).not.toHaveProperty("khanRage")
    })

    test("carries what the Khan plugin shares, as it stands when the report leaves", () => {
        const { report } = session()
        const shared = { ...state }
        require("../khanRage.js").shareKhanRage(() => shared)

        expect(report().khanRage).toEqual(state)
        shared.rage = 2460
        const snapshot = report()
        expect(snapshot.khanRage.rage).toBe(2460)
        expect(ReadBack.safeParse(snapshot).error).toBeUndefined()
    })

    test("is absent again while the plugin has nothing to show, and reads a bar of unknown size as such", () => {
        const { report } = session()
        const { shareKhanRage } = require("../khanRage.js")

        shareKhanRage(() => undefined)
        expect(report()).not.toHaveProperty("khanRage")
        shareKhanRage(() => ({ rage: 300, needed: NaN, campLevel: null, lastGain: null, lastGainAt: null, eventRunning: true, hold: undefined }))
        expect(report().khanRage).toEqual({ rage: 300, needed: null, campLevel: null, lastGain: null, lastGainAt: null, eventRunning: true, hold: null })
    })

    test("names the same taunt holds as the app's schema", () => {
        expect(TAUNT_HOLDS.map(([hold]) => hold)).toEqual([...KHAN_TAUNT_HOLDS])
    })
})

