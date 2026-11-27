import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

const MINUTE = 60_000

afterEach(() => vi.useRealTimers())

const [header, ...lines] = readFileSync(new URL("../../../docs/protocol/data/armorer-packages.tsv", import.meta.url), "utf8").trim().split("\n")
const columns = header.split("\t")
const packages = lines.map(line => Object.fromEntries(line.split("\t").map((value, i) => [columns[i], value]).filter(([, value]) => value !== "-")))

const units = [
    { wodID: 611, type: "Ram", name: "Workshop" },
    { wodID: 614, type: "Ladder", name: "Workshop" },
    { wodID: 637, type: "DefenceRocks", name: "Dworkshop" },
]

const LADDER = 28, RAM = 32, ROCKS = 30, ROCKS_DISCOUNT = 2472
const LADDER_PRICE = 220

/**
 * The plugin against a game with `coins`, whose armourer lists `live` package ids and whose castles hold `castles`
 * (`[kingdom, id, { tool: amount }, area type?]`, the type defaulting to the kingdom's main castle). `refuse` maps a purchase to an error code.
 */
function run({ options = {}, coins = 10_000_000, live = [LADDER, RAM], castles = [[0, 10, {}]], movements = [], refuse = () => 0 } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerID = 7
    bot.botConfig.plugins.buyTools = { state: true, margin: 4000, spendCap: 500_000_000, ...options }
    const logs = [], reports = []
    const state = { coins }
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "dcl")
            reply("dcl", { C: [...new Set(castles.map(([kingdom]) => kingdom))].map(KID => ({ KID, AI: castles.filter(([k]) => k == KID).map(([, AID, tools]) => ({ AID, AC: Object.entries(tools).map(([id, n]) => [Number(id), n]) })) })) })
        if (cmd == "sbp") {
            if (refuse(p))
                return reply("sbp", {}, refuse(p))
            state.coins -= Number(packages.find(pack => pack.packageID == p.PID).packagePriceC1) * p.AMT
            reply("sbp", { gcu: { C1: state.coins, C2: 5 } })
        }
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    loadModule("plugins/buyTools.js", { bot, parentPort, items: { units, packages }, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [...new Set(castles.map(([kingdom]) => kingdom))].map(KID => ({ KID, AI: castles.filter(([k]) => k == KID).map(([, id, , type = KID == 0 ? 1 : 12]) => ({ AI: [type, 100 + id, 100, id, 0, 0, 0, 0, 0, 0, "Castle"] })) })) }, 0)
    bot.xtHandler.emit("gcu", { C1: coins, C2: 5 }, 0)
    bot.xtHandler.emit("sei", { E: [{ EID: 27, PIDS: live }, { EID: 72 }] }, 0)
    for (const movement of movements)
        bot.xtHandler.emit("gam", movement, 0)
    const buys = () => bot.sent.filter(([cmd]) => cmd == "sbp").map(([, p]) => p)
    return { bot, buys, status: () => reports.at(-1), logs, state }
}

const order = (PID, AMT, KID = 0) => ({ PID, BT: 0, TID: 27, AMT, KID, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 })
const castleRow = (tool, stock, id = 10, kingdom = 0) => ({ castle: { kingdom, id }, tool, stock })
const ladders = (stock, id = 10, kingdom = 0) => [castleRow(614, stock, id, kingdom)]

describe("the catalog entry", () => {
    test("is accepted by the API", () => {
        const { mod } = loadModule("plugins/buyTools.js", { mainThread: true })
        const entry = { key: "buyTools", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions, checks: mod.checks }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["targets", "margin", "coinFloor", "spendCap", "burnOverflow", "overflowThreshold", "dryRunOrders"])
        expect(mod.pluginOptions[0].columns.map(c => c.key)).toEqual(["castle", "tool", "stock"])
    })

    test("the overflow burn is off by default and the margin is 4,000", () => {
        const { mod } = loadModule("plugins/buyTools.js", { mainThread: true })
        const byKey = Object.fromEntries(mod.pluginOptions.map(o => [o.key, o]))
        expect(byKey.burnOverflow.default).toBe(false)
        expect(byKey.margin.default).toBe(4000)
        expect(byKey.overflowThreshold.default).toBeLessThan(2_147_483_647)
    })

    test.each(["buyTools", "castle", "stock", "margin", "coinFloor", "spendCap", "burnOverflow", "overflowThreshold", "dryRunSbp", "buyToolsRefused", "buyToolsNotArrived", "coinsBurned", "buyTools.targets.stock.column"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoTargets", "NoAnswer", "NoCastle", "NotArrived", "NoOffer", "CoinFloor", "CapReached", "StorageFull", "Refused", "TargetsMet", "Bought"])
            expect(en[`statusBuyTools${key}`]).toEqual(expect.any(String))
    })
})

describe("buying the deficit", () => {
    test("buys what is missing plus the margin, not before its first check a few minutes after login", async () => {
        const { buys } = run({ options: { targets: ladders(1000) }, castles: [[0, 10, { 614: 600 }]] })
        await vi.advanceTimersByTimeAsync(3 * MINUTE)
        expect(buys()).toEqual([])
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 400 + 4000)])
    })

    test("a margin of zero buys just the deficit", async () => {
        const { buys } = run({ options: { targets: ladders(1000), margin: 0 }, castles: [[0, 10, { 614: 600 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 400)])
    })

    test("buys nothing when the stock is at the target, margin or not", async () => {
        const { buys, status } = run({ options: { targets: ladders(1000) }, castles: [[0, 10, { 614: 1000 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsTargetsMet" })
    })

    test("counts tools travelling with an attack toward the target", async () => {
        const march = { M: [{ M: { MID: 5, T: 0, KID: 0, OID: 7, SID: 7, TID: 3, TT: 36_000, PT: 0, TA: [1, 0, 0, 99, 0, 0, 0, 0, 0, 0, "Camp"], SA: [1, 0, 0, 10, 0, 0, 0, 0, 0, 0, "Keep"] }, GA: { L: [[614, 300]], M: [], R: [], RW: [] } }], O: [] }
        const { bot, buys } = run({ options: { targets: ladders(1000) }, castles: [[0, 10, { 614: 500 }]], movements: [march] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 200 + 4000)])
        expect(bot.sent.map(([cmd]) => cmd)).toContain("dcl")
    })

    test("buys nothing above the minimum either", async () => {
        const { buys } = run({ options: { targets: ladders(1000) }, castles: [[0, 10, { 614: 5000 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
    })

    test("each row counts only its own castle's stock, though two castles share a kingdom", async () => {
        const { buys } = run({
            options: { targets: [...ladders(100, 10), ...ladders(100, 11), ...ladders(100, 20, 1)], margin: 0 },
            castles: [[0, 10, { 614: 100 }], [0, 11, { 614: 30 }, 4], [1, 20, { 614: 30 }]],
        })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 70, 0), order(LADDER, 70, 1)])
    })

    test("a castle in another kingdom's stock does not fill this castle's minimum", async () => {
        const { buys } = run({ options: { targets: ladders(100), margin: 0 }, castles: [[0, 10, { 614: 10 }], [1, 20, { 614: 5000 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 90, 0)])
    })

    test("sends the kingdom and leaves the castle field at -1, as the client does for tools", async () => {
        const { buys } = run({ options: { targets: ladders(100, 20, 1), margin: 0 }, castles: [[1, 20, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 100, 1)])
        expect(buys()[0].AID).toBe(-1)
    })

    test("checks again about an hour after the last check", async () => {
        const { bot } = run({ options: { targets: ladders(1000), margin: 0 }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        const first = bot.sent.filter(([cmd]) => cmd == "dcl").length
        await vi.advanceTimersByTimeAsync(40 * MINUTE)
        expect(bot.sent.filter(([cmd]) => cmd == "dcl")).toHaveLength(first)
        await vi.advanceTimersByTimeAsync(40 * MINUTE)
        expect(bot.sent.filter(([cmd]) => cmd == "dcl")).toHaveLength(first + 1)
    })
})

describe("only what the armourer sells", () => {
    test("a tool whose package isn't in the live offers is not bought, and the status says so", async () => {
        const { buys, status } = run({ options: { targets: ladders(1000) }, live: [RAM] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsNoOffer", params: { tool: "Ladder" } })
    })

    test("a package that exists but is not listed is not used", async () => {
        const { buys } = run({ options: { targets: [{ kingdom: 0, tool: 637, stock: 100 }] }, live: [] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
    })

    test("with two live packages for a tool, buys the cheaper", async () => {
        const { buys } = run({ options: { targets: [{ kingdom: 0, tool: 637, stock: 100 }], margin: 0 }, live: [ROCKS, ROCKS_DISCOUNT] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(ROCKS_DISCOUNT, 100)])
    })

    test("takes the live list from the latest sei, in either of the shapes the game may use", async () => {
        const { bot, buys } = run({ options: { targets: ladders(10), margin: 0 }, live: [] })
        bot.xtHandler.emit("sei", { E: [{ EID: 27, PIDS: "30,28" }] }, 0)
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 10)])
    })
})

describe("spending limits", () => {
    test("never takes coins under the floor", async () => {
        const { buys, state } = run({ options: { targets: ladders(100_000), coinFloor: 90_000 }, coins: 100_000 })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, Math.floor(10_000 / LADDER_PRICE))])
        expect(state.coins).toBeGreaterThanOrEqual(90_000)
    })

    test("buys nothing when the coins are at the floor, and says so", async () => {
        const { buys, status } = run({ options: { targets: ladders(1000), coinFloor: 100_000 }, coins: 100_000 })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsCoinFloor" })
    })

    test("a run spends no more than the cap, across all its targets", async () => {
        const { buys, status } = run({
            options: { targets: [...ladders(100_000), { kingdom: 0, tool: 611, stock: 100_000 }], spendCap: 5000 },
            coins: 10_000_000,
        })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, Math.floor(5000 / LADDER_PRICE))])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusBuyToolsBought" })
    })

    test("a refusal for lack of storage is reported and the next target is still tried", async () => {
        const { buys, status } = run({
            options: { targets: [...ladders(100), { kingdom: 0, tool: 611, stock: 100 }], margin: 0 },
            refuse: p => p.PID == LADDER ? 154 : 0,
        })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys().map(p => p.PID)).toEqual([LADDER, RAM])
        expect(status()).toMatchObject({ state: "running" })
    })
})

describe("the coin overflow burn", () => {
    const rich = { targets: ladders(1000), burnOverflow: true, overflowThreshold: 2_000_000 }

    test("spends the coins above the threshold on the targeted tool when switched on", async () => {
        const { buys, state } = run({ options: rich, coins: 3_000_000, castles: [[0, 10, { 614: 5000 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, Math.floor(1_000_000 / LADDER_PRICE))])
        expect(state.coins).toBeGreaterThanOrEqual(2_000_000)
        expect(state.coins).toBeLessThan(2_000_000 + LADDER_PRICE)
    })

    test("does nothing while it is off, however many coins there are", async () => {
        const { buys } = run({ options: { ...rich, burnOverflow: false }, coins: 3_000_000_000, castles: [[0, 10, { 614: 5000 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
    })

    test("does nothing at or below the threshold", async () => {
        const { buys } = run({ options: rich, coins: 2_000_000, castles: [[0, 10, { 614: 5000 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
    })

    test("stops at the first refusal and doesn't count the refused coins as spent", async () => {
        const { buys, logs, status } = run({ options: rich, coins: 3_000_000, castles: [[0, 10, { 614: 5000 }]], refuse: () => 154 })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toHaveLength(1)
        expect(logs.map(([key]) => key)).not.toContain("coinsBurned")
        expect(status()).toMatchObject({ state: "waiting" })
    })

    test("has nothing to buy without a target", async () => {
        const { buys } = run({ options: { ...rich, targets: [] }, coins: 3_000_000 })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
    })
})

describe("dry run", () => {
    test("logs the purchase it would make and sends none", async () => {
        const { buys, logs } = run({ options: { targets: ladders(1000), margin: 0, dryRunOrders: true } })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(logs.map(([key, json]) => [key, JSON.parse(json)])).toEqual([["dryRunSbp", order(LADDER, 1000)]])
    })

    test("also keeps the overflow burn from sending", async () => {
        const { buys, logs } = run({ options: { targets: ladders(10), burnOverflow: true, overflowThreshold: 2_000_000, dryRunOrders: true }, coins: 2_500_000 })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(logs.some(([key]) => key == "dryRunSbp")).toBe(true)
    })
})

describe("the status", () => {
    test("says so when no target is set", async () => {
        const { buys, status } = run({ options: { targets: [] } })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsNoTargets" })
    })

    test("reports what a run bought and what it cost", async () => {
        const { status } = run({ options: { targets: ladders(100), margin: 0 }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusBuyToolsBought", params: { tools: 100, coins: 100 * LADDER_PRICE } })
    })
})

test("unload stops it", async () => {
    const { bot, buys } = run({ options: { targets: ladders(1000), margin: 0 } })
    await vi.advanceTimersByTimeAsync(15 * MINUTE)
    expect(buys()).toHaveLength(1)
    bot.events.emit("unload")
    await vi.advanceTimersByTimeAsync(5 * 60 * MINUTE)
    expect(buys()).toHaveLength(1)
})

describe("a row with no stock", () => {
    test.each([[0], [undefined], [-5]])("a stock of %s buys nothing and the status says no targets", async stock => {
        const { buys, status } = run({ options: { targets: [castleRow(614, stock)] }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsNoTargets" })
    })

    test("a row without a stock is skipped while the next row buys", async () => {
        const { buys } = run({ options: { targets: [castleRow(614, 0), castleRow(611, 50)], margin: 0 }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(RAM, 50)])
    })

    test("with dry run it logs nothing for it either", async () => {
        const { buys, logs } = run({ options: { targets: [castleRow(614, 0)], dryRunOrders: true }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(logs.some(([key]) => key == "dryRunSbp")).toBe(false)
    })
})

describe("with dry run, per castle", () => {
    test("logs the shortfall of the castle below its minimum, sends nothing, and leaves a met castle alone", async () => {
        const { buys, logs } = run({
            options: { targets: [...ladders(1000, 10), ...ladders(1000, 11)], margin: 0, dryRunOrders: true },
            castles: [[0, 10, { 614: 1000 }], [0, 11, { 614: 400 }, 4]],
        })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(logs.map(([key, json]) => [key, JSON.parse(json)])).toEqual([["dryRunSbp", order(LADDER, 600)]])
    })
})

describe("rows stored before castles", () => {
    test("a kingdom row reads as that kingdom's main castle", async () => {
        const { buys } = run({
            options: { targets: [{ kingdom: 1, tool: 614, stock: 100 }], margin: 0 },
            castles: [[0, 10, { 614: 0 }], [1, 20, { 614: 0 }, 4], [1, 21, { 614: 30 }]],
        })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 70, 1)])
    })

    test("the main castle marker finds the main castle in its kingdom", async () => {
        const { buys } = run({ options: { targets: [{ castle: { kingdom: 0, id: -1 }, tool: 614, stock: 100 }], margin: 0 }, castles: [[0, 10, { 614: 40 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 60, 0)])
    })

    test("a stored row with neither castle nor kingdom buys nothing", async () => {
        const { buys } = run({ options: { targets: [{ tool: 614, stock: 100 }] }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
    })
})

describe("a castle the game may not deliver to", () => {
    test("a castle that is not on the account is reported and not bought for", async () => {
        const { buys, status } = run({ options: { targets: ladders(100, 99) }, castles: [[0, 10, {}]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsNoCastle" })
    })

    test("an outpost whose purchase never shows up there is bought for once, then left", async () => {
        const { buys, status, logs } = run({ options: { targets: ladders(1000, 11), margin: 0 }, castles: [[0, 10, {}], [0, 11, { 614: 600 }, 4]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toEqual([order(LADDER, 400)])
        await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE)
        expect(buys()).toHaveLength(1)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusBuyToolsNotArrived" })
    })

    test("the main castle is bought for again on the next check while it is still short", async () => {
        const { buys } = run({ options: { targets: ladders(1000), margin: 0 }, castles: [[0, 10, { 614: 600 }]] })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE)
        expect(buys().length).toBeGreaterThan(1)
    })

    test("an outpost keeps being bought for when its stock does rise", async () => {
        const castles = [[0, 10, {}], [0, 11, { 614: 600 }, 4]]
        const { buys } = run({ options: { targets: ladders(1000, 11), margin: 0 }, castles })
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(buys()).toHaveLength(1)
        castles[1][2][614] = 800
        await vi.advanceTimersByTimeAsync(2 * 60 * MINUTE)
        expect(buys()).toHaveLength(2)
        expect(buys()[1]).toEqual(order(LADDER, 200, 0))
    })
})
