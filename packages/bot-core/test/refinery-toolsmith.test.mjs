import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const SECOND = 1000, MINUTE = 60 * SECOND
const REFINERY = 1, TOOLSMITH = 2
/** Product numbers of the craftRows product column. */
const REFINED_WOOD = 1, REFINED_STONE = 2, STEEL = 3, SCREWS = 5, BLACK_POWDER = 6, SAW = 7

const recipe = (id, group, level, type, queue, costs, extra = {}) =>
    ({ craftingRecipeId: String(id), recipeGroupID: String(group), level: String(level), type, queueTypeId: String(queue), craftingDuration: type == "Long" ? "18000" : "3600", ...costs, ...extra })
/** Rows of the game's craftingRecipes.json as the 2026-11 items list them, plus a short recipe priced in rubies that the game does not have. */
const craftingRecipes = [
    recipe(1, 1, 1, "Short", 1, { costWood: "54400" }),
    recipe(2, 1, 2, "Short", 1, { costWood: "60000" }),
    recipe(12, 1, 1, "Long", 1, { costWood: "122400" }),
    recipe(23, 1, 1, "Ruby", 1, { costC2: "7500", costWood: "1" }),
    recipe(34, 2, 1, "Short", 1, { costStone: "54400" }),
    recipe(35, 2, 2, "Short", 1, { costC2: "100", costStone: "1" }),
    recipe(67, 3, 1, "Short", 2, { costRefinedLumber: "200", costCoal: "19800", costOil: "20400" }),
    recipe(100, 4, 1, "Short", 2, { costRefinedLumber: "200", costCoal: "19800", costOil: "20400" }),
    recipe(133, 5, 1, "Short", 2, { costRefinedStone: "200", costCoal: "19800", costOil: "20400" }),
    recipe(368, 13, 1, "Short", 1, { costIron: "33600" }, { requiredCraftingBuildings: "2998,3175" }),
]
const queue = queueTypeId => ({ queueTypeId: String(queueTypeId), permanentProductionSlots: "1", productionSlotUnlockCostC1: "5000000", productionSlotUnlockDuration: "604800", permanentQueueSlots: "1", queueSlotUnlockCostC1: "500000,3000000,6500000", queueSlotUnlockDuration: "604800" })
const craftingQueues = [queue(1), queue(2), queue(3), queue(4)]
const buildings = [
    { wodID: "254", name: "Refinery", level: "1", kIDs: "0", areaSpecificEffects: "377&1#2,616&1#12#23#34#45#56" },
    { wodID: "2998", name: "Refinery", level: "5", kIDs: "0", areaSpecificEffects: "377&1#2#13#14,616&1#12#23#34#45#56#368" },
    { wodID: "255", name: "Toolsmith", level: "1", kIDs: "0", areaSpecificEffects: "377&3#4#5#6#7#8#9#10,616&67#78#89#100#111#122#133#144" },
]
const researches = [{ researchID: "2001", effects: "616&2" }, { researchID: "2050", effects: "616&35" }, { researchID: "2100", effects: "1&5" }]
const currencies = [{ JSONKey: "RL", Name: "RefinedLumber" }, { JSONKey: "RS", Name: "RefinedStone" }]

/** A permanent slot: a recipe id while it crafts, -1 when free. */
const P = (crid = -1, left = 0) => ({ crid, left })
/** A rentable slot: `rent` seconds left on the rental, 0 while locked. */
const R = (rent = 0, crid = -1, left = 0) => ({ crid, left, rent })
const slotList = slots => ({ CRID: slots.map(s => s.crid), RCT: slots.map(s => s.left), RUT: slots.filter(s => s.rent !== undefined).map(s => s.rent) })
/** A crafting building as crin's CBI lists it, in the main castle (kingdom 0, castle 10). */
const building = ({ CQID = TOOLSMITH, OID = CQID == TOOLSMITH ? 502 : 501, S = 3, production = [P(), R()], queue = [P(), R(), R(), R()] } = {}) =>
    ({ KID: 0, AID: 10, OID, S, CQID, PS: slotList(production), QS: slotList(queue) })

const MAIN = { kingdom: 0, id: 10 }
/** A craftRows row for the main castle. */
const row = (product, { length = 0, rentProduction = 0, rentQueue = 0 } = {}) =>
    ({ castle: MAIN, craftProduct: product, craftLength: length, rentProductionSlots: rentProduction, rentQueueSlots: rentQueue })
const CASTLE = { W: 1_000_000, S: 1_000_000, C: 1_000_000, O: 1_000_000, G: 0, I: 1_000_000 }

/**
 * The plugin against a game whose crin lists `workshops`. crst puts the recipe in the first free unlocked slot (crafting
 * slots first) or answers 63, unless `onCrst(params)` gives another code; crun rents the slot unless `onCrun` refuses.
 * Both answer with the building's entry, as the game does. `research` is rei's BR.
 */
function run({ options = {}, workshops = [building()], castle = CASTLE, coins = 100_000_000, refined = { RL: 10_000, RS: 10_000 }, research = [], layout, onCrst = () => 0, onCrun = () => 0, crinCode = 0 } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.refineryToolsmith = { state: true, ...options }
    const reports = [], logs = []
    const game = { workshops: structuredClone(workshops), coins }
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const find = p => game.workshops.find(b => b.AID == p.AID && b.OID == p.OID)
    const unlocked = (list, i) => i < 1 || list.RUT[i - 1] > 0
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p, Date.now()])
        if (cmd == "dcl")
            reply("dcl", { C: [{ KID: 0, AI: [{ AID: 10, ...castle, gpa: {} }] }] })
        if (cmd == "rei")
            reply("rei", { BR: research })
        if (cmd == "crin")
            reply("crin", crinCode == 0 ? { CAI: [{ CE: [], CBI: game.workshops }] } : {}, crinCode)
        if (cmd == "crst") {
            const b = find(p)
            let code = onCrst(p)
            if (code == 0) {
                const slot = [b.PS, b.QS].flatMap(list => list.CRID.map((crid, i) => ({ list, i, free: crid <= 0 && unlocked(list, i) }))).find(s => s.free)
                if (slot) {
                    slot.list.CRID[slot.i] = p.CRID
                    slot.list.RCT[slot.i] = 3600
                } else
                    code = 63
            }
            reply("crst", code == 0 ? structuredClone(b) : {}, code)
        }
        if (cmd == "crun") {
            const b = find(p)
            const code = onCrun(p)
            if (code == 0) {
                const list = p.ST == "production" ? b.PS : b.QS
                list.RUT[p.S[0] - 1] = 604_800
            }
            reply("crun", code == 0 ? structuredClone(b) : {}, code)
        }
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "debug").mockImplementation(() => {})
    loadModule("plugins/refineryToolsmith.js", { bot, parentPort, items: { craftingRecipes, craftingQueues, buildings, researches, currencies }, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [{ KID: 0, AI: [{ AI: [1, 110, 100, 10, 7, 0, 0, 0, 0, 0, "Castle"] }] }] }, 0)
    bot.xtHandler.emit("dcl", { C: [{ KID: 0, AI: [{ AID: 10, ...castle, gpa: {}, ...(layout && { gca: { BD: layout } }) }] }] }, 0)
    bot.xtHandler.emit("gcu", { C1: coins, C2: 0 }, 0)
    bot.xtHandler.emit("sce", Object.entries(refined), 0)
    const sentOf = cmd => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
    return { bot, game, crafts: () => sentOf("crst").map(p => p.CRID), crsts: () => sentOf("crst"), rents: () => sentOf("crun"), rounds: () => sentOf("crin").length, status: () => reports.at(-1), logs }
}

/** The first round runs a few minutes after login and the next about 10 minutes later. */
const FIRST_ROUND = 6 * MINUTE, NEXT_ROUND = 11 * MINUTE

describe("the catalog entry", () => {
    test("is accepted by the API, with rows of castle, product, length and slots to rent", () => {
        const { mod } = loadModule("plugins/refineryToolsmith.js", { mainThread: true })
        const entry = { key: "refineryToolsmith", force: false, hidden: false, options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["craftRows", "rentCoinCap", "coinFloor", "dryRunOrders"])
        expect(mod.pluginOptions[0].columns.map(c => [c.key, c.min, c.max])).toEqual([
            ["castle", undefined, undefined], ["craftProduct", 1, 12], ["craftLength", 0, 1], ["rentProductionSlots", 0, 1], ["rentQueueSlots", 0, 3],
        ])
    })

    test("every key it uses is in en.json", () => {
        for (const key of ["refineryToolsmith", "refineryToolsmith.description", "craftRows", "craftProduct", "craftLength", "rentProductionSlots", "rentQueueSlots", "rentCoinCap",
            "refineryToolsmith.craftRows.help", "refineryToolsmith.rentCoinCap.help", "refineryToolsmith.coinFloor.help",
            "craftingStarted", "craftingRented", "craftingRefused", "dryRunCrst", "dryRunCrun"])
            expect(en[key], key).toEqual(expect.any(String))
        for (const key of ["Starting", "NoRows", "NoAnswer", "Started", "DryRun", "Full", "Short", "NoBuilding", "NotWorking", "NothingUnlocked", "RentCapped", "Refused"])
            expect(en[`statusCrafting${key}`], key).toEqual(expect.any(String))
    })
})

describe("the slots", () => {
    test("fills the free permanent slots and the rented ones, never a locked rentable slot", async () => {
        const workshop = building({ production: [P(), R(0)], queue: [P(67, 3000), R(86_400), R(0), R(0)] })
        const { crafts, status } = run({ options: { craftRows: [row(SCREWS)] }, workshops: [workshop] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([67, 67])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusCraftingStarted", params: { crafts: 2 } })
    })

    test("sends crst with the building's kingdom, castle and object ids, and never a ruby price", async () => {
        const { crsts } = run({ options: { craftRows: [row(SCREWS)] }, workshops: [building({ queue: [P(67), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crsts()).toEqual([{ KID: 0, AID: 10, OID: 502, PWR: 0, CRID: 67 }])
    })

    test("a building with every slot busy is left alone and the status says so", async () => {
        const { crafts, status } = run({ options: { craftRows: [row(SCREWS)] }, workshops: [building({ production: [P(67, 100), R()], queue: [P(67, 3700), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusCraftingFull" })
    })
})

describe("taking turns", () => {
    test("goes through the picked products in turn, starting after the last one the game shows in the building", async () => {
        const workshop = building({ production: [P(), R(604_800)], queue: [P(67, 7000), R(604_800), R(604_800), R(0)] })
        const { crafts } = run({ options: { craftRows: [row(SCREWS), row(BLACK_POWDER), row(SAW)] }, workshops: [workshop] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([100, 133, 67, 100])
    })

    test("carries the turn on from one round to the next", async () => {
        const { game, crafts } = run({ options: { craftRows: [row(SCREWS), row(BLACK_POWDER), row(SAW)] }, workshops: [building({ queue: [P(67), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([100])
        game.workshops[0].PS.CRID[0] = -1
        await vi.advanceTimersByTimeAsync(NEXT_ROUND)
        expect(crafts()).toEqual([100, 133])
    })

    test("a row naming the kingdom's main castle and one naming that castle by id share the building's turn", async () => {
        const rows = [{ ...row(SCREWS), castle: { kingdom: 0, id: -1 } }, row(BLACK_POWDER)]
        const { crafts } = run({ options: { craftRows: rows } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([67, 100])
    })

    test("skips a product the castle can't pay for and makes the next one", async () => {
        const { crafts } = run({ options: { craftRows: [row(SCREWS), row(SAW)] }, refined: { RL: 100, RS: 10_000 }, workshops: [building({ queue: [P(67), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([133])
    })

    test("waits when nothing picked is affordable, and says which product is short", async () => {
        const { crafts, status } = run({ options: { craftRows: [row(SCREWS)] }, refined: { RL: 0 } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusCraftingShort", params: { product: "Screws" } })
    })

    test("makes the long recipe when the row asks for it", async () => {
        const { crafts } = run({ options: { craftRows: [row(REFINED_WOOD, { length: 1 })] }, workshops: [building({ CQID: REFINERY, queue: [P(1), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([12])
    })

    test("makes the highest recipe level that research has unlocked", async () => {
        const { crafts } = run({ options: { craftRows: [row(REFINED_WOOD)] }, research: [2001], workshops: [building({ CQID: REFINERY, queue: [P(1), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([2])
    })

    test("makes steel only in a Refinery whose level the recipe needs", async () => {
        const low = run({ options: { craftRows: [row(STEEL)] }, workshops: [building({ CQID: REFINERY })], layout: [[254, 501, 0, 0, 0, 0, 0, 0, 0, 0, 0]] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(low.crafts()).toEqual([])
        expect(low.status()).toMatchObject({ reasonKey: "statusCraftingNothingUnlocked" })

        const high = run({ options: { craftRows: [row(STEEL)] }, workshops: [building({ CQID: REFINERY, queue: [P(1), R(), R(), R()] })], layout: [[2998, 501, 0, 0, 0, 0, 0, 0, 0, 0, 0]] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(high.crafts()).toEqual([368])
    })

    test("never makes a recipe priced in rubies, even one the building has unlocked", async () => {
        const { crafts } = run({ options: { craftRows: [row(REFINED_STONE)] }, research: [2050], workshops: [building({ CQID: REFINERY, queue: [P(1), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([34])
    })
})

describe("renting slots", () => {
    test("rents the queue slots the row asks for, in order, with coins", async () => {
        const { rents, status } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 2 })], rentCoinCap: 10_000_000, coinFloor: 0 }, workshops: [building({ production: [P(67, 100), R()], queue: [P(67, 3700), R(), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rents()).toEqual([
            { KID: 0, AID: 10, OID: 502, S: [1], ST: "queue" },
            { KID: 0, AID: 10, OID: 502, S: [2], ST: "queue" },
        ])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusCraftingStarted", params: { crafts: 2, slots: 2, coins: 3_500_000 } })
    })

    test("rents the crafting slot before the queue slots", async () => {
        const { rents } = run({ options: { craftRows: [row(SCREWS, { rentProduction: 1, rentQueue: 1 })], coinFloor: 0 } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rents().map(p => [p.ST, p.S])).toEqual([["production", [1]], ["queue", [1]]])
    })

    test("spends no more than the coin cap in one round", async () => {
        const { rents } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 3 })], rentCoinCap: 4_000_000, coinFloor: 0 } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rents().map(p => p.S)).toEqual([[1], [2]])
    })

    test("says so when the cap keeps a picked slot locked and nothing else could be done", async () => {
        const { rents, status } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 3 })], rentCoinCap: 4_000_000, coinFloor: 0 }, refined: { RL: 0 },
            workshops: [building({ queue: [P(), R(500_000), R(500_000), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rents()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusCraftingRentCapped" })
    })

    test("never takes the coins under the floor", async () => {
        const { rents, status } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 1 })], coinFloor: 1_800_000 }, coins: 2_000_000, refined: { RL: 0 } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rents()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusCraftingRentCapped" })
    })

    test("leaves a slot that is still rented alone, and rents it again shortly after it runs out", async () => {
        const { bot, rents } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 1 })], coinFloor: 0 }, workshops: [building({ production: [P(67, 9000), R()], queue: [P(67, 9000), R(120), R(), R()] })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND - 1 * MINUTE)
        expect(rents()).toEqual([])
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        const [first, second] = bot.sent.filter(([cmd]) => cmd == "crin").map(([, , at]) => at)
        expect(second - first).toBeGreaterThanOrEqual(120 * SECOND + 30 * SECOND)
        expect(second - first).toBeLessThanOrEqual(120 * SECOND + 3 * MINUTE)
    })
})

describe("refusals", () => {
    test("63 (no free slot) is the game's normal 'all full': the next round tries again", async () => {
        const { crafts, status } = run({ options: { craftRows: [row(SCREWS)] }, onCrst: () => 63 })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([67])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusCraftingFull" })
        await vi.advanceTimersByTimeAsync(NEXT_ROUND)
        expect(crafts()).toEqual([67, 67])
    })

    test("too few resources after all (55) waits for the next round without holding the building back", async () => {
        const { crafts, status } = run({ options: { craftRows: [row(SCREWS)] }, onCrst: () => 55 })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([67])
        expect(status()).toMatchObject({ reasonKey: "statusCraftingShort" })
        await vi.advanceTimersByTimeAsync(NEXT_ROUND)
        expect(crafts()).toEqual([67, 67])
    })

    test("any other refusal holds that building back for one round, then two or more, never past an hour", async () => {
        const { bot, status } = run({ options: { craftRows: [row(SCREWS)] }, onCrst: () => 426 })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(status()).toMatchObject({ reasonKey: "statusCraftingRefused" })
        await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE)
        /** The crin rounds that sent no crst between each two crsts. */
        const skipped = []
        let count = 0
        for (const [cmd] of bot.sent.filter(([cmd]) => cmd == "crin" || cmd == "crst"))
            if (cmd == "crst") {
                skipped.push(count)
                count = 0
            } else
                count++
        expect(skipped[1] - 1).toBe(1)
        expect(skipped[2] - 1).toBeGreaterThanOrEqual(2)
        expect(Math.max(...skipped.slice(1).map(n => n - 1))).toBeLessThanOrEqual(6)
    })

    test("a refused rental holds the building back too", async () => {
        const { rents, crafts } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 1 })], coinFloor: 0 }, onCrun: () => 426 })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rents()).toHaveLength(1)
        expect(crafts()).toEqual([])
    })
})

describe("buildings that aren't working", () => {
    test.each([0, 1, 2, 5, 6])("state %i: nothing is sent to it", async S => {
        const { crafts, rents, status } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 1 })], coinFloor: 0 }, workshops: [building({ S })] })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([])
        expect(rents()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusCraftingNotWorking" })
    })

    test("a row whose castle has no such building says so", async () => {
        const { crafts, status } = run({ options: { craftRows: [row(REFINED_WOOD)] } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusCraftingNoBuilding" })
    })
})

describe("log only", () => {
    test("reads the buildings but writes each craft and rental to the log instead of sending it", async () => {
        const { crafts, rents, rounds, logs, status } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 1 })], coinFloor: 0, dryRunOrders: true } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rounds()).toBe(1)
        expect(crafts()).toEqual([])
        expect(rents()).toEqual([])
        expect(logs.filter(([key]) => key == "dryRunCrun").map(([, json]) => JSON.parse(json))).toEqual([{ KID: 0, AID: 10, OID: 502, S: [1], ST: "queue" }])
        expect(logs.filter(([key]) => key == "dryRunCrst")).toHaveLength(3)
        expect(status()).toMatchObject({ reasonKey: "statusCraftingDryRun", params: { crafts: 3, slots: 1 } })
    })

    test("leaves the bot's counts of resources and coins as they were, so every round logs the same", async () => {
        const { logs } = run({ options: { craftRows: [row(SCREWS, { rentQueue: 1 })], coinFloor: 0, rentCoinCap: 500_000, dryRunOrders: true }, refined: { RL: 600 } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND + NEXT_ROUND)
        expect(logs.filter(([key]) => key == "dryRunCrst")).toHaveLength(6)
        expect(logs.filter(([key]) => key == "dryRunCrun")).toHaveLength(2)
    })
})

describe("the round", () => {
    test("asks for research once an hour and for the buildings every round", async () => {
        const { bot, rounds } = run({ options: { craftRows: [row(SCREWS)] } })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND + 3 * NEXT_ROUND)
        expect(rounds()).toBeGreaterThanOrEqual(4)
        expect(bot.sent.filter(([cmd]) => cmd == "rei")).toHaveLength(1)
    })

    test("with no rows it reads nothing and says so", async () => {
        const { rounds, status } = run()
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(rounds()).toBe(0)
        expect(status()).toMatchObject({ reasonKey: "statusCraftingNoRows" })
    })

    test("a crin refusal sends nothing else and says so", async () => {
        const { crafts, status } = run({ options: { craftRows: [row(SCREWS)] }, crinCode: 1 })
        await vi.advanceTimersByTimeAsync(FIRST_ROUND)
        expect(crafts()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusCraftingNoAnswer" })
    })
})
