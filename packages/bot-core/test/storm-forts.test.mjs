import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { readLegacy as contractsRead } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { melee, ranged, tool } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { readLegacy } = require("../legacyOptions.js")

afterEach(() => vi.useRealTimers())

const options = loadModule("plugins/attack/attackStormForts.js", { mainThread: true }).mod.pluginOptions
const fort = (x, y, levelCode, hitsLeft = 3) => ({ type: 25, x, y, extraData: [0, 0, levelCode, 0, hitsLeft, 0], timeSinceRequest: 0 })
const inventory = () => [melee(601, 5000, { meleeAttack: "90" }), ranged(603, 5000, { rangeAttack: "80" }), tool(614, 400, { wallBonus: "10" })]
const storm = (stored, game = {}) => runEvent("attackStormForts", { commanderWhiteList: "1-99", allowLvl70Easy: true, allowLvl80Easy: true, ...stored }, {
    inventory: inventory(), areas: [fort(160, 160, 9), fort(105, 100, 8)], castle: { aqua: 0, getProductionData: { maxAmountAqua: 1_000_000 } }, ...game,
})
/** The packages the shop was asked for with `aqua` in a store that holds `max`. No commander is free, so no fort is attacked. */
async function shop(stored, aqua, max = aqua) {
    const { frames } = await storm({ buyCoins: false, ...stored }, { castle: { aqua, getProductionData: { maxAmountAqua: max } }, sends: 0, answer: command => command == "sbp" ? [{}, 0] : undefined })
    await new Promise(resolve => setTimeout(resolve, 20))
    return frames.filter(([command]) => command == "sbp").map(([, order]) => order.PID)
}

describe("Storm forts", () => {
    test.each([[{}, {}], [{ buyDecoration: true }, { decoration: 3 }], [{ buyDecoration: false }, { decoration: 0 }], [{ buyDecoration: true, decoration: 1 }, { decoration: 1 }]])(
        "a stored %j reads as %j, for the bot and the contracts alike", (stored, read) => {
            expect(readLegacy(options, stored)).toEqual(read)
            expect(contractsRead(options, stored)).toEqual(read)
        })

    test("as stored today the highest fort goes first, and Nearest first goes by distance", async () => {
        expect((await storm({})).cra).toMatchObject({ TX: 160, TY: 160 })
        expect((await storm({ fortOrder: 1 })).cra).toMatchObject({ TX: 105, TY: 100 })
    })

    test("Waves sends the written plan, with the storm's loot setting", async () => {
        const slot = (item, amount) => ({ item, amount })
        const none = { kind: "preset", preset: 0 }
        const first = { kind: "custom", left: { tools: [slot(614, 10), null], units: [slot(603, 40), null] }, front: { tools: [null, null, null], units: [slot(601, 100), null, null, null, null, null] }, right: { tools: [null, null], units: [null, null] } }
        const { cra } = await storm({ armyMode: "waves", waves: { kind: "manual", waves: [first, none, none, none], ast: [null, null, null], rw: [null, null, null, null, null, null, null, null] } })
        expect(cra.LP).toBe(3)
        expect(cra.A[0].L).toEqual({ T: [[614, 10], [-1, 0]], U: [[603, 40], [-1, 0]] })
        expect(cra.A[0].M.U[0]).toEqual([601, 100])
    })

    test("log only sends no attack", async () => {
        expect((await storm({ dryRun: true }, { wait: 10 })).sent).toEqual([])
    })
})

describe("the Storm event closing", () => {
    const STORM_EID = 999
    const watching = secondsLeft => {
        const real = loadModule("stormClosing.js").mod
        return { "stormClosing.js": { ...real, STORM_EVENT_ID: STORM_EID, stormWatch: (id, deps) => real.stormWatch(id, { ...deps, activeEvent: () => ({ EID: STORM_EID, RS: secondsLeft }) }) } }
    }
    const nearestFirst = { fortOrder: 1 }

    test("once a march is known to outlast the event no fort is attacked, and the plugin stops with a status", async () => {
        const game = await storm(nearestFirst, { extra: watching(30), sends: 2 })
        expect(game.sent).toHaveLength(1)
        expect(game.sent[0]).toMatchObject({ TX: 105, TY: 100 })
        expect(game.statuses.at(-1)).toMatchObject({ state: "stopped", reasonKey: "statusStormClosing" })
    })

    test("with time enough for the march every fort is attacked", async () => {
        const game = await storm(nearestFirst, { extra: watching(100_000), sends: 2 })
        expect(game.sent).toHaveLength(2)
        expect(game.statuses.map(status => status.reasonKey)).not.toContain("statusStormClosing")
    })

    test("with no event id known the plugin never stops for closing", async () => {
        const game = await storm(nearestFirst, { sends: 2 })
        expect(game.sent).toHaveLength(2)
    })
})

describe("the Storm Islands shop", () => {
    test("nothing is bought until the aquamarine store is nearly full", async () => {
        expect(await shop({ buyCoins: true }, 400_000, 1_000_000)).toEqual([])
    })
    test("the old Buy decoration checkbox still buys the Whale Lagoon", async () => {
        expect(await shop({ buyDecoration: true }, 250_000)).toEqual([3117, 3117])
    })
    test("a picked decoration is the one bought", async () => {
        expect(await shop({ decoration: 2 }, 160_000)).toEqual([3118, 3118])
    })
    test("5-hour skips stop at the 10 the shop sells, and the rest goes to the next choice", async () => {
        const bought = await shop({ buySkips5h: true, buyDummyPeasants: true }, 403_140)
        expect(bought.filter(pid => pid == 3122)).toHaveLength(10)
        expect(bought.filter(pid => pid == 248)).toHaveLength(2)
    })
    test("the bot spends only what is above the aquamarine it keeps", async () => {
        expect(await shop({ buyCoins: true, aquaKeep: 100_000 }, 260_000)).toEqual([2798, 2798])
    })
    test("log only buys nothing", async () => {
        expect(await shop({ buyCoins: true, dryRun: true }, 260_000)).toEqual([])
    })
})

describe("mead for the Storm Islands", () => {
    async function mead(stored, mainMead) {
        vi.useFakeTimers()
        const bot = fakeBot()
        bot.botConfig.plugins.meadReplaceStorm = stored
        const sent = []
        const stormCastle = { id: 2, kingdomID: 4, areaInfo: { type: 12 }, mead: 1000, getProductionData: { MeadConsumptionRate: 1000, maxAmountMead: 50_000 } }
        const mainCastle = { id: 1, kingdomID: 0, areaInfo: { type: 1 }, mead: mainMead }
        loadModule("plugins/meadReplaceStorm.js", {
            bot, extra: {
                "protocols.js": {
                    KingdomSkipType: { sendResource: 2 }, KingdomID: { stormIslands: 4, greatEmpire: 0 }, AreaType: { externalKingdom: 12, mainCastle: 1 },
                    castles: [stormCastle, mainCastle], unlockInfoList: [{ kingdomID: 4, isUnlocked: true }],
                    ClientCommands: { kingdomUnitTransfer: async (...order) => { sent.push(order); return 0 } },
                },
                "skips.js": { spendSkip() {} },
            },
        })
        bot.events.emit("load")
        // The sender waits up to 15 s for the dcl refresh, which nothing answers here.
        await vi.advanceTimersByTimeAsync(20_000)
        return sent
    }
    test("as stored today it fills the Storm castle", async () => {
        expect(await mead({}, 20_000)).toEqual([[1, 0, 4, [["MEAD", 49_000]]]])
    })
    test("with a reserve it sends only what the main castle holds beyond it", async () => {
        expect(await mead({ sourceReserve: 15_000 }, 20_000)).toEqual([[1, 0, 4, [["MEAD", 5000]]]])
        expect(await mead({ sourceReserve: 25_000 }, 20_000)).toEqual([])
    })
    test("with a lower threshold, mead that still lasts an hour is not sent yet", async () => {
        const stored = { refillBelowHours: 0.5 }
        expect(await mead(stored, 20_000)).toEqual([])
    })
})

describe("a refused attack screen", () => {
    test("holds that fort, and the plugin attacks another without stopping", async () => {
        const { runEvent } = require("./harness/event-bots.cjs")
        const { tool, melee, ranged } = require("./harness/army-bots.cjs")
        const fort = x => ({ type: 25, x, y: 100, extraData: [0, 0, 8, 0, 3, 0], timeSinceRequest: 0 })
        const openAttackScreen = async (castle, areaInfo, kingdomID, commander) => {
            if (areaInfo.x == 105)
                throw "ATTACK_SCREEN_REFUSED"
            return commander
        }
        const { sent, statuses } = await runEvent("attackStormForts", { commanderWhiteList: "1-99", allowLvl70Easy: true, allowLvl80Easy: true }, {
            inventory: [melee(601, 5000), ranged(603, 5000), tool(614, 400, { wallBonus: "10" })], areas: [fort(105), fort(108)],
            castle: { aqua: 0, getProductionData: { maxAmountAqua: 1_000_000 } }, openAttackScreen, sends: 3, wait: 30,
        })
        expect(sent.map(cra => cra.TX)).toEqual([108, 108])
        expect(statuses.map(status => status.state)).not.toContain("stopped")
    })
})
