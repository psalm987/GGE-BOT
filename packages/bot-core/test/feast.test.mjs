import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"
import { PluginCatalogEntry, normalizePluginSettings, readLegacy as contractsRead } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const feasts = [
    { feastID: "2", costFood: "40000", minLevel: 33, maxLevel: "69" },
    { feastID: "3", costFood: "80000", minLevel: 45, maxLevel: "69" },
    { feastID: "4", costC2: "1750", minLevel: 10, maxLevel: "69" },
    { feastID: "5", costFood: "25000", minLevel: 70, maxLevel: "1020" },
    { feastID: "7", costFood: "100000", minLevel: 70, maxLevel: "1020" },
    { feastID: "8", costFood: "150000", minLevel: 70, maxLevel: "1020" },
    { feastID: "9", costC2: "300", minLevel: 70, maxLevel: "1020" },
]

const castle = (id, food, over = {}) => ({
    id, kingdomID: 0, food, areaInfo: { type: id == 1 ? 1 : 2 },
    getProductionData: { deltaFood: 100, FoodConsumptionRate: 0, foodConsumptionReductionPercentage: 0, maxAmountFood: 10_000_000 },
    ...over,
})

async function run({ options = {}, level = 80, castles = [castle(1, 400_000)], result = 0 } = {}) {
    vi.useFakeTimers()
    const started = [], logs = []
    const bot = fakeBot()
    bot.playerInfo.level = level
    bot.botConfig.plugins.feast = { minimumFood: "0", ...options }
    vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a))
    vi.spyOn(console, "warn").mockImplementation((...a) => logs.push(a))
    const protocols = {
        KingdomID: { stormIslands: 4, berimond: 10, greatEmpire: 0 },
        AreaType: { mainCastle: 1, externalKingdom: 12, beriCastle: 11 },
        castles,
        ClientCommands: { startFeast: async (...a) => { started.push(a); return { result } } },
    }
    loadModule("plugins/feast.js", { bot, items: { feasts }, extra: { "protocols.js": protocols } })
    bot.events.emit("load")
    // Up to 15 feasts, each up to 6 s after the last, all inside the first 8-minute round.
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    vi.restoreAllMocks()
    return { started, logs }
}

test("an option set that predates the picker still feasts type 8 at level 70 and up, paying its cost", async () => {
    const { started } = await run({ options: { feastFoodReduction: "150000" } })
    expect(started).toEqual([[8, 1, 0], [8, 1, 0]])
})

test("automatic picks the dearest food feast of the player's level and never a ruby feast", async () => {
    const { started } = await run({ level: 50, castles: [castle(1, 200_000)] })
    expect(started).toEqual([[3, 1, 0], [3, 1, 0]])
})

test("a chosen type costs what the items say, not what the player typed", async () => {
    const { started } = await run({ options: { feastType: 5 } })
    expect(started.map(s => s[0])).toEqual(Array(15).fill(5))
})

test("a type the level cannot hold is refused with its level range and sends nothing", async () => {
    const { started, logs } = await run({ options: { feastType: 8 }, level: 50 })
    expect(started).toEqual([])
    expect(logs).toContainEqual(["feastTypeWrongLevel", "70-1020"])
})

test("only the listed castles feast, the main castle marker standing for the kingdom's main castle", async () => {
    const castles = [castle(1, 160_000), castle(2, 160_000), castle(3, 160_000)]
    const { started } = await run({ options: { feastCastles: [{ castle: { kingdom: 0, id: -1 } }, { castle: { kingdom: 0, id: 3 } }] }, castles })
    expect(started).toEqual([[8, 1, 0], [8, 3, 0]])
})

test("says why a castle did not feast instead of always blaming food", async () => {
    const poor = await run({ castles: [castle(1, 1000)] })
    expect(poor.logs).toContainEqual(["notEnoughFoodToFeast"])
    const slow = await run({ options: { minimumFoodRate: "500" } })
    expect(slow.logs).toContainEqual(["feastLowIncome"])
    const refused = await run({ result: 15 })
    expect(refused.logs).toContainEqual(["feastRefused", "NO_CHANGE"])
    expect(refused.logs).not.toContainEqual(["notEnoughFoodToFeast"])
})

test("the type picker has no ruby feast and the old option reads as automatic", () => {
    const { mod } = loadModule("plugins/feast.js", { mainThread: true })
    const defs = mod.pluginOptions
    const picker = defs.find(d => d.key == "feastType")
    expect(picker.selection.join("|")).not.toMatch(/ruby|imperial/i)
    expect(contractsRead(defs, { feastFoodReduction: "150000" })).toEqual({ feastType: 0 })
    const entry = PluginCatalogEntry.parse({ key: "feast", force: false, hidden: false, options: defs })
    const saved = { feast: { enabled: true, options: { feastFoodReduction: "150000", minimumFood: "100" } } }
    expect(normalizePluginSettings([entry], saved).feast.options).toEqual({ feastType: 0, minimumFood: "100" })
})

const MINUTE = 60_000
const ALREADY_PURCHASED = 174

/** The plugin with `answer(request)` giving the game's code for each feast it asks for, automatic picking type 8. */
function play({ world = [castle(1, 1_000_000), castle(2, 1_000_000)], answer = () => 0, beforeLoad } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.level = 80
    bot.botConfig.plugins.feast = { minimumFood: "0" }
    const requests = [], logs = [], warns = []
    const protocols = {
        KingdomID: { stormIslands: 4, berimond: 10, greatEmpire: 0 },
        AreaType: { mainCastle: 1, externalKingdom: 12, beriCastle: 11 },
        castles: world,
        ClientCommands: {
            startFeast: async (type, areaID) => {
                requests.push({ type, areaID })
                const result = answer({ type, areaID })
                return { type, deltaTime: 3600, result }
            },
        },
    }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args[0]))
    vi.spyOn(console, "warn").mockImplementation((...args) => warns.push(args[0]))
    loadModule("plugins/feast.js", { bot, items: { feasts }, extra: { "protocols.js": protocols } })
    beforeLoad?.(bot)
    bot.events.emit("load")
    return { requests, logs, warns }
}

test("one 'already purchased' ends the round: the other castles are not asked", async () => {
    const { requests } = play({ answer: () => ALREADY_PURCHASED })
    await vi.advanceTimersByTimeAsync(1000)
    expect(requests).toHaveLength(1)
})

test("'already purchased' is expected, said once and not as a warning", async () => {
    const { logs, warns } = play({ answer: () => ALREADY_PURCHASED })
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(logs.filter(key => key == "feastCantExtend")).toHaveLength(1)
    expect(logs).not.toContain("notEnoughFoodToFeast")
    expect(warns).toEqual([])
})

test("a feast of another type running at login is waited out", async () => {
    const { requests, logs } = play({ beforeLoad: bot => bot.xtHandler.emit("boi", { bfs: { T: 5, RT: 30 * 60 } }, 0) })
    await vi.advanceTimersByTimeAsync(25 * MINUTE)
    expect(requests).toEqual([])
    expect(logs.filter(key => key == "feastOtherRunning")).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every(r => r.type == 8)).toBe(true)
})

test("a running feast of the same type is extended", async () => {
    const { requests } = play({ world: [castle(1, 1_000_000)], beforeLoad: bot => bot.xtHandler.emit("boi", { bfs: { T: 8, RT: 30 * 60 } }, 0) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(requests.length).toBeGreaterThan(0)
})

test("no feast running at login (T -1) doesn't hold anything up", async () => {
    const { requests } = play({ world: [castle(1, 1_000_000)], beforeLoad: bot => bot.xtHandler.emit("boi", { bfs: { T: -1, RT: 0 } }, 0) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(requests.length).toBeGreaterThan(0)
})

test("another refusal still moves on to the next castle", async () => {
    const { requests } = play({ answer: ({ areaID }) => areaID == 1 ? 1 : 0 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(requests.map(r => r.areaID)).toContain(2)
})
