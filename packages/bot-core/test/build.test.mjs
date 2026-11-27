import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus, PluginFinished } = require("../actions.json")
const en = require("../locales/en.json")

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE

afterEach(() => vi.useRealTimers())

// Hand-made rows in the shape of the game's buildings.json and expansions.json, not copied from it.
const shop = (wodID, name, level, rest = {}) => ({ wodID, name, level: String(level), group: "Building", type: "Level1", shopCategory: "CIVIL", width: "5", height: "5", buildDuration: "600", ...rest })
const buildings = [
    { wodID: 200, name: "Castle", width: "20", height: "20" },
    { wodID: 201, name: "Castle", width: "10", height: "20" },
    shop(110, "Farm", 1, { upgradeWodID: "111", costWood: "30" }),
    shop(111, "Farm", 2, { upgradeWodID: "112", downgradeWodID: "110", costWood: "100", costStone: "40", buildDuration: "1200" }),
    shop(112, "Farm", 3, { upgradeWodID: "113", downgradeWodID: "111", costWood: "500", costStone: "90" }),
    shop(113, "Farm", 4, { downgradeWodID: "112", costC2: "500" }),
    shop(300, "Dwelling", 1, { costWood: "20", costStone: "10" }),
    shop(310, "Barracks", 1, { shopCategory: "MILITARY", upgradeWodID: "311", costWood: "50", maximumCount: "1" }),
    shop(311, "Barracks", 2, { shopCategory: "MILITARY", downgradeWodID: "310", costC1: "2000", costWood: "60", maximumCount: "1" }),
    shop(320, "Bakery", 1, { costC2: "900" }),
    { wodID: 171, name: "Keep", level: "1", group: "Building", upgradeWodID: "172", width: "6", height: "6" },
    { wodID: 172, name: "Keep", level: "2", group: "Building", downgradeWodID: "171", costWood: "400", costStone: "300" },
    { wodID: 501, name: "Castlewall", level: "1", group: "Defence", upgradeWodID: "502", costWood: "46" },
    { wodID: 502, name: "Castlewall", level: "2", group: "Defence", downgradeWodID: "501", costWood: "90", costStone: "60" },
    { wodID: 627, name: "FactionBarracks", level: "1", group: "Building", upgradeWodID: "628", eventIDs: "3", kIDs: "10" },
    { wodID: 628, name: "FactionBarracks", level: "2", group: "Building", downgradeWodID: "627", eventIDs: "3", kIDs: "10", costWood: "2800" },
    { wodID: 950, name: "TreasureChest", group: "Building", width: "2", height: "2" },
]
const expansions = [
    { expansionLevel: "1", spaceIDs: "0,1,2,3", costWood: "100", costStone: "80", costC2: "50" },
    { expansionLevel: "2", spaceIDs: "0,1,2,3", costWood: "900000", costStone: "900000" },
]
const rowOf = wod => buildings.find(b => b.wodID == wod)
const items = { buildings, expansions }

let nextObject = 1
/** A `gca` building row: [wodID, objectID, x, y, rotation, secondsDone, state, hp, boost×100, efficiency, damage]. */
const bd = (wodID, x = 0, y = 0, { state = 0, secondsDone = 0 } = {}) => [wodID, nextObject++, x, y, 0, secondsDone, state, 100, 100, 100, 0]
const castle = (id, { kingdom = 0, type = 1, BD = [], D = [], slots = [-1, -1], wood = 10_000, stone = 10_000, grounds = [[200, 900, 0, 0, 0]] } = {}) =>
    ({ id, kingdom, type, BD, D, BG: grounds, slots: [...slots], wood, stone })
const part = (rows, { id = 100, kingdom = 0, ...rest } = {}) => ({ castle: { kingdom, id }, useSkips: false, buyExpansions: false, rows, ...rest })
const row = (building, level = 1, count = 1) => ({ building, level, count })

/**
 * The plugin against a game that answers jca, ebu, eup, eud, ebe, etc and msb from `world`. `refuse(cmd, params, n)`
 * gives the n-th request's refusal code, 0 to accept. An accepted build or upgrade takes a queue slot and the row's
 * wood, stone and coins. A skip takes its minutes off the building.
 */
function run({ plan = [], options = {}, world = [castle(100)], coins = 1_000_000, level = 70, refuse = () => 0, skips = {}, skipOptions = {}, listen } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerLevel = level
    bot.playerInfo.legendLevel = 0
    const saved = { state: true, plan, coinFloor: 0, resourceFloor: 0, dryRunBuilds: false, skipTypes: null, ...options }
    bot.botConfig.plugins.build = saved
    bot.botConfig.plugins.skips = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true, ...skipOptions }
    const before = JSON.stringify(saved.plan)
    const logs = [], warns = [], errors = [], reports = [], finished = []
    const state = { coins, requests: 0 }
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    let current
    const minutes = { MS1: 1, MS2: 5, MS3: 10, MS4: 30, MS5: 60, MS6: 300, MS7: 1440 }
    const found = oid => current.BD.find(b => b[1] == oid) ?? current.D.find(b => b[1] == oid)
    const pay = wod => {
        const cost = rowOf(wod)
        current.wood -= Number(cost.costWood) || 0
        current.stone -= Number(cost.costStone) || 0
        state.coins -= Number(cost.costC1) || 0
        bot.xtHandler.emit("gcu", { C1: state.coins, C2: 0 }, 0)
    }
    const finish = b => {
        if (b[6] == 13)
            b[0] = Number(rowOf(b[0]).upgradeWodID)
        b[5] = 0
        b[6] = 0
        current.slots[current.slots.indexOf(b[1])] = -1
    }
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        // The bot core's own slow reads of the castle list and the defence (castleListRead.js, defenceRead.js), which no plugin sends.
        if (cmd == "dcl" || cmd == "dfc")
            return
        bot.sent.push([cmd, p])
        if (cmd == "jca") {
            current = world.find(c => c.kingdom == p.KID && c.id == p.CID)
            return reply("jaa", {
                KID: current.kingdom, grc: { KID: current.kingdom, AID: current.id, W: current.wood, S: current.stone },
                gca: { BD: current.BD.map(b => [...b]), BG: current.BG, D: current.D.map(b => [...b]), scl: { OIDL: [...current.slots] } }, gpa: { MRW: 50_000, MRS: 50_000 },
            })
        }
        const code = refuse(cmd, p, state.requests++)
        if (code)
            return reply(cmd, {}, code)
        if (cmd == "ebu") {
            const built = [p.WID, nextObject++, p.X, p.Y, p.R, 0, 2, 100, 100, 100, 0]
            current.BD.push(built)
            current.slots[current.slots.indexOf(-1)] = built[1]
            pay(p.WID)
        }
        if (cmd == "eup" || cmd == "eud") {
            const b = found(p.OID)
            b[6] = 13
            current.slots[current.slots.indexOf(-1)] = b[1]
            pay(Number(rowOf(b[0]).upgradeWodID))
        }
        if (cmd == "ebe") {
            current.BG = [...current.BG, [201, nextObject++, p.X, p.Y, p.R]]
            current.wood -= 100
            current.stone -= 80
        }
        if (cmd == "etc")
            current.BD = current.BD.filter(b => b[1] != p.OID)
        if (cmd == "msb") {
            const b = found(p.OID)
            b[5] += minutes[p.MST] * 60
            const duration = Number(rowOf(b[6] == 13 ? Number(rowOf(b[0]).upgradeWodID) : b[0]).buildDuration) || 0
            if (b[5] >= duration)
                finish(b)
        }
        reply(cmd, {})
    }
    const parentPort = {
        postMessage: message => {
            if (message[0] == PluginStatus) reports.push(message[1])
            if (message[0] == PluginFinished) finished.push(message[1])
        }, on() {},
    }
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args) })
    vi.spyOn(console, "warn").mockImplementation((...args) => { warns.push(args) })
    vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args) })
    vi.spyOn(console, "debug").mockImplementation(() => {})
    loadModule("plugins/build.js", { bot, parentPort, items })
    const protocols = require("../protocols.js")
    for (const c of world)
        protocols.castles.push({ id: c.id, kingdomID: c.kingdom, areaInfo: { type: c.type, x: c.id, y: c.id, extraData: [] } })
    Object.assign(protocols.resources, { "1MinSkip": 0, "5MinSkip": 0, "10MinSkip": 0, "30MinSkip": 0, "60MinSkip": 0, "5HourSkip": 0, "24HourSkip": 0, ...skips })
    bot.xtHandler.emit("gcu", { C1: coins, C2: 0 }, 0)
    const looked = []
    bot.events.on("buildLooked", look => { looked.push(look); listen?.(look) })
    bot.events.emit("load")
    const sent = cmd => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
    const writes = () => bot.sent.filter(([c]) => c != "jca").map(([c]) => c)
    const logged = key => logs.filter(args => args[0] == key)
    const warned = key => warns.filter(args => args[0] == key)
    return { bot, sent, writes, status: () => reports.at(-1), reports, finished, logs, logged, warns, warned, errors, world, state, looked, protocols, unchanged: () => JSON.stringify(saved.plan) == before }
}

/** The first look comes within a few minutes of the load, and each step a few seconds after the one before. */
const settle = () => vi.advanceTimersByTimeAsync(10 * MINUTE)

describe("the catalog entry", () => {
    const load = () => loadModule("plugins/build.js", { mainThread: true, items }).mod

    test("is accepted by the API and offers the plan, the skips it may spend, both floors and a dry run", () => {
        const mod = load()
        const entry = { key: "build", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["plan", "skipTypes", "coinFloor", "resourceFloor", "dryRunBuilds"])
        expect(mod.pluginOptions.find(o => o.key == "dryRunBuilds").default).toBe(false)
        expect(mod.eventOnly).toBeUndefined()
    })

    test("the plan offers buildings without a ruby price", () => {
        const offered = load().pluginOptions[0].buildings.map(b => b.name)
        expect(offered).toEqual(expect.arrayContaining(["Farm", "Dwelling", "Barracks", "Keep", "Castlewall", "FactionBarracks"]))
        expect(offered).not.toContain("Bakery")
    })

    test("every key it shows or logs is in en.json", () => {
        const keys = ["build", "build.description", "plan", "build.plan.help", "resourceFloor", "build.resourceFloor.help", "build.coinFloor.help", "dryRunBuilds", "build.dryRunBuilds.help", "build.skipTypes.help"]
        for (const log of ["DryRun", "NotSent", "NoPlan", "RowDropped", "CastleNotFound", "ChestCollected", "Skipped", "ExpansionBought", "ExpansionRefused",
            "ExpansionBlocked", "Started", "UpgradeStarted", "Refused", "Blocked", "NoRoom", "WaitingForResources", "PlanDone", "AllDone", "ToLevel", "In", "Of", "Has", "Because",
            "ReasonNotPossible", "ReasonNeedsLevel", "ReasonNeedsLegendLevel", "ReasonNotInKingdom", "ReasonNotInCastleType", "ReasonUpgradeOnlyMissing", "ReasonAtLimit", "ReasonOverStorage", "ReasonNoSpace"])
            keys.push(`build${log}`)
        for (const status of ["Starting", "NoPlan", "Working", "WaitingResources", "WaitingQueue", "Blocked", "AllDone", "DryRun"])
            keys.push(`statusBuild${status}`)
        expect(keys.filter(key => typeof en[key] != "string")).toEqual([])
    })
})

describe("a look at a castle", () => {
    test("reads the castle first, then upgrades the best building a level without rubies", async () => {
        const farm = bd(110)
        const { bot, sent, status } = run({ plan: [part([row("Farm", 2)])], world: [castle(100, { BD: [farm], slots: [-1] })] })
        await settle()
        expect(bot.sent.map(([cmd]) => cmd).slice(0, 2)).toEqual(["jca", "eup"])
        expect(sent("jca")[0]).toEqual({ CID: 100, KID: 0 })
        expect(sent("eup")).toEqual([{ OID: farm[1], PWR: 0, PO: -1 }])
        expect(status()).toMatchObject({ plugin: "build", state: "waiting", reasonKey: "statusBuildWaitingQueue", params: { done: 0, total: 1 } })
    })

    test("builds a new one on the first free spot, reading the castle again before each step", async () => {
        const { bot, sent, logged } = run({ plan: [part([row("Dwelling", 1, 2)])] })
        await settle()
        expect(sent("ebu")).toEqual([
            { WID: 300, X: 0, Y: 0, R: 0, PWR: 0, PO: -1, DOID: -1 },
            { WID: 300, X: 5, Y: 0, R: 0, PWR: 0, PO: -1, DOID: -1 },
        ])
        expect(bot.sent.map(([cmd]) => cmd).slice(0, 4)).toEqual(["jca", "ebu", "jca", "ebu"])
        expect(logged("buildStarted")).toHaveLength(2)
    })

    test("upgrades the castle wall with its own request", async () => {
        const wall = bd(501)
        const { sent, writes } = run({ plan: [part([row("Castlewall", 2)])], world: [castle(100, { D: [wall] })] })
        await settle()
        expect(sent("eud")).toEqual([{ OID: wall[1], PWR: 0, PO: -1 }])
        expect(writes()).toEqual(["eud"])
    })

    test("collects an expansion's chest before anything else, and leaves a chest the game refused", async () => {
        const chest = bd(950, 10, 10)
        const first = run({ plan: [part([row("Farm")])], world: [castle(100, { BD: [chest] })] })
        await settle()
        expect(first.writes().slice(0, 2)).toEqual(["etc", "ebu"])
        expect(first.sent("etc")).toEqual([{ OID: chest[1] }])

        const kept = bd(950, 10, 10)
        const second = run({ plan: [part([row("Farm")])], world: [castle(100, { BD: [kept] })], refuse: cmd => cmd == "etc" ? 5 : 0 })
        await settle()
        await vi.advanceTimersByTimeAsync(3 * HOUR)
        expect(second.writes()).toEqual(["etc", "ebu"])
    })

    test("buys an expansion with wood and stone where the player ticked that, and only there", async () => {
        const ticked = run({ plan: [part([], { buyExpansions: true })] })
        await settle()
        expect(ticked.sent("ebe")).toHaveLength(1)
        expect(ticked.sent("ebe")[0]).toMatchObject({ CT: 1 })
        expect(ticked.logged("buildExpansionBought")).toHaveLength(1)

        const plain = run({ plan: [part([row("Farm")])] })
        await settle()
        expect(plain.sent("ebe")).toEqual([])
    })

    test("a full queue is left alone until its first building ends, then a few seconds more", async () => {
        // An upgrade to Farm level 2 takes 20 minutes.
        const underWay = bd(110, 0, 0, { state: 13, secondsDone: 0 })
        const world = [castle(100, { BD: [underWay], slots: [underWay[1]] })]
        const { writes, bot, status } = run({ plan: [part([row("Dwelling")])], world })
        await settle()
        expect(bot.sent.map(([cmd]) => cmd)).toEqual(["jca"])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuildWaitingQueue" })
        world[0].BD[0][0] = 111
        world[0].BD[0][6] = 0
        world[0].slots = [-1]
        await vi.advanceTimersByTimeAsync(9 * MINUTE)
        expect(bot.sent.map(([cmd]) => cmd)).toEqual(["jca"])
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(writes()).toEqual(["ebu"])
    })

    test("a castle ref for the kingdom's main castle finds it", async () => {
        const { sent } = run({ plan: [part([row("Farm")], { id: -1 })], world: [castle(55, { type: 4 }), castle(77, { type: 1 })] })
        await settle()
        expect(sent("jca")[0]).toEqual({ CID: 77, KID: 0 })
    })
})

describe("skips", () => {
    const underWay = () => bd(110, 0, 0, { state: 2, secondsDone: 0 })

    test("finish a build under way where the player ticked skips, then the plan goes on", async () => {
        const b = underWay()
        const { sent, writes, logged } = run({ plan: [part([row("Farm", 1, 2)], { useSkips: true })], world: [castle(100, { BD: [b], slots: [b[1]] })], skips: { "10MinSkip": 3 } })
        await settle()
        expect(sent("msb")[0]).toEqual({ OID: b[1], MST: "MS3" })
        expect(writes()).toEqual(["msb", "ebu", "msb"])
        expect(logged("buildSkipped")).toHaveLength(2)
    })

    test("are not spent where the player didn't tick them", async () => {
        const b = underWay()
        const { sent } = run({ plan: [part([row("Farm", 1, 2)])], world: [castle(100, { BD: [b], slots: [b[1], -1] })], skips: { "10MinSkip": 3 } })
        await settle()
        expect(sent("msb")).toEqual([])
    })

    test("a type the game has none left of gives way to another", async () => {
        const b = underWay()
        const { sent } = run({
            plan: [part([row("Farm", 1, 2)], { useSkips: true })], world: [castle(100, { BD: [b], slots: [b[1]] })],
            skips: { "10MinSkip": 1, "30MinSkip": 1 }, refuse: (cmd, p) => cmd == "msb" && p.MST == "MS3" ? 335 : 0,
        })
        await settle()
        expect(sent("msb").map(p => p.MST)).toEqual(["MS3", "MS4"])
    })

    test("out of skips, the plan goes on without them and says so once", async () => {
        const b = underWay()
        const { sent, writes, warned } = run({ plan: [part([row("Farm", 1, 2)], { useSkips: true })], world: [castle(100, { BD: [b], slots: [b[1], -1] })] })
        await settle()
        expect(sent("msb")).toEqual([])
        expect(writes()).toEqual(["ebu"])
        expect(warned("noMoreSkips")).toHaveLength(1)
    })

    test("only the types the plugin's own skip setting allows are spent", async () => {
        const b = underWay()
        const { sent } = run({
            plan: [part([row("Farm", 1, 2)], { useSkips: true })], world: [castle(100, { BD: [b], slots: [b[1]] })],
            skips: { "10MinSkip": 3, "5MinSkip": 9 }, options: { skipTypes: [5] },
        })
        await settle()
        expect(sent("msb").map(p => p.MST)).toEqual(["MS2", "MS2", "MS2", "MS2"])
    })
})

describe("what the bot holds back", () => {
    test("a row the game refused is left alone for an hour, and the other rows go on", async () => {
        const { writes, warned, status } = run({ plan: [part([row("Farm"), row("Dwelling")])], refuse: (cmd, p) => cmd == "ebu" && p.WID == 110 ? 55 : 0 })
        await settle()
        expect(writes()).toEqual(["ebu", "ebu"])
        expect(warned("buildRefused")).toHaveLength(1)
        expect(warned("buildRefused")[0]).toEqual(expect.arrayContaining(["Farm", "NOT_ENOUGH_RESOURCES"]))
        expect(status()).toMatchObject({ state: "waiting" })
        await vi.advanceTimersByTimeAsync(50 * MINUTE)
        expect(writes()).toEqual(["ebu", "ebu"])
        await vi.advanceTimersByTimeAsync(30 * MINUTE)
        expect(writes()).toEqual(["ebu", "ebu", "ebu"])
    })

    test("a refused expansion is left for an hour and the buildings go on", async () => {
        const { writes, warned } = run({ plan: [part([row("Farm")], { buyExpansions: true })], refuse: cmd => cmd == "ebe" ? 99 : 0 })
        await settle()
        expect(writes()).toEqual(["ebe", "ebu"])
        expect(warned("buildExpansionRefused")).toHaveLength(1)
    })

    test("the resource floor is kept in the castle", async () => {
        const { writes, status, logged } = run({ plan: [part([row("Farm")])], world: [castle(100, { wood: 1029 })], options: { resourceFloor: 1000 } })
        await settle()
        expect(writes()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuildWaitingResources", params: { done: 0, total: 1 } })
        expect(logged("buildWaitingForResources")).toHaveLength(1)
    })

    test("the coin floor is kept", async () => {
        const barracks = bd(310)
        const { writes } = run({ plan: [part([row("Barracks", 2)])], world: [castle(100, { BD: [barracks] })], coins: 101_999, options: { coinFloor: 100_000 } })
        await settle()
        expect(writes()).toEqual([])
    })

    test("a castle waiting for resources is looked at once an hour, not more", async () => {
        const { bot } = run({ plan: [part([row("Farm")])], world: [castle(100, { wood: 0 })] })
        await settle()
        expect(bot.sent.map(([cmd]) => cmd)).toEqual(["jca"])
        await vi.advanceTimersByTimeAsync(45 * MINUTE)
        expect(bot.sent.map(([cmd]) => cmd)).toEqual(["jca"])
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(bot.sent.map(([cmd]) => cmd)).toEqual(["jca", "jca"])
    })

    test("a row the game would refuse is never sent and is said once", async () => {
        const farm = bd(112)
        const { writes, warned, status } = run({ plan: [part([row("Farm", 4)])], world: [castle(100, { BD: [farm] })] })
        await settle()
        await vi.advanceTimersByTimeAsync(3 * HOUR)
        expect(writes()).toEqual([])
        expect(warned("buildBlocked")).toHaveLength(1)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuildBlocked" })
    })

    test("a dry run reads the castle and logs the step instead of sending it", async () => {
        const { bot, logged, status, state } = run({ plan: [part([row("Farm")], { buyExpansions: true, useSkips: true })], options: { dryRunBuilds: true }, skips: { "10MinSkip": 3 } })
        await settle()
        expect([...new Set(bot.sent.map(([cmd]) => cmd))]).toEqual(["jca"])
        expect(logged("buildDryRun")).toHaveLength(1)
        expect(logged("buildDryRun")[0].join("")).toContain("ebe")
        expect(logged("buildExpansionBought")).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuildDryRun" })
        expect(state.coins).toBe(1_000_000)
    })
})

describe("rubies never leave", () => {
    test("across builds, upgrades, the wall, an expansion, a chest and skips, every request is on the allow list with a ruby-free payload", async () => {
        const plan = require("../buildPlan.js")
        const farm = bd(110, 0, 0), wall = bd(501), chest = bd(950, 15, 15), busy = bd(300, 5, 0, { state: 2 })
        const { bot, errors } = run({
            plan: [part([row("Farm", 3, 2), row("Castlewall", 2), row("Dwelling", 1, 3), row("Barracks", 2), row("Keep", 2), row("Bakery")], { buyExpansions: true, useSkips: true })],
            world: [castle(100, { BD: [farm, chest, busy], D: [wall], slots: [busy[1], -1, -1] })], skips: { "10MinSkip": 20, "5MinSkip": 20 },
        })
        await vi.advanceTimersByTimeAsync(6 * HOUR)

        const commands = new Set(bot.sent.map(([cmd]) => cmd))
        expect([...commands].sort()).toEqual(["ebe", "ebu", "etc", "eud", "eup", "jca", "msb"])
        for (const [cmd, payload] of bot.sent)
            expect([cmd, payload, plan.mayLeave(cmd, payload)]).toEqual([cmd, payload, true])
        expect(bot.sent.filter(([cmd]) => ["ebu", "eup", "eud"].includes(cmd)).every(([, p]) => p.PWR === 0)).toBe(true)
        expect(bot.sent.filter(([cmd]) => cmd == "ebe").every(([, p]) => p.CT === 1)).toBe(true)
        expect(bot.sent.filter(([cmd]) => cmd == "ebu").map(([, p]) => p.WID)).not.toContain(320)
        expect(errors).toEqual([])
    })

    test("a request off the allow list is stopped before it leaves and says so", () => {
        const { bot, errors } = run({ plan: [] })
        const { send } = require("../plugins/build.js")
        return Promise.all([send("ebu", { WID: 110, X: 0, Y: 0, R: 0, PWR: 1, PO: -1, DOID: -1 }), send("ebe", { X: 0, Y: 0, R: 0, CT: 0 }), send("sbp", {})]).then(answers => {
            expect(answers.map(a => a.result)).toEqual(["NOT_SENT", "NOT_SENT", "NOT_SENT"])
            expect(bot.sent).toEqual([])
            expect(errors.map(args => args[0])).toEqual(["buildNotSent", "buildNotSent", "buildNotSent"])
        })
    })
})

describe("a finished plan", () => {
    test("a done castle is said once, counted in the status and never looked at again, and the saved plan is untouched", async () => {
        const farm = bd(111)
        const { bot, logged, status, unchanged, finished } = run({ plan: [part([row("Farm", 2)])], world: [castle(100, { BD: [farm] })] })
        await settle()
        expect(logged("buildPlanDone")).toHaveLength(1)
        expect(logged("buildAllDone")).toHaveLength(1)
        expect(status()).toMatchObject({ state: "stopped", reasonKey: "statusBuildAllDone", params: { done: 1, total: 1 } })
        await vi.advanceTimersByTimeAsync(6 * HOUR)
        expect(bot.sent.map(([cmd]) => cmd)).toEqual(["jca"])
        expect(unchanged()).toBe(true)
        expect(finished).toEqual([])
    })

    test("a plan the player saves again is worked from the start, soon after the save", async () => {
        const farm = bd(111)
        const { bot, writes } = run({ plan: [part([row("Farm", 2)])], world: [castle(100, { BD: [farm] })] })
        await settle()
        bot.botConfig.plugins.build.plan = [part([row("Farm", 2), row("Dwelling")])]
        bot.events.emit("configModified")
        await vi.advanceTimersByTimeAsync(MINUTE)
        expect(writes()).toEqual(["ebu"])
    })

    test("the other castles go on after one is done", async () => {
        const farm = bd(111)
        const { sent, status } = run({
            plan: [part([row("Farm", 2)]), part([row("Dwelling")], { id: 200 })],
            world: [castle(100, { BD: [farm] }), castle(200, { wood: 0 })],
        })
        await settle()
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuildWaitingResources", params: { done: 1, total: 2 } })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(sent("jca").filter(p => p.CID == 100)).toHaveLength(1)
        expect(sent("jca").filter(p => p.CID == 200).length).toBeGreaterThan(1)
    })

    test("no plan says so and sends nothing", async () => {
        const { bot, status, warned } = run({ plan: [] })
        await settle()
        expect(bot.sent).toEqual([])
        expect(warned("buildNoPlan")).toHaveLength(1)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuildNoPlan" })
    })

    test("a saved row the bot can't build is named once and the rest of the plan runs", async () => {
        const { writes, warned } = run({ plan: [part([row("Bakery"), row("Farm")])] })
        await settle()
        expect(warned("buildRowDropped")).toEqual([["buildRowDropped", "Bakery"]])
        expect(writes()).toEqual(["ebu"])
    })

    test("a castle the account no longer has is said once and the others go on", async () => {
        const { sent, warned, status } = run({ plan: [part([row("Farm")], { id: 999 }), part([row("Farm")])] })
        await settle()
        await vi.advanceTimersByTimeAsync(3 * HOUR)
        expect(warned("buildCastleNotFound")).toHaveLength(1)
        expect(sent("ebu")).toHaveLength(1)
        expect(status()).toMatchObject({ params: { total: 2 } })
    })

    test("a Berimond camp that is gone after its event counts as done", async () => {
        const farm = bd(111)
        const { status, warned } = run({ plan: [part([row("FactionBarracks", 2)], { kingdom: 10, id: 7 }), part([row("Farm", 2)])], world: [castle(100, { BD: [farm] })] })
        await settle()
        expect(warned("buildCastleNotFound")).toEqual([])
        expect(status()).toMatchObject({ state: "stopped", reasonKey: "statusBuildAllDone", params: { done: 2, total: 2 } })
    })
})

describe("the hook for Build Supply", () => {
    test("after each look it says what the rest of the castle's plan needs and whether anything is payable", async () => {
        const { looked } = run({ plan: [part([row("Farm", 2, 1), row("Dwelling")])], world: [castle(100, { wood: 5, stone: 5 })] })
        await settle()
        expect(looked).toHaveLength(1)
        expect(looked[0]).toMatchObject({ castle: { id: 100, kingdomID: 0 }, need: { wood: 130 + 20, stone: 40 + 10 }, nothingPayable: true, waiting: true })
        expect(looked[0].lookAgainIn).toBeTypeOf("function")
    })

    test("a listener may ask for an earlier look, such as when its wood and stone arrive", async () => {
        const world = [castle(100, { wood: 5, stone: 5 })]
        const { writes } = run({
            plan: [part([row("Dwelling")])], world,
            listen: look => { if (look.nothingPayable) { world[0].wood = 500; world[0].stone = 500; look.lookAgainIn(2 * MINUTE) } },
        })
        await settle()
        expect(writes()).toEqual(["ebu"])
    })

    test("a castle that is done isn't announced", async () => {
        const farm = bd(111)
        const { looked } = run({ plan: [part([row("Farm", 2)])], world: [castle(100, { BD: [farm] })] })
        await settle()
        expect(looked).toEqual([])
    })
})
