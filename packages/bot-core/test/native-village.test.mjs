import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const MINUTE = 60_000
/** A few rows of the game's slums.json and packages.json, as the 2026-11 items list them. */
const slums = [
    { slumLevel: "0", kID: "1" },
    { slumLevel: "1", kID: "1", packageIDs: "108+3174" },
    { slumLevel: "2", kID: "1", packageIDs: "110+111" },
    { slumLevel: "3", kID: "1", packageIDs: "112+113" },
    { slumLevel: "1", kID: "2", packageIDs: "100+2793" },
    { slumLevel: "1", kID: "3", packageIDs: "116+3177" },
]
const packages = [
    { packageID: "108", packageType: "resources", comment1: "Coins", packagePriceOil: "12000" },
    { packageID: "3174", packageType: "constructionItem", comment1: "SlumTrader- Iron Prod", packagePriceOil: "40000" },
    { packageID: "110", packageType: "soldier", comment1: "Renegade saber warrior", packagePriceOil: "9300" },
    { packageID: "112", packageType: "soldier", comment1: "Composite bowman", packagePriceOil: "22000" },
    { packageID: "100", packageType: "resources", comment1: "Coins", packagePriceCoal: "11000" },
    { packageID: "116", packageType: "resources", comment1: "Coins", packagePriceGlass: "15000" },
]
const SANDS_COINS = 1, SANDS_WARRIORS = 3, SANDS_COMPOSITE = 5, COINS = 1

/** The kingdom castles: `[kingdom, id, resources]`. */
const WORLD = [
    [0, 10, {}],
    [1, 20, { O: 100_000 }],
    [2, 30, { C: 50_000 }],
    [3, 40, { G: 14_000 }],
]
const UNLOCKS = [{ KID: 1, U: 1, SL: 2 }, { KID: 2, U: 1, SL: 4 }, { KID: 3, U: 1, SL: 1 }]

/** The plugin against a game holding `world`. `sbp` answers with `onBuy(params)`'s code. */
function run({ options = {}, world = WORLD, unlocks = UNLOCKS, onBuy = () => 0 } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.nativeVillage = { state: true, ...options }
    const reports = [], logs = []
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const resourcesOf = id => world.find(([, i]) => i == id)[2]
    const dclFrame = () => ({ C: world.map(([KID, AID, res]) => ({ KID, AI: [{ AID, ...res, gpa: {} }] })) })
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "dcl")
            reply("dcl", dclFrame())
        if (cmd == "jca")
            reply("jaa", { KID: p.KID, grc: { KID: p.KID, AID: p.CID, ...resourcesOf(p.CID) }, gca: { BD: [] }, gpa: {} })
        if (cmd == "gbc")
            reply("gbc", {})
        if (cmd == "sbp")
            reply("sbp", {}, onBuy(p))
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "debug").mockImplementation(() => {})
    loadModule("plugins/nativeVillage.js", { bot, parentPort, items: { slums, packages }, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: world.map(([KID, id]) => ({ KID, AI: [{ AI: [KID == 0 ? 1 : 12, 100 + id, 100, id, 7, 0, 0, 0, 0, 0, "Castle"] }] })) }, 0)
    bot.xtHandler.emit("dcl", dclFrame(), 0)
    bot.xtHandler.emit("kpi", { UL: unlocks }, 0)
    const sentOf = cmd => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
    return { bot, buys: () => sentOf("sbp"), opens: () => sentOf("gbc"), status: () => reports.at(-1), logs }
}

const sbp = (PID, AMT, KID) => ({ PID, BT: 3, TID: -1, AMT, KID, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 })

describe("the catalog entry", () => {
    test("is accepted by the API, with nothing picked by default", () => {
        const { mod } = loadModule("plugins/nativeVillage.js", { mainThread: true })
        const entry = { key: "nativeVillage", force: false, hidden: false, options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["burningSandsPack", "everWinterPack", "firePeaksPack", "villageGoodsKeep", "dryRunOrders"])
        for (const select of mod.pluginOptions.slice(0, 3)) {
            expect(select.default).toBe(0)
            expect(select.selection).toHaveLength(9)
        }
    })

    test("every pack choice and option is in en.json", () => {
        const { mod } = loadModule("plugins/nativeVillage.js", { mainThread: true })
        for (const key of [...mod.pluginOptions.flatMap(o => [o.key, ...o.selection ?? []]), "nativeVillage", "nativeVillage.description", "nativeVillageBought", "nativeVillageStorageFull", "nativeVillageRefused"])
            expect(en[key], key).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoPicks", "NoCastle", "LevelLow", "Short", "StorageFull", "Refused", "UnknownPack", "Bought"])
            expect(en[`statusNativeVillage${key}`]).toEqual(expect.any(String))
    })
})

describe("buying", () => {
    test("opens the village in the kingdom castle, then buys as many of the pack as the goods pay for", async () => {
        const { bot, buys, opens, status } = run({ options: { burningSandsPack: SANDS_WARRIORS } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(opens()).toEqual([{ CID: 20, KID: 1 }])
        expect(buys()).toEqual([sbp(110, 10, 1)])
        const order = bot.sent.map(([cmd]) => cmd).filter(cmd => ["jca", "gbc", "sbp"].includes(cmd))
        expect(order).toEqual(["jca", "gbc", "sbp"])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusNativeVillageBought" })
    })

    test("each village pays with its own goods: oil, charcoal and glass", async () => {
        const { buys } = run({ options: { burningSandsPack: SANDS_COINS, everWinterPack: COINS, firePeaksPack: COINS } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([sbp(108, 8, 1), sbp(100, 4, 2)])
    })

    test("buys at most 100 in one purchase", async () => {
        const { buys } = run({ options: { burningSandsPack: SANDS_COINS }, world: WORLD.map(c => c[0] == 1 ? [1, 20, { O: 5_000_000 }] : c) })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([sbp(108, 100, 1)])
    })

    test("keeps the goods you set aside", async () => {
        const { buys } = run({ options: { burningSandsPack: SANDS_COINS, villageGoodsKeep: 70_000 } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([sbp(108, 2, 1)])
    })

    test("buys nothing when the goods above the keep don't pay for one, and says so", async () => {
        const { buys, status } = run({ options: { firePeaksPack: COINS } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusNativeVillageShort" })
    })

    test("a pack above the village's level is not tried, and the status names the level it needs", async () => {
        const { buys, status } = run({ options: { burningSandsPack: SANDS_COMPOSITE } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusNativeVillageLevelLow", params: { level: 3 } })
    })

    test("a kingdom not unlocked has no village to buy from", async () => {
        const { buys, status } = run({ options: { burningSandsPack: SANDS_COINS }, unlocks: [{ KID: 1, U: 0, SL: 0 }] })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusNativeVillageNoCastle" })
    })

    test("buys again about every 30 minutes", async () => {
        const { buys } = run({ options: { burningSandsPack: SANDS_COINS } })
        await vi.advanceTimersByTimeAsync(6 * MINUTE)
        expect(buys()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(buys()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(buys()).toHaveLength(2)
    })

    test("nothing picked: asks the game nothing", async () => {
        const { bot, status } = run()
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(bot.sent.filter(([cmd]) => ["dcl", "jca", "gbc", "sbp"].includes(cmd))).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusNativeVillageNoPicks" })
    })
})

describe("refusals and dry runs", () => {
    test("full storage (377) closes that village for the session and says so, but the others carry on", async () => {
        const { buys, status, logs } = run({ options: { burningSandsPack: SANDS_COINS, everWinterPack: COINS }, onBuy: p => p.KID == 1 ? 377 : 0 })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys().map(b => b.KID)).toEqual([1, 2])
        expect(logs.filter(([key]) => key == "nativeVillageStorageFull")).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(35 * MINUTE)
        expect(buys().map(b => b.KID)).toEqual([1, 2, 2])
        expect(status()).toMatchObject({ state: "running" })
    })

    test("a village closed by full storage shows in the status when nothing else was bought", async () => {
        const { status } = run({ options: { burningSandsPack: SANDS_COINS }, onBuy: () => 377 })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusNativeVillageStorageFull" })
    })

    test("leaves the saved settings alone when a village closes", async () => {
        const { bot } = run({ options: { burningSandsPack: SANDS_COINS }, onBuy: () => 377 })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(bot.botConfig.plugins.nativeVillage.burningSandsPack).toBe(SANDS_COINS)
    })

    test("another refusal is reported and tried again next round", async () => {
        const { buys, status } = run({ options: { burningSandsPack: SANDS_COINS }, onBuy: () => 55 })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusNativeVillageRefused" })
        await vi.advanceTimersByTimeAsync(35 * MINUTE)
        expect(buys()).toHaveLength(2)
    })

    test("a dry run logs the purchase and sends neither gbc nor sbp", async () => {
        const { buys, opens, logs } = run({ options: { burningSandsPack: SANDS_WARRIORS, dryRunOrders: true } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([])
        expect(opens()).toEqual([])
        expect(logs).toContainEqual(["dryRunSbp", JSON.stringify(sbp(110, 10, 1))])
    })
})
