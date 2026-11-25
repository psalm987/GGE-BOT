import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { readLegacy as contractsRead, effectivePluginConfig } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { melee, ranged, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { readLegacy } = require("../legacyOptions.js")
const { khanWaveOptions, parseKhan, waveKind, incomingTaunts, tauntHold, defenceResult, tauntLandings, defenceGate, defendersIn } = require("../khan.js")
const capture = require("./fixtures/protocol/khan-20261122.json")

const options = loadModule("plugins/attack/attackKhan.js", { mainThread: true }).mod.pluginOptions

describe("rage waves, stored as wavesTillChests before", () => {
    const STORED = [[{}, {}], ...[["", 0], ["0", 0], ["1", 0], ["2", 1], ["4", 3], ["6", 5], ["9", 6], ["x", 6]].map(([text, waves]) => [{ wavesTillChests: text }, { rageWaves: waves }]), [{ wavesTillChests: "2", rageWaves: 4 }, { rageWaves: 4 }]]
    test.each(STORED)("%j reads as %j, for the bot and the contracts alike", (stored, read) => {
        expect(readLegacy(options, stored)).toEqual(read)
        expect(contractsRead(options, stored)).toEqual(read)
    })
    test.each([
        [{ supply: 0, foodTroopsOnly: true }, { supply: 1 }],
        [{ useFood: false }, { supply: 2 }],
        [{ supply: 0, useFood: true, foodTroopsOnly: false }, { supply: 0 }],
        [{ supply: 2, foodTroopsOnly: true }, { supply: 2 }],
        [{ supply: 1, useFood: false }, { supply: 1 }],
        [{ supply: 2 }, { supply: 2 }],
    ])("the food switches %j read as the troop supply %j, for the bot and the contracts alike", (stored, read) => {
        expect(readLegacy(options, stored)).toEqual(read)
        expect(contractsRead(options, stored)).toEqual(read)
    })
    test("the old default and the new defaults mean the same waves", () => {
        const read = stored => effectivePluginConfig([{ key: "khan", force: false, hidden: false, options }], { khan: { enabled: true, options: stored } }).khan
        expect(read({ wavesTillChests: "4" })).toEqual(read({}))
        expect(read({})).toMatchObject({ rageWaves: 3, boosterWaves: 6, tabletsOnly: false, pauseAtTaunts: 0, tauntMinDefenders: 0, stockFlamingArrows: 0 })
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
const khan = (stored, game = {}) => runEvent("attackKhan", { commanderWhiteList: "1-99", ...stored }, { inventory: inventory(), areas: [camp()], start: { EDID: 3 }, items, ...game })
const toolsOf = wave => [...new Set([...wave.L.T, ...wave.R.T, ...wave.M.T].map(([wodID]) => wodID).filter(wodID => wodID != -1))]

describe("Khan waves", () => {
    test("one rage wave and one chest wave leave the last wave to the troops", async () => {
        const { cra } = await khan({ rageWaves: 1, boosterWaves: 1 })
        expect(cra.A.slice(1).map(toolsOf)).toEqual([[563], [164], []])
    })
    test("Wall tools before event tools sends the rage waves without rage tools and leaves the chest waves alone", async () => {
        const { cra } = await khan({ rageWaves: 1, boosterWaves: 1, eventWallToolsFirst: true })
        expect(cra.A.slice(1).map(toolsOf)).toEqual([[], [164], []])
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
    test("a stored Use food troops switched off sends the mead troops, as Mead only does", async () => {
        const troops = cra => new Set(cra.A.flatMap(wave => [...wave.L.U, ...wave.M.U, ...wave.R.U]).map(([wodID]) => wodID).filter(wodID => wodID != -1))
        const game = { inventory: [...inventory(), melee(602, 5000, { meleeAttack: "140", foodSupply: undefined, meadSupply: "2" })] }
        expect([...troops((await khan({ useFood: false }, game)).cra)]).toEqual([602])
        expect([...troops((await khan({ supply: 2 }, game)).cra)]).toEqual([602])
        expect(troops((await khan({ foodTroopsOnly: true }, game)).cra).has(602)).toBe(false)
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
    const running = { waitToAttack: () => new Promise(() => {}), wait: 10 }
    const fullRage = async (stored, game = running) => {
        const run = await khan(stored, game)
        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0)
        return run.frames.filter(([command]) => command == "lta")
    }
    test("a full rage bar taunts the Khan", async () => {
        expect(await fullRage({})).toEqual([["lta", { AV: 0, EID: 72 }]])
    })
    test("shares its rage bar for the Live view: the bar, what fills it, the camp level and what the last hit earned", async () => {
        const run = await khan({}, running)
        const shared = () => require("../khanRage.js").khanRage()
        expect(shared(), "before the game reports any rage").toMatchObject({ rage: 0, eventRunning: true })

        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        const [first, second] = capture.rpr
        run.bot.xtHandler.emit("rpr", { ...first.payload, PCRP: 400 }, 0)
        expect(shared()).toMatchObject({ rage: 400, needed: 1500, campLevel: 50, lastGain: undefined, eventRunning: true, hold: undefined })
        run.bot.xtHandler.emit("rpr", { ...second.payload, PCRP: 900 }, 0)
        expect(shared(), "the total earned rose from 1,426 to 3,680").toMatchObject({ rage: 900, lastGain: 2254 })
        expect(shared().lastGainAt).toBeTypeOf("number")

        run.bot.events.emit("eventStop", { EID: 72 })
        expect(shared()).toMatchObject({ rage: 900, eventRunning: false, hold: "stopped" })
    })
    test("shares nothing before the event opens, a hold while taunts are off, and nothing once unloaded", async () => {
        const run = await khan({ tabletsOnly: true }, running)
        const { khanRage } = require("../khanRage.js")
        expect(khanRage().hold).toBe("off")
        run.bot.events.emit("unload")
        expect(khanRage()).toBeUndefined()

        loadModule("plugins/attack/attackKhan.js", { bot: fakeBot(), extra: { "protocols.js": { movementEvents: new EventEmitter(), movements: [], castles: [], AreaType: { khanCamp: 35 }, KingdomID: {}, ClientCommands: {} }, "./attack.js": {}, "../commander.js": {} } })
        expect(require("../khanRage.js").khanRage(), "the plugin is on and no Khan event has been seen").toBeUndefined()
    })
    test("the score shutoff is off by default", () => {
        expect(options.find(option => option.key == "scoreShutoff").default).toBe("")
    })
    test("once the score shutoff is reached a full rage bar sends no taunt", async () => {
        const run = await khan({ scoreShutoff: "1000" }, running)
        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        run.bot.xtHandler.emit("pep", { EID: 72, OP: ["1500"] }, 0)
        run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0)
        expect(run.frames.filter(([command]) => command == "lta")).toEqual([])
    })
    test("an ended event sends no taunt either", async () => {
        expect(await fullRage({}, { sends: 1 })).toEqual([])
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

describe("what holds a taunt", () => {
    test("the reasons come in a fixed order and nothing set means no hold", () => {
        expect(tauntHold({})).toBeUndefined()
        expect(tauntHold({ defenceShort: true })).toBe("defenceShort")
        expect(tauntHold({ defenceShort: true, defenceLost: true })).toBe("defenceLost")
        expect(tauntHold({ defenceShort: true, defenceLost: true, quit: true })).toBe("stopped")
        expect(tauntHold({ defenceShort: true, defenceLost: true, quit: true, tabletsOnly: true })).toBe("off")
        expect(tauntHold({ dryRun: true })).toBe("off")
    })
})

describe("Khan taunts and the defence", () => {
    afterEach(() => vi.restoreAllMocks())
    const running = { waitToAttack: () => new Promise(() => {}), wait: 10 }
    async function keeping(stored = { keepDefence: true }) {
        let keeper
        const refill = vi.fn()
        const run = await khan(stored, { ...running, extra: { "khanDefence.js": { keepDefence: options => (keeper = options, { refill }) } } })
        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        const rage = () => run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0)
        const taunts = () => run.frames.filter(([command]) => command == "lta")
        return { run, keeper, rage, taunts }
    }

    test("tools missing hold the taunt, say so once, and the full bar is spent as soon as the defence is whole", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const info = vi.spyOn(console, "info").mockImplementation(() => {})
        const { keeper, rage, taunts } = await keeping()
        keeper.onChecked({ missing: 12 })
        rage()
        rage()
        expect(taunts()).toEqual([])
        expect(warn.mock.calls.filter(([key]) => key == "khanTauntHeldDefenceShort")).toHaveLength(1)
        keeper.onChecked({ missing: 12 })
        expect(warn.mock.calls.filter(([key]) => key == "khanTauntHeldDefenceShort")).toHaveLength(1)
        keeper.onChecked({ missing: 0 })
        expect(taunts()).toEqual([["lta", { AV: 0, EID: 72 }]])
        expect(info).toHaveBeenCalledWith("khanTauntsResumed")
        keeper.onChecked({ missing: 0 })
        expect(taunts()).toHaveLength(1)
        expect(info.mock.calls.filter(([key]) => key == "khanTauntsResumed")).toHaveLength(1)
    })
    test("a defence that is whole never holds a taunt", async () => {
        const { keeper, rage, taunts } = await keeping()
        keeper.onChecked({ missing: 0 })
        rage()
        expect(taunts()).toHaveLength(1)
    })
    test("with the keeper off nothing holds the taunt for want of tools", async () => {
        const { keeper, rage, taunts } = await keeping({})
        rage()
        expect(keeper).toBeUndefined()
        expect(taunts()).toHaveLength(1)
    })
})

describe("the battle report of a taunt", () => {
    const report = (header, type = 6) => [324182170, type, header, "", -1, 0, 0, 0, 0]
    test("the header of the trace reads as a defence that held, and a failed defender as lost", () => {
        expect(defenceResult(report("1+2+1#0+2190967+BlackBuck"), 2190967)).toBe("held")
        expect(defenceResult(report("1+2+3#0+2190967+BlackBuck"), 2190967)).toBe("lost")
        expect(defenceResult(report("1+2+1+5+7#0+7"), 7)).toBe("held")
    })
    test("the attacker's results, another kind of attack, another owner and another message type say nothing", () => {
        expect(defenceResult(report("1+2+0#0+7+x"), 7)).toBeUndefined()
        expect(defenceResult(report("1+2+2#0+7+x"), 7)).toBeUndefined()
        expect(defenceResult(report("1+1+1#0+7+x"), 7)).toBeUndefined()
        expect(defenceResult(report("1+2+1#0+8+x"), 7)).toBeUndefined()
        expect(defenceResult(report("1+2+1#0+7+x", 7), 7)).toBeUndefined()
        expect(defenceResult(report("1+2+1"), 7)).toBeUndefined()
        expect(defenceResult([1, 6], 7)).toBeUndefined()
    })

    test("a report claims the earliest arrival near it, once, and the 1.3 s it came early is inside", () => {
        const landings = tauntLandings(() => 100_000)
        landings.expect(101_300)
        landings.expect(100_500)
        expect(landings.claim(100_000)).toBe(true)
        expect(landings.claim(100_000)).toBe(true)
        expect(landings.claim(100_000)).toBe(false)
    })
    test("an arrival too far ahead or too long past matches no report", () => {
        const landings = tauntLandings(() => 100_000)
        landings.expect(120_000)
        expect(landings.claim(100_000)).toBe(false)
        expect(landings.claim(100_000 + 120_000 + 60_000 + 1)).toBe(false)
        landings.expect(100_000)
        expect(landings.claim(100_000 + 60_000)).toBe(true)
    })
    test("an arrival is forgotten after a few minutes", () => {
        let now = 0
        const landings = tauntLandings(() => now)
        landings.expect(1000)
        now = 10 * 60_000
        landings.expect(now + 1000)
        expect(landings.claim(1000)).toBe(false)
        expect(landings.claim(now)).toBe(true)
    })
})

describe("Khan taunts and the battle report", () => {
    afterEach(() => vi.restoreAllMocks())
    const running = { waitToAttack: () => new Promise(() => {}), wait: 10 }
    const march = id => ({ id, owner: { ownerID: -801 }, targetOwner: { ownerID: 7 }, sourceAttack: { type: 35 }, totalTime: 2000, deltaTime: Date.now() })
    async function game() {
        const run = await khan({}, running)
        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        const sne = header => run.bot.xtHandler.emit("sne", { MSG: [[1, 6, header, "", -1, 0, 0, 0, 0]] }, 0)
        const rage = () => run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0)
        const taunts = () => run.frames.filter(([command]) => command == "lta")
        return { run, sne, rage, taunts }
    }
    const logged = (spy, key) => spy.mock.calls.filter(([first]) => first == key)

    test("a lost defence stops the next full bar from taunting, and the warning says why", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { run, sne, rage, taunts } = await game()
        run.movementEvents.emit("outgoing", march(1))
        sne("1+2+3#0+7+BlackBuck")
        rage()
        expect(taunts()).toEqual([])
        expect(logged(warn, "khanDefenceLost")).toHaveLength(1)
        expect(logged(warn, "khanTauntHeldDefenceLost")).toHaveLength(1)
    })
    test("a reconnect, which starts the event again, keeps taunts held", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { run, sne, rage, taunts } = await game()
        run.movementEvents.emit("outgoing", march(1))
        sne("1+2+3#0+7+BlackBuck")
        rage()
        run.bot.events.emit("eventStart", { EID: 72, EDID: 3 })
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(taunts()).toEqual([])
    })
    test("the event ending and starting again lets taunts go on", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.spyOn(console, "log").mockImplementation(() => {})
        const info = vi.spyOn(console, "info").mockImplementation(() => {})
        const { run, sne, rage, taunts } = await game()
        run.movementEvents.emit("outgoing", march(1))
        sne("1+2+3#0+7+BlackBuck")
        rage()
        run.bot.events.emit("eventStop", { EID: 72 })
        run.bot.events.emit("eventStart", { EID: 72, EDID: 3 })
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(taunts()).toHaveLength(1)
        expect(logged(info, "khanTauntsResumed")).toHaveLength(1)
    })
    test("a defence that held is logged and the bar is spent", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {})
        const { run, sne, rage, taunts } = await game()
        run.movementEvents.emit("outgoing", march(1))
        run.movementEvents.emit("outgoing", march(1))
        sne("1+2+1#0+7+BlackBuck")
        sne("1+2+3#0+7+BlackBuck")
        rage()
        expect(logged(info, "khanDefenceHeld")).toHaveLength(1)
        expect(taunts()).toHaveLength(1)
    })
    test("a defence that held logs what the taunt paid, once its reward pushes are in", async () => {
        const capture = require("./fixtures/protocol/khan-rewards-20261122.json")
        const info = vi.spyOn(console, "info").mockImplementation(() => {})
        const { run, sne } = await game()
        const push = pushes => pushes.forEach(([command, reply]) => command != "sne" && run.bot.xtHandler.emit(command, reply, 0))
        push(capture.landings.first)
        vi.useFakeTimers()
        try {
            run.movementEvents.emit("outgoing", march(1))
            sne("1+2+1#0+7+BlackBuck")
            push(capture.landings.second)
            expect(logged(info, "khanTauntRewards")).toEqual([])
            vi.advanceTimersByTime(3000)
        } finally {
            vi.useRealTimers()
        }
        expect(logged(info, "khanTauntRewards")).toEqual([["khanTauntRewards", "construction item 30482 +1, construction item 30472 +1, mystery box 8 +1"]])
    })
    test("a report with no recent taunt changes nothing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { sne, rage, taunts } = await game()
        sne("1+2+3#0+7+BlackBuck")
        rage()
        expect(logged(warn, "khanDefenceLost")).toHaveLength(0)
        expect(taunts()).toHaveLength(1)
    })
})

describe("the castle Khan attacks leave from", () => {
    afterEach(() => vi.restoreAllMocks())
    const outpost = () => ({ id: 55, kingdomID: 0, areaInfo: { type: 4, x: 200, y: 210, extraData: Object.assign([], { 7: "Watch" }) }, unlockedHorses: [1, 2], unitInventory: inventory() })

    test("a picked outpost sends the hits, and the defence kept is still the main castle's, where the Khan's attacks land", async () => {
        const { cra, frames } = await khan({ sourceCastle: { kingdom: 0, id: 55 }, keepDefence: true }, { castles: [outpost()] })
        expect([cra.SX, cra.SY]).toEqual([200, 210])
        expect(frames.filter(([command]) => command == "dfc")).toEqual([["dfc", { CX: 100, CY: 100, AID: 1, KID: -1 }]])
    })

    test("a picked castle the account no longer holds falls back to the main castle, logs it and says so", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { cra, statuses } = await khan({ sourceCastle: { kingdom: 0, id: 55 } })
        expect([cra.SX, cra.SY]).toEqual([100, 100])
        expect(warn).toHaveBeenCalledWith("campSourceCastleGone", "100:100")
        expect(statuses).toContainEqual(expect.objectContaining({ state: "running", reasonKey: "statusCampCastleFallback", params: { castle: "100:100" } }))
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

const defender = (wodID, amount) => unit(wodID, amount, { role: "melee", fightType: "1" })
/** The defenders of a real main castle: two Protector of the north levels and the Renegade spear thrower, 8,405 in all, with a defence tool beside them. */
const defenders = () => [defender(220, 959), defender(729, 30), defender(222, 7416), unit(110, 976, { fightType: undefined, typ: "Defence" })]

describe("the defender gate on taunts", () => {
    const slots = (...amounts) => amounts.map(amount => amount > 0 ? [110, amount] : [-1, 0])
    const layout = ({ L = slots(10, 10), M = slots(10, 10), R = slots(10, 10) } = {}) =>
        ({ dfw: { L: { S: L }, M: { S: M }, R: { S: R }, U: 5031 }, dfk: { U: 433000 } })

    test("a fixed order puts a short troop count before short tools, and both after a short defence", () => {
        expect(tauntHold({ gate: "toolsShort", defenceShort: true })).toBe("defenceShort")
        expect(tauntHold({ gate: "toolsShort" })).toBe("toolsShort")
        expect(tauntHold({ gate: "defendersShort" })).toBe("defendersShort")
        expect(tauntHold({ gate: "defenceUnread" })).toBe("defenceUnread")
    })
    test("0 turns the gate off and the option defaults to it", () => {
        expect(defenceGate(layout(), 0, 0)).toBeUndefined()
        expect(defenceGate(layout({ L: slots(1, 1) }), 0, 0)).toBeUndefined()
        expect(options.find(option => option.key == "tauntMinDefenders")).toMatchObject({ type: "Number", default: 0, min: 0, unit: "troops" })
        expect(parseKhan({}).tauntMinDefenders).toBe(0)
        expect(parseKhan({ tauntMinDefenders: "2500" }).tauntMinDefenders).toBe(2500)
        expect(parseKhan({ tauntMinDefenders: -4 }).tauntMinDefenders).toBe(0)
    })
    test("only defensive soldiers count: attack troops and defence tools do not", () => {
        expect(defendersIn(defenders())).toBe(8405)
        expect(defendersIn([...defenders(), ...inventory()])).toBe(8405)
        expect(defendersIn(undefined)).toBe(0)
    })
    test("too few defenders hold the taunt, whatever room the wall and courtyard have", () => {
        expect(defenceGate(layout(), 8405, 8405)).toBeUndefined()
        expect(defenceGate(layout(), 8405, 8406)).toEqual({ hold: "defendersShort", have: 8405, need: 8406 })
        expect(defenceGate(layout(), 0, 1000)).toMatchObject({ hold: "defendersShort", have: 0 })
    })
    test("a defended side needs 10 tools in every slot, an empty slot counts, and an undefended side is not looked at", () => {
        expect(defenceGate(layout({ L: slots(10, 9) }), 10, 1)).toEqual({ hold: "toolsShort", short: 1, need: 10 })
        expect(defenceGate(layout({ L: slots(10, 0), R: slots(9, 9) }), 10, 1)).toEqual({ hold: "toolsShort", short: 3, need: 10 })
        expect(defenceGate(layout({ L: slots(0, 0) }), 10, 1)).toBeUndefined()
        expect(defenceGate(layout({ L: slots(0, 0), M: slots(0, 0), R: slots(0, 0) }), 10, 1)).toBeUndefined()
    })
    test("the captured defence of a real account is read", () => {
        const dfc = capture.dfc_1.reply.payload
        expect(defenceGate(dfc, 8405, 1000)).toBeUndefined()
        expect(defenceGate(dfc, 8405, 10_000)).toMatchObject({ hold: "defendersShort", have: 8405, need: 10_000 })
    })
})

describe("Khan taunts and the defender gate", () => {
    afterEach(() => vi.restoreAllMocks())
    const running = { waitToAttack: () => new Promise(() => {}), wait: 10 }
    const slot = amount => ({ S: [[110, amount], [110, amount]] })
    const dfc = ({ amount = 10 } = {}) => ({ dfw: { L: slot(amount), M: slot(amount), R: slot(amount), U: 5031 }, dfk: { U: 433000 } })
    async function gated(replies, stored = { tauntMinDefenders: 8000 }, troops = defenders()) {
        const asked = []
        const ask = async (command, params) => {
            asked.push([command, params])
            const reply = replies.shift()
            return reply === undefined ? {} : { reply, result: 0 }
        }
        const run = await khan(stored, { ...running, inventory: [...inventory(), ...troops], extra: { "chores.js": { ask } } })
        run.movementEvents.emit("outgoing", { owner: { ownerID: 7 }, targetAttack: { type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] } })
        const rage = async () => { run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0); await new Promise(resolve => setTimeout(resolve, 5)) }
        const taunts = () => run.frames.filter(([command]) => command == "lta")
        return { run, rage, taunts, asked }
    }

    test("a castle with enough troops and tools taunts after one look at the defence", async () => {
        const { rage, taunts, asked } = await gated([dfc()])
        await rage()
        expect(taunts()).toEqual([["lta", { AV: 0, EID: 72 }]])
        expect(asked).toHaveLength(1)
        expect(asked[0][0]).toBe("dfc")
    })
    test("with the gate off the defence is never looked at", async () => {
        const { rage, taunts, asked } = await gated([], {})
        await rage()
        expect(taunts()).toHaveLength(1)
        expect(asked).toEqual([])
    })
    test("too few troops hold the taunt, say so once, and report the status", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { run, rage, taunts } = await gated([dfc()], { tauntMinDefenders: 9000 })
        await rage()
        await rage()
        expect(taunts()).toEqual([])
        expect(warn.mock.calls.filter(([key]) => key == "khanTauntHeldDefendersShort")).toEqual([["khanTauntHeldDefendersShort", 8405, 9000]])
    })
    test("a slot with fewer than 10 tools holds the taunt", async () => {
        const { rage, taunts } = await gated([dfc({ amount: 9 })])
        await rage()
        expect(taunts()).toEqual([])
    })
    test("a defence that cannot be read holds the taunt", async () => {
        const { rage, taunts } = await gated([])
        await rage()
        expect(taunts()).toEqual([])
    })
    test("the check runs again after 5 minutes and a filled defence then spends the full bar", async () => {
        const { run, taunts, asked } = await gated([dfc(), dfc()], { tauntMinDefenders: 8000 }, [defender(220, 10)])
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
        try {
            run.bot.xtHandler.emit("rpr", { EID: 72, PCRP: 1500 }, 0)
            await vi.advanceTimersByTimeAsync(1)
            expect(taunts()).toEqual([])
            expect(asked).toHaveLength(1)
            run.castle.unitInventory.push(defender(222, 9000))
            await vi.advanceTimersByTimeAsync(5 * 60_000 - 10)
            expect(asked).toHaveLength(1)
            await vi.advanceTimersByTimeAsync(20)
            expect(asked).toHaveLength(2)
            expect(taunts()).toEqual([["lta", { AV: 0, EID: 72 }]])
        } finally {
            vi.useRealTimers()
        }
    })
    test("the held taunt shows in the plugin status with the counts", async () => {
        const { run, rage } = await gated([dfc()], { tauntMinDefenders: 9000 })
        await rage()
        expect(run.statuses.at(-1)).toMatchObject({ reasonKey: "statusKhanTauntDefendersShort", params: { have: 8405, need: 9000 } })
    })
})
