import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { readLegacy as contractsRead, effectivePluginConfig } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { melee, ranged, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { readLegacy } = require("../legacyOptions.js")
const { khanWaveOptions, parseKhan, waveKind, incomingTaunts } = require("../khan.js")

const options = loadModule("plugins/attack/attackKhan.js", { mainThread: true }).mod.pluginOptions

describe("rage waves, stored as wavesTillChests before", () => {
    const STORED = [[{}, {}], ...[["", 0], ["0", 0], ["1", 0], ["2", 1], ["4", 3], ["6", 5], ["9", 6], ["x", 6]].map(([text, waves]) => [{ wavesTillChests: text }, { rageWaves: waves }]), [{ wavesTillChests: "2", rageWaves: 4 }, { rageWaves: 4 }]]
    test.each(STORED)("%j reads as %j, for the bot and the contracts alike", (stored, read) => {
        expect(readLegacy(options, stored)).toEqual(read)
        expect(contractsRead(options, stored)).toEqual(read)
    })
    test("the old default and the new defaults mean the same waves", () => {
        const read = stored => effectivePluginConfig([{ key: "khan", force: false, hidden: false, options }], { khan: { enabled: true, options: stored } }).khan
        expect(read({ wavesTillChests: "4" })).toEqual(read({}))
        expect(read({})).toMatchObject({ rageWaves: 3, boosterWaves: 6, tabletsOnly: false, pauseAtTaunts: 0, stockFlamingArrows: 0 })
    })
    test("rage waves come first, then chest waves, then troops only", () => {
        const khan = parseKhan(readLegacy(khanWaveOptions(), { rageWaves: 1, boosterWaves: 2 }))
        expect([1, 2, 3, 4].map(index => waveKind(khan, index))).toEqual(["rage", "booster", "booster", "troops"])
        const old = parseKhan(readLegacy(khanWaveOptions(), { wavesTillChests: "2" }))
        expect([1, 2, 3, 4, 5].map(index => waveKind(old, index))).toEqual(["rage", "booster", "booster", "booster", "booster"])
    })
})

const eventTool = (wodID, amount, info) => unit(wodID, amount, { fightType: 0, typ: "Attack", slotTypes: "1,2,9", ...info })
const inventory = () => [
    melee(601, 5000, { meleeAttack: "90" }), ranged(603, 5000, { rangeAttack: "80" }),
    eventTool(106, 500, { ragePointBonus: "1" }), eventTool(563, 500, { ragePointBonus: "2" }),
    eventTool(162, 500, { khanTabletBooster: "4" }), eventTool(164, 500, { khanTabletBooster: "6" }),
]
const camp = () => ({ type: 35, x: 110, y: 105, extraData: [0, 0, 0, 0, 0, 0, 5] })
const items = { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50", playerRageCap: "1500" }] }
const khan = (stored, game = {}) => runEvent("attackKhan", { commanderWhiteList: "1-99", useFood: true, ...stored }, { inventory: inventory(), areas: [camp()], start: { EDID: 3 }, items, ...game })
const toolsOf = wave => [...new Set([...wave.L.T, ...wave.R.T, ...wave.M.T].map(([wodID]) => wodID).filter(wodID => wodID != -1))]

describe("Khan waves", () => {
    test("one rage wave and one chest wave leave the last wave to the troops", async () => {
        const { cra } = await khan({ rageWaves: 1, boosterWaves: 1 })
        expect(cra.A.slice(1).map(toolsOf)).toEqual([[563], [164], []])
    })
    test("picked rage tools are the only ones used, in the order picked", async () => {
        const { cra } = await khan({ rageWaves: 1, boosterWaves: 0, rageTools: [106] })
        expect(cra.A.slice(1).map(toolsOf)).toEqual([[106], [], []])
    })
    test("picked tablet chests are the only ones used, in the order picked", async () => {
        const { cra } = await khan({ rageWaves: 0, boosterWaves: 1, tabletChests: [162, 106] })
        expect(cra.A.slice(1).map(toolsOf)).toEqual([[162], [], []])
    })
    test("Waves sends the written plan", async () => {
        const slot = (item, amount) => ({ item, amount })
        const none = { kind: "preset", preset: 0 }
        const first = { kind: "custom", left: { tools: [slot(106, 5), null], units: [slot(603, 40), null] }, front: { tools: [null, null, null], units: [null, null, null, null, null, null] }, right: { tools: [null, null], units: [null, null] } }
        const { cra } = await khan({ armyMode: "waves", waves: { kind: "manual", waves: [first, none, none, none], ast: [null, null, null], rw: [null, null, null, null, null, null, null, null] } })
        expect(cra.A[0].L).toEqual({ T: [[106, 5], [-1, 0]], U: [[603, 40], [-1, 0]] })
        expect(cra.A.slice(1).map(toolsOf)).toEqual([[], [], []])
    })
})

describe("Khan skips", () => {
    const waiting = () => ({ ...camp(), extraData: [0, 0, 300, 0, 0, 0, 5] })

    test("a march home and the attack loop spend one skip between them on the camp they share", async () => {
        const movementEvents = new EventEmitter()
        const area = waiting()
        const waitToAttack = async job => {
            movementEvents.emit("returning", { owner: { ownerID: 7 }, sourceAttack: area })
            return job()
        }
        const { sent, skipped } = await khan({}, { areas: [area], movementEvents, waitToAttack, skipLands: () => new Promise(resolve => setTimeout(resolve, 2)) })
        expect(skipped).toEqual(["MS3"])
        expect(sent).toHaveLength(1)
    })

    test("a skip that fails after a march home goes to the plugin's log", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const movementEvents = new EventEmitter()
        await khan({}, { movementEvents, spendSkip: () => undefined })
        movementEvents.emit("returning", { owner: { ownerID: 7 }, sourceAttack: waiting() })
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: "couldntFindSkip" }))
        warn.mockRestore()
    })
})

describe("Khan, setting the event difficulty", () => {
    // The Khan's difficulty rows are not captured; these stand in with the shape of the Samurai's.
    const eventAutoScalingDifficulties = [{ eventID: 72, difficultyTypeID: 5, difficultyID: 105 }]
    const game = (reply, more = {}) => ({ start: { EDID: -1 }, items: { ...items, eventAutoScalingDifficulties, ...more }, answer: cmd => cmd == "sede" ? reply : undefined, wait: 10 })
    afterEach(() => vi.restoreAllMocks())

    test("sets the chosen difficulty, and attacks once the game accepts it", async () => {
        const { sent, frames } = await khan({ eventDifficulty: 5 }, game(["", 0]))
        expect(frames).toContainEqual(["sede", { EID: 72, EDID: 105, C2U: 0 }])
        expect(sent).toHaveLength(1)
    })

    test("a difficulty the game refuses is not taken as set: nothing is attacked and the status says why", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        // The refusal code is not captured; 437 is the err table's INVALID_EVENT_DIFFICULTY_ID.
        const { sent, statuses } = await khan({ eventDifficulty: 5 }, game(["", 437]))
        expect(sent).toEqual([])
        expect(warn).toHaveBeenCalledWith("campDifficultyRefused", "INVALID_EVENT_DIFFICULTY_ID")
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusCampDifficultyRefused" })
    })

    test("Classic, which has no difficulty to set, asks nothing of the game and attacks the classic camps", async () => {
        const { sent, frames } = await khan({ eventDifficulty: 0 }, game(["", 0], { nomadCamps: [{ id: 0, countVictory: "1" }] }))
        expect(frames.map(([command]) => command)).not.toContain("sede")
        expect(sent).toHaveLength(1)
    })
})

describe("Khan taunts", () => {
    const fullRage = async stored => {
        const run = await khan(stored)
        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0)
        return run.frames.filter(([command]) => command == "lta")
    }
    test("a full rage bar taunts the Khan", async () => {
        expect(await fullRage({})).toEqual([["lta", { AV: 0, EID: 72 }]])
    })
    test("tablets only never taunts", async () => {
        expect(await fullRage({ tabletsOnly: true })).toEqual([])
    })
    test("log only never taunts", async () => {
        expect(await fullRage({ dryRun: true })).toEqual([])
    })

    const taunt = id => ({ id, owner: { ownerID: -801 }, targetOwner: { ownerID: 7 }, sourceAttack: { type: 35 } })
    const home = { id: 9, owner: { ownerID: 7 }, targetOwner: { ownerID: 7 }, sourceAttack: { type: 35 } }
    test("only the Khan's marches to the player count, not the player's own coming home", () => {
        expect(incomingTaunts([taunt(1), taunt(2), home, { owner: { ownerID: 55 }, targetOwner: { ownerID: 7 }, sourceAttack: { type: 1 } }], 7, 35)).toBe(2)
    })
    test("hits pause at the limit and say so", async () => {
        const { sent, statuses } = await khan({ pauseAtTaunts: 2 }, { movements: [taunt(1), taunt(2), home], wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusKhanTauntsPaused", params: { taunts: 2, limit: 2 } })
    })
    test("hits go on below the limit", async () => {
        const { sent } = await khan({ pauseAtTaunts: 3 }, { movements: [taunt(1), taunt(2), home] })
        expect(sent).toHaveLength(1)
    })
})

describe("Khan defence keeper option", () => {
    test("it sits right after the defence stock label and is off by default", () => {
        const keys = options.map(option => option.key)
        expect(keys[keys.indexOf("defenceStock") + 1]).toBe("keepDefence")
        expect(options.find(option => option.key == "keepDefence")).toMatchObject({ type: "Checkbox", default: false })
    })
    test("on, the plugin reads the main castle's defence when the event runs, and off it asks nothing", async () => {
        const read = async stored => (await khan(stored, { wait: 10 })).frames.filter(([command]) => command == "dfc")
        expect(await read({ keepDefence: true })).toEqual([["dfc", { CX: 100, CY: 100, AID: 1, KID: -1 }]])
        expect(await read({})).toEqual([])
    })
})

describe("defence tools from the armourer", () => {
    const units = [{ wodID: 629, type: "Brazier" }, { wodID: 637, type: "Oilsmelter" }]
    const packages = [{ packageID: "2476", unitID: "629", unitAmount: "1", packagePriceC1: "642" }, { packageID: "2472", unitID: "637", unitAmount: "1", packagePriceC1: "110" }]
    function armourer(coins) {
        const bot = fakeBot()
        bot.sendXT = async (command, params) => {
            bot.sent.push([command, JSON.parse(params)])
            setTimeout(() => bot.xtHandler.emit(command, {}, 0), 1)
        }
        const { mod } = loadModule("armourer.js", { bot, items: { units, packages }, extra: { "protocols.js": { resources: { coins }, activeEvent: () => ({ PIDS: [2476, 2472] }) }, "pacing.js": { pause: async () => {} } } })
        return { bot, topUp: mod.topUp }
    }
    const rows = [{ tool: 629, keep: 500, have: 499 }, { tool: 637, keep: 500, have: 500 }]
    const limits = { kingdom: 0, batch: 1000, coinFloor: 0, spendCap: 5_000_000 }

    test("a tool below its stock gets one batch of 1,000, and a tool at its stock gets none", async () => {
        const { bot, topUp } = armourer(10_000_000)
        expect(await topUp(rows, limits)).toEqual({ bought: 1000, spent: 642_000 })
        expect(bot.sent).toEqual([["sbp", { PID: 2476, BT: 0, TID: 27, AMT: 1000, KID: 0, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }]])
    })
    test("the spending cap and the coin floor each cut the batch short", async () => {
        const capped = armourer(10_000_000)
        expect(await capped.topUp(rows, { ...limits, spendCap: 64_200 })).toEqual({ bought: 100, spent: 64_200 })
        const floored = armourer(700_000)
        expect(await floored.topUp(rows, { ...limits, coinFloor: 636_000 })).toEqual({ bought: 99, spent: 63_558 })
        const broke = armourer(500)
        expect(await broke.topUp(rows, limits)).toEqual({ bought: 0, spent: 0 })
        expect(broke.bot.sent).toEqual([])
    })
    test("log only sends no order", async () => {
        const { bot, topUp } = armourer(10_000_000)
        await topUp(rows, { ...limits, dryRun: true })
        expect(bot.sent).toEqual([])
    })
})
