import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")
const captured = require("./fixtures/protocol/daily-20261121.json")

const MINUTE = 60_000

afterEach(() => vi.useRealTimers())

const HALBERD = 308, LADDER = 614, RAM = 611, FLAG = 660
const units = [
    { wodID: HALBERD, type: "Elitehalberd", name: "Barracks", role: "melee", costC1: "180" },
    { wodID: 2000, type: "Elitehalberd", name: "Barracks", role: "melee", costC1: "185" },
    { wodID: 700, type: "Eliteguard", name: "Barracks", role: "ranged", costC1: "300", costC2: "5" },
    { wodID: 701, type: "Rubyguard", name: "Barracks", role: "melee", costC2: "9" },
    { wodID: LADDER, type: "Ladder", name: "Workshop", typ: "Attack", costWood: "28", costStone: "12" },
    { wodID: RAM, type: "Ram", name: "Workshop", typ: "Attack", costWood: "56", costStone: "24" },
    { wodID: FLAG, type: "Flag", name: "Workshop", typ: "Attack", costC1: "125" },
    { wodID: 245, type: "SceatGate", name: "Workshop", typ: "Attack", costComponent1: "12", costComponent6: "8" },
    { wodID: 702, type: "Rubyram", name: "Workshop", typ: "Attack", costC2: "20" },
]

const SLOTS = 2

/** A castle as the game reports it. `queues` holds each production list's orders as `[wodID, amount]`, the first one in production. */
const castle = (id, { kingdom = 0, wood = 100_000, stone = 100_000, have = {}, queues = {}, buildings = [] } = {}) =>
    ({ id, kingdom, wood, stone, have, buildings, queues: { 0: queues[0] ?? [], 1: queues[1] ?? [] } })

/** What `spl` says for one list: the order in production as the capture shows it, two free slots and three that are locked. */
const splOf = (c, list) => {
    const [first, ...waiting] = c.queues[list]
    return {
        PS: first ? { WID: first[0], TUA: first[1], CBS: 0, RAH: false, PID: 1, RCT: 107, ICT: 107, SPID: 2 } : {},
        QS: Array.from({ length: 5 }, (_, i) => i < SLOTS ? (waiting[i] ? { P: { WID: waiting[i][0], AMT: waiting[i][1] }, SI: { RUT: -1, VIP: 0 } } : { SI: { RUT: -1, VIP: 0 } }) : { SI: { RUT: 0, VIP: 0 } }),
        RM: 0, TCT: first ? 107 : 0, LID: list,
    }
}

/** The plugin against a game that answers dcl, jca, spl and bup from `world`. */
function run({ options = {}, world = [castle(10)], coins = 10_000_000, spl, refuse = () => 0, onBup, unitItems = units, buildingItems = [] } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerID = 7
    bot.botConfig.plugins.recruitTools = { state: true, coinFloor: 0, ...options }
    const logs = [], warns = [], reports = []
    const state = { coins, bupAt: [] }
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const find = params => world.find(c => c.id == (params.CID ?? params.AID))
    const inventory = c => Object.entries(c.have).map(([wodID, amount]) => [Number(wodID), amount])
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "dcl")
            reply("dcl", { C: [...new Set(world.map(c => c.kingdom))].map(KID => ({ KID, AI: world.filter(c => c.kingdom == KID).map(c => ({ AID: c.id, W: c.wood, S: c.stone, AC: inventory(c) })) })) })
        if (cmd == "jca") {
            const c = find(p)
            world.forEach(w => { w.current = w === c })
            reply("jaa", { KID: c.kingdom, grc: { KID: c.kingdom, AID: c.id, W: c.wood, S: c.stone, AC: inventory(c) }, gca: { BD: c.buildings.map(wodID => [wodID, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), scl: { OIDL: [] } }, gpa: {} })
        }
        if (cmd == "spl") {
            const c = world.find(w => w.current)
            reply("spl", spl?.(c, p.LID) ?? splOf(c, p.LID))
        }
        if (cmd == "bup") {
            const c = find(p)
            state.bupAt.push(Date.now())
            if (refuse(p))
                return reply("bup", {}, refuse(p))
            const unit = units.find(u => u.wodID == p.WID)
            state.coins -= Number(unit.costC1 ?? 0) * p.AMT
            c.queues[p.LID].push([p.WID, p.AMT])
            reply("bup", onBup?.(c, p) ?? { spl: splOf(c, p.LID), grc: {}, gcu: { C1: state.coins, C2: 5 } })
        }
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => warns.push(args[0]))
    loadModule("plugins/recruitTools.js", { bot, parentPort, items: { units: unitItems, buildings: buildingItems } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcu", { C1: coins, C2: 5 }, 0)
    const bups = () => bot.sent.filter(([cmd]) => cmd == "bup").map(([, p]) => p)
    return { bot, bups, bupAt: () => state.bupAt, status: () => reports.at(-1), logs, warns, world, state }
}

const unitRow = (troop, stock, batch = 100, id = 10, kingdom = 0) => ({ castle: { kingdom, id }, troop, stock, batch })
const toolRow = (tool, stock, batch = 80, id = 10, kingdom = 0) => ({ castle: { kingdom, id }, tool, stock, batch })
const settle = () => vi.advanceTimersByTimeAsync(12 * MINUTE)

describe("the catalog entry", () => {
    test("is accepted by the API and offers a list of troops, a list of tools, two floors and a dry run", () => {
        const { mod } = loadModule("plugins/recruitTools.js", { mainThread: true })
        const entry = { key: "recruitTools", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions, checks: mod.checks }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["troopTargets", "toolStockTargets", "coinFloor", "resourceFloor", "dryRunOrders"])
    })

    test("only lists items a plugin may order, and starts with no rows and a coin floor", () => {
        const { mod } = loadModule("plugins/recruitTools.js", { mainThread: true })
        const [troopTargets, toolStockTargets, coinFloor] = mod.pluginOptions
        expect(troopTargets.columns.find(c => c.type == "troop").orderable).toBe(true)
        expect(toolStockTargets.columns.find(c => c.type == "tool").orderable).toBe(true)
        expect([troopTargets.default, toolStockTargets.default]).toEqual([[], []])
        expect(coinFloor.default).toBeGreaterThan(0)
        expect(toolStockTargets.columns.find(c => c.key == "batch").max).toBe(80)
    })

    test.each(["recruitTools", "recruitTools.description", "troopTargets", "toolStockTargets", "batch", "recruitToolsRefused", "recruitToolsQueueUnknown", "dryRunBup"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoTargets", "NotOrderable", "NoCastle", "NoAnswer", "QueueUnknown", "QueueFull", "CoinFloor", "NoResources", "Refused", "TooMany", "LevelLocked", "TargetsMet", "Ordered"])
            expect(en[`statusRecruitTools${key}`]).toEqual(expect.any(String))
    })
})

describe("the order, as the game was sent it", () => {
    const sentAs = (capturedOrder, castleId) => ({ ...capturedOrder, AID: castleId })

    test("a recruit order has the captured fields in the captured order", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 1, 1, 1_000_001)] }, world: [castle(1_000_001)] })
        await settle()
        expect(bups().map(p => JSON.stringify(p))).toEqual([JSON.stringify(sentAs(captured.bup_1.payload, 1_000_001))])
    })

    test("a tool order has the captured fields in the captured order", async () => {
        const { bups } = run({ options: { toolStockTargets: [toolRow(LADDER, 1, 1, 1_000_001)] }, world: [castle(1_000_001)] })
        await settle()
        expect(bups().map(p => JSON.stringify(p))).toEqual([JSON.stringify(sentAs(captured.bup_2.payload, 1_000_001))])
    })

    test("recruits go to list 0 and tools to list 1, each read with its own spl", async () => {
        const { bot, bups } = run({ options: { troopTargets: [unitRow(HALBERD, 50)], toolStockTargets: [toolRow(LADDER, 50)] } })
        await settle()
        expect(bot.sent.filter(([cmd]) => cmd == "spl").map(([, p]) => p)).toEqual([{ LID: 0 }, { LID: 1 }])
        expect(bups().map(p => [p.LID, p.WID])).toEqual([[0, HALBERD], [1, LADDER]])
    })

    test("an order holds at most the batch, and at most 80 tools", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 250, 100)], toolStockTargets: [toolRow(LADDER, 500, 80)] }, world: [castle(10, { have: { [HALBERD]: 20 } })] })
        await settle()
        expect(bups().map(p => [p.WID, p.AMT])).toEqual([[HALBERD, 100], [HALBERD, 100], [HALBERD, 30], [LADDER, 80], [LADDER, 80], [LADDER, 80]])
    })

    test("stops at the target: the stock at home, in production and in a slot all count", async () => {
        const world = [castle(10, { have: { [HALBERD]: 50 }, queues: { 0: [[HALBERD, 30], [HALBERD, 20]] } })]
        const { bups, status } = run({ options: { troopTargets: [unitRow(HALBERD, 100)] }, world })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusRecruitToolsTargetsMet" })
    })

    test("a run after the first counts what it queued and orders no more", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 100)] } })
        await vi.advanceTimersByTimeAsync(4 * 60 * MINUTE)
        expect(bups().map(p => p.AMT)).toEqual([100])
    })
})

describe("room in the queue", () => {
    test("skips a list whose order in production is busy and whose slots show nothing free", async () => {
        const spl = () => ({ PS: { WID: HALBERD, TUA: 5, RCT: 100, ICT: 100 }, QS: Array.from({ length: 5 }, () => ({ SI: { RUT: 0, VIP: 0 } })), RM: 0, TCT: 100, LID: 0 })
        const { bups, status } = run({ options: { troopTargets: [unitRow(HALBERD, 1000)] }, spl })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusRecruitToolsQueueFull" })
    })

    test("orders into the order in production's place when it is empty, then into each free slot, and no further", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 10)] } })
        await settle()
        expect(bups()).toHaveLength(1 + SLOTS)
    })

    test("with something in production, orders only into the free slots", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 10)] }, world: [castle(10, { queues: { 0: [[HALBERD, 7]] } })] })
        await settle()
        expect(bups()).toHaveLength(SLOTS)
    })

    test("a filled slot of a shape nobody captured is not room, and nothing is ordered into that list", async () => {
        const spl = () => ({ PS: { WID: HALBERD, TUA: 5 }, QS: [{ SI: { RUT: -1, VIP: 0 }, Z: { Q: 1 } }, { SI: { RUT: -1, VIP: 0 } }, { SI: { RUT: 0, VIP: 0 } }], RM: 0, TCT: 100, LID: 0 })
        const { bups, status, warns } = run({ options: { troopTargets: [unitRow(HALBERD, 1000)] }, spl })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusRecruitToolsQueueUnknown", params: { item: "Elitehalberd" } })
        expect(warns).toContain("recruitToolsQueueUnknown")
    })

    test("a reply that doesn't show the order taken ends the run for that list, so a wrong guess costs one order", async () => {
        const { bups, status } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 10)] }, onBup: () => ({ spl: { PS: {}, QS: [{ SI: { RUT: -1 } }, { SI: { RUT: -1 } }] } }) })
        await settle()
        expect(bups()).toHaveLength(1)
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsQueueUnknown" })
    })

    test("never unlocks a slot, which costs rubies", async () => {
        const { bot } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 10)], toolStockTargets: [toolRow(LADDER, 10_000, 10)] } })
        await settle()
        expect(bot.sent.map(([cmd]) => cmd)).not.toContain("ups")
    })

    test("checks the queue again when the order in production is done, not before", async () => {
        const world = [castle(10, { queues: { 0: [[HALBERD, 1]] } })]
        const slow = (c, list) => ({ ...splOf(c, list), TCT: 3600 })
        const { bot } = run({ options: { troopTargets: [unitRow(HALBERD, 1)] }, world, spl: slow })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        const reads = () => bot.sent.filter(([cmd]) => cmd == "spl").length
        expect(reads()).toBe(1)
        world[0].queues[0].length = 0
        await vi.advanceTimersByTimeAsync(50 * MINUTE)
        expect(reads()).toBe(2)
    })
})

describe("what it never orders", () => {
    test.each([
        ["a troop that costs rubies as well", unitRow(700, 100)],
        ["a troop that costs only rubies", unitRow(701, 100)],
    ])("%s", async (_name, row) => {
        const { bups, status } = run({ options: { troopTargets: [row] } })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNotOrderable" })
    })

    test.each([
        ["a tool that costs rubies", toolRow(702, 100)],
        ["a tool built from Sceat components", toolRow(245, 100)],
        ["a troop put in the tool list", toolRow(HALBERD, 100)],
    ])("%s", async (_name, row) => {
        const { bups, status } = run({ options: { toolStockTargets: [row] } })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNotOrderable" })
    })

    test("a tool put in the troop list", async () => {
        const { bups, status } = run({ options: { troopTargets: [unitRow(LADDER, 100)] } })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNotOrderable" })
    })

    test("a row of a castle the account doesn't have", async () => {
        const { bups, status } = run({ options: { troopTargets: [unitRow(HALBERD, 100, 100, 99)] } })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNoCastle" })
    })

    test("the orderable rows still run beside one that isn't", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(700, 100), unitRow(HALBERD, 10)] } })
        await settle()
        expect(bups().map(p => p.WID)).toEqual([HALBERD])
    })
})

describe("the floors", () => {
    test("coins are kept above the coin floor: 1500 coins over a floor of 900 pay for 3 troops of 180", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 100, 100)], coinFloor: 900 }, coins: 1500 })
        await settle()
        expect(bups().map(p => p.AMT)).toEqual([3])
    })

    test("with nothing above the floor nothing is ordered and the status names the floor", async () => {
        const { bups, status } = run({ options: { troopTargets: [unitRow(HALBERD, 100)], coinFloor: 1000 }, coins: 1000 })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusRecruitToolsCoinFloor", params: { item: "Elitehalberd" } })
    })

    test("coins the first order spent, from the game's reply, count against the next", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 100, 5)], coinFloor: 0 }, coins: 1000 })
        await settle()
        expect(bups().map(p => p.AMT)).toEqual([5])
    })

    test("a tool paid with resources keeps the resource floor of the castle: 1000 of each over 400 pays for 21 ladders", async () => {
        const { bups } = run({ options: { toolStockTargets: [toolRow(LADDER, 80)], resourceFloor: 400 }, world: [castle(10, { wood: 1000, stone: 1000 })] })
        await settle()
        expect(bups().map(p => p.AMT)).toEqual([21])
    })

    test("a resource short castle orders nothing and the status says resources", async () => {
        const { bups, status } = run({ options: { toolStockTargets: [toolRow(LADDER, 80)] }, world: [castle(10, { wood: 10, stone: 10 })] })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNoResources" })
    })

    test("a coin tool takes its price from the coins, not the castle", async () => {
        const { bups } = run({ options: { toolStockTargets: [toolRow(FLAG, 10, 10)], coinFloor: 0 }, world: [castle(10, { wood: 0, stone: 0 })] })
        await settle()
        expect(bups().map(p => [p.WID, p.AMT])).toEqual([[FLAG, 10]])
    })

    test("one castle's spending doesn't take another's resources", async () => {
        const world = [castle(10, { wood: 2000, stone: 2000 }), castle(11, { wood: 2000, stone: 2000 })]
        const { bups } = run({ options: { toolStockTargets: [toolRow(LADDER, 40, 40, 10), toolRow(LADDER, 40, 40, 11)] }, world })
        await settle()
        expect(bups().map(p => [p.AID, p.AMT])).toEqual([[10, 40], [11, 40]])
    })
})

describe("one castle at a time", () => {
    test("each castle's stock is its own, and its orders go to it after the bot has moved there", async () => {
        const world = [castle(10, { have: { [HALBERD]: 100 } }), castle(11, { kingdom: 1 })]
        const { bot, bups } = run({ options: { troopTargets: [unitRow(HALBERD, 100, 50, 10), unitRow(HALBERD, 100, 50, 11, 1)] }, world })
        await settle()
        expect(bups().map(p => [p.SID, p.AID, p.AMT])).toEqual([[1, 11, 50], [1, 11, 50]])
        const log = bot.sent.map(([cmd, p]) => cmd == "jca" ? `jca ${p.CID}` : cmd == "bup" ? `bup ${p.AID}` : undefined).filter(Boolean)
        expect(log.filter(entry => entry == "jca 11").length).toBeGreaterThan(0)
        expect(log.indexOf("jca 11")).toBeLessThan(log.indexOf("bup 11"))
    })

    test("two castles that both need a recruit are served in turn", async () => {
        const world = [castle(10), castle(11)]
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 50, 50, 10), unitRow(HALBERD, 50, 50, 11)] }, world })
        await settle()
        expect(bups().map(p => p.AID)).toEqual([10, 11])
    })

    test("a castle whose queue can't be read doesn't stop the others", async () => {
        const world = [castle(10), castle(11)]
        const spl = (c, list) => c.id == 10 ? { LID: list } : splOf(c, list)
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 50, 50, 10), unitRow(HALBERD, 50, 50, 11)] }, world, spl })
        await settle()
        expect(bups().map(p => p.AID)).toEqual([11])
    })
})

describe("refusals and the dry run", () => {
    test("a refusal is logged and the status says refused, and the next list still runs", async () => {
        const { bups, status, warns } = run({
            options: { troopTargets: [unitRow(HALBERD, 100)], toolStockTargets: [toolRow(LADDER, 10)] },
            refuse: p => p.LID == 0 ? 1 : 0,
        })
        await settle()
        expect(bups().map(p => p.LID)).toEqual([0, 1])
        expect(warns).toContain("recruitToolsRefused")
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsOrdered" })
    })

    test("a refusal for coins reads as short of resources", async () => {
        const { status } = run({ options: { troopTargets: [unitRow(HALBERD, 100)] }, refuse: () => 10 })
        await settle()
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNoResources" })
    })

    test("a dry run logs each order and sends none, and counts them against the room", async () => {
        const { bups, logs } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 10)], dryRunOrders: true } })
        await settle()
        expect(bups()).toEqual([])
        expect(logs.filter(([key]) => key == "dryRunBup")).toHaveLength(1 + SLOTS)
    })

    test("a dry run stays above the floor over its own orders", async () => {
        const { logs } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 5)], dryRunOrders: true, coinFloor: 900 }, coins: 1500 })
        await settle()
        expect(logs.filter(([key]) => key == "dryRunBup").map(([, order]) => JSON.parse(order).AMT)).toEqual([3])
    })
})

describe("why a castle can't make a unit", () => {
    const BARRACKS_L3 = 162, BARRACKS_L6 = 2162, WORKSHOP_L1 = 165
    const buildingItems = [
        { wodID: BARRACKS_L3, name: "Barracks", level: "3" },
        { wodID: BARRACKS_L6, name: "Barracks", level: "6" },
        { wodID: WORKSHOP_L1, name: "Workshop", level: "1" },
        { wodID: 777, name: "Deco", level: "0" },
    ]
    const unitItems = [{ ...units[0], buildingLevel: "6" }, ...units.slice(1)]
    const setup = (buildings, row = unitRow(HALBERD, 100)) => run({ options: { troopTargets: [row] }, world: [castle(10, { buildings })], unitItems, buildingItems })

    test("no barracks: orders nothing, says so, and leaves the plan alone", async () => {
        const { bups, status, warns } = setup([WORKSHOP_L1, 777])
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusRecruitToolsNoBuilding", params: { item: "Elitehalberd", building: "barracks" } })
        expect(warns).toContain("recruitCantMake")
    })

    test("a barracks below the level the unit needs names the level", async () => {
        const { bups, status } = setup([BARRACKS_L3])
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsBuildingLevel", params: { item: "Elitehalberd", building: "barracks", level: "6" } })
    })

    test("a tool of a workshop the castle lacks says so by the workshop's plain name", async () => {
        const { bups, status } = run({ options: { toolStockTargets: [toolRow(LADDER, 100)] }, world: [castle(10, { buildings: [BARRACKS_L6] })], unitItems, buildingItems })
        await settle()
        expect(bups()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsNoBuilding", params: { item: "Ladder", building: "siege workshop" } })
    })

    test("a barracks of the right level orders as before", async () => {
        const { bups } = setup([BARRACKS_L6])
        await settle()
        expect(bups().length).toBeGreaterThan(0)
    })

    test("a castle whose buildings are not known gets no verdict and still orders", async () => {
        const { bups } = setup([])
        await settle()
        expect(bups().length).toBeGreaterThan(0)
    })

    test("a row that can't be made does not stop the others in the same castle", async () => {
        const world = [castle(10, { buildings: [BARRACKS_L3, WORKSHOP_L1] })]
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 100)], toolStockTargets: [toolRow(LADDER, 10)] }, world, unitItems, buildingItems })
        await settle()
        expect(bups().map(p => p.WID)).toEqual([LADDER])
    })

    test("it never edits the saved plan", async () => {
        const { bot } = setup([WORKSHOP_L1])
        const before = JSON.stringify(bot.botConfig.plugins.recruitTools)
        await settle()
        expect(JSON.stringify(bot.botConfig.plugins.recruitTools)).toBe(before)
    })

    test.each(["NoBuilding", "BuildingLevel"])("en.json names statusRecruitTools%s", key => {
        expect(en[`statusRecruitTools${key}`]).toEqual(expect.any(String))
    })
})

test("with no rows it says so and asks nothing of the game", async () => {
    const { bot, status } = run()
    await settle()
    expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusRecruitToolsNoTargets" })
    expect(bot.sent).toEqual([])
})

describe("what the game's refusals mean", () => {
    test.each([
        [10, "statusRecruitToolsNoResources"],
        [55, "statusRecruitToolsNoResources"],
        [11, "statusRecruitToolsRefused"],
        [63, "statusRecruitToolsQueueFull"],
    ])("code %i reads as %s", async (code, reasonKey) => {
        const { status } = run({ options: { troopTargets: [unitRow(HALBERD, 100)] }, refuse: () => code })
        await settle()
        expect(status()).toMatchObject({ reasonKey })
    })

    test("too many at once halves the order at the next round, until the game takes it", async () => {
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 100)] }, refuse: p => p.AMT > 30 ? 88 : 0 })
        await vi.advanceTimersByTimeAsync(60 * MINUTE)
        expect(bups().slice(0, 4).map(p => p.AMT)).toEqual([100, 50, 25, 25])
    })

    test("too many tools at once halves the tool order the same way", async () => {
        const { bups } = run({ options: { toolStockTargets: [toolRow(LADDER, 10_000, 80)] }, refuse: p => p.AMT > 30 ? 240 : 0 })
        await vi.advanceTimersByTimeAsync(60 * MINUTE)
        expect(bups().slice(0, 3).map(p => p.AMT)).toEqual([80, 40, 20])
    })

    test("soldiers are never ordered past what one barracks slot takes at its level", async () => {
        const buildingItems = [{ wodID: 900, name: "Barracks", group: "Building", level: "10", stackSize: "110" }]
        const { bups } = run({ options: { troopTargets: [unitRow(HALBERD, 10_000, 500)] }, world: [castle(10, { buildings: [900] })], buildingItems })
        await settle()
        expect(bups().map(p => p.AMT)).toEqual([110, 110, 110])
    })

    test("a unit the account can't make yet is asked for once, then left out with the reason shown", async () => {
        const { bups, status, warns } = run({ options: { troopTargets: [unitRow(HALBERD, 100)] }, refuse: () => 87 })
        await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE)
        expect(bups()).toHaveLength(1)
        expect(status()).toMatchObject({ reasonKey: "statusRecruitToolsLevelLocked", params: { item: "Elitehalberd" } })
        expect(warns.filter(key => key == "recruitToolsLevelLocked")).toHaveLength(1)
    })

    test("a row the game keeps refusing is asked 1, 2, then 4 rounds apart, and at least once an hour", async () => {
        const { bupAt } = run({ options: { troopTargets: [unitRow(HALBERD, 100)] }, refuse: () => 1 })
        await vi.advanceTimersByTimeAsync(6 * 60 * MINUTE)
        const gaps = bupAt().slice(1).map((at, i) => at - bupAt()[i])
        expect(gaps[0]).toBeGreaterThanOrEqual(15 * MINUTE)
        expect(gaps[1]).toBeGreaterThanOrEqual(30 * MINUTE)
        expect(gaps[2]).toBeGreaterThanOrEqual(60 * MINUTE)
        expect(Math.max(...gaps)).toBeLessThanOrEqual(80 * MINUTE)
    })

    test("a refused row doesn't hold up another row of the same castle", async () => {
        const { bups } = run({
            options: { troopTargets: [unitRow(HALBERD, 100, 100), unitRow(2000, 10_000, 1)] },
            refuse: p => p.WID == HALBERD ? 1 : 0,
        })
        await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE)
        expect(bups().filter(p => p.WID == 2000).length).toBeGreaterThan(bups().filter(p => p.WID == HALBERD).length)
    })
})
