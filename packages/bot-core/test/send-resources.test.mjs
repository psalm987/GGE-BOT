import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus, PluginMemory } = require("../actions.json")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const SECOND = 1000, MINUTE = 60 * SECOND
const ME = 7
const WOOD = 0, STONE = 1, FOOD = 2
const horses = [
    { wodID: 1, costFactorC1: 1, costFactorC2: 0, marketBoost: 20 },
    { wodID: 2, costFactorC1: 2, costFactorC2: 0, marketBoost: 50 },
    { wodID: 3, costFactorC1: 0, costFactorC2: 5, marketBoost: 100 },
]

/** The account's castles, `[kingdom, id, area type, x, y]`, and what else stands on the map. */
const CASTLES = [[0, 10, 1, 110, 100], [0, 11, 4, 300, 300], [1, 20, 12, 500, 500]]
const STRANGERS = [[2, 600, 600, 99]]

const send = (extra = {}) => ({ castle: { kingdom: 0, id: 10 }, targetX: 300, targetY: 300, cartResource: WOOD, cartTotal: 100_000, keep: 0, ...extra })

/**
 * The plugin against a game that carries `capacity` per cart. Each castle's market starts as `market` says (by castle
 * id) and loses the goods and carts each crm takes; a crm that needs more carts than are free is refused with 61. The
 * carts reach their target after `travel` seconds, the game then pushes the way back (unless `noWayBack`), and they are
 * free again after as long once more. `memory` is the plugin memory the runner hands a new run. `onSend(cmd, bot)` runs as
 * each request goes out.
 */
function run({ options = {}, market = {}, capacity = 100, travel = 600, noWayBack = false, memory, onCrm = () => 0, onSend = () => {} } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.sendResources = { state: true, ...options }
    if (memory)
        bot.botConfig.pluginMemory = memory
    const markets = new Map(CASTLES.map(([, id]) => [id, { CID: id, TC: 10, AC: 10, W: 50_000, S: 50_000, F: 50_000, AE: [], ...market[id] }]))
    const reports = [], kept = [], logs = []
    const reply = (cmd, body, result = 0, ms = 100) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), ms)
    const area = ([type, x, y, id]) => [type, x, y, id, ME, 0, 0, 0, 0, 0, "Castle"]
    let mid = 100
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p, Date.now()])
        onSend(cmd, bot)
        if (cmd == "cmi")
            reply("cmi", { C: [...markets.values()].map(m => ({ ...m })) })
        if (cmd == "jca")
            reply("jaa", { KID: p.KID, grc: { KID: p.KID, AID: p.CID }, gca: { BD: [], scl: { OIDL: [] } }, gpa: {} })
        if (cmd == "gaa") {
            const inBox = ([, x, y]) => x >= p.AX1 && x <= p.AX2 && y >= p.AY1 && y <= p.AY2
            const own = CASTLES.filter(([k]) => k == p.KID).map(([, id, type, x, y]) => [type, x, y, id])
            reply("gaa", { KID: p.KID, AI: [...own, ...STRANGERS].filter(inBox).map(area), OI: [] })
        }
        if (cmd == "crm") {
            const m = markets.get(p.SID)
            const [[code, amount]] = p.G
            const carts = Math.ceil(amount / capacity)
            const code_ = onCrm(p) || (carts > m.AC || amount > m[code] ? 61 : 0)
            if (code_ != 0)
                return reply("crm", {}, code_)
            m.AC -= carts
            m[code] -= amount
            const id = ++mid
            const source = CASTLES.find(([, c]) => c == p.SID)
            const target = CASTLES.find(([, , , x, y]) => x == p.TX && y == p.TY) ?? [p.KID, -1, 1, p.TX, p.TY]
            const movement = (D, from, to) => ({ A: { M: { MID: id, T: 4, KID: p.KID, OID: ME, SID: ME, TID: ME, TT: travel, PT: 0, D, SA: [from[2], from[3], from[4], from[1]], TA: [to[2], to[3], to[4], to[1]] }, MM: { C: carts, G: p.G } }, O: [] })
            reply("crm", movement(0, source, target))
            setTimeout(() => {
                if (!noWayBack)
                    bot.xtHandler.emit("crm", movement(1, target, source), 0)
                setTimeout(() => { m.AC += carts }, travel * SECOND)
            }, travel * SECOND)
        }
    }
    const parentPort = {
        postMessage: message => {
            if (message[0] == PluginStatus)
                reports.push(message[1])
            if (message[0] == PluginMemory)
                kept.push(message[1])
        },
        on() {},
    }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "debug").mockImplementation(() => {})
    loadModule("plugins/sendResources.js", { bot, parentPort, items: { horses }, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [...new Set(CASTLES.map(([k]) => k))].map(KID => ({ KID, AI: CASTLES.filter(([k]) => k == KID).map(([, id, type, x, y]) => ({ AI: area([type, x, y, id]) })) })) }, 0)
    bot.xtHandler.emit("gpc", { A: CASTLES.map(([KID, AID]) => ({ AID, KID, UH: AID == 10 ? [1, 2, 3] : [] })) }, 0)
    const crms = () => bot.sent.filter(([cmd]) => cmd == "crm")
    return {
        bot, markets, logs, kept,
        crms: () => crms().map(([, p]) => p),
        amounts: () => crms().map(([, p]) => p.G[0][1]),
        times: () => crms().map(([, , at]) => at),
        sentCmds: () => bot.sent.map(([cmd]) => cmd),
        status: () => reports.at(-1),
        /** The memory the runner would hand the next run, built from what this one kept. */
        memory: () => ({ sendResources: Object.fromEntries(kept.map(({ key, value }) => [key, value])) }),
    }
}

describe("the catalog entry", () => {
    test("is accepted by the API, with a row per send and a resource choice", () => {
        const { mod } = loadModule("plugins/sendResources.js", { mainThread: true })
        const entry = { key: "sendResources", force: false, hidden: false, options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["cartSends", "cartCoinHorse", "dryRunCarts"])
        expect(mod.pluginOptions[0].columns.map(c => c.key)).toEqual(["castle", "targetX", "targetY", "cartResource", "cartTotal", "keep"])
        expect(mod.pluginOptions[0].columns[3].selection).toEqual(["cartWood", "cartStone", "cartFood"])
    })

    test.each(["sendResources", "sendResources.description", "cartSends", "cartCoinHorse", "dryRunCarts", "targetX", "targetY", "cartResource", "cartTotal",
        "cartWood", "cartStone", "cartFood", "sendResources.cartSends.keep.column", "dryRunCrm", "sendResourcesSent", "sendResourcesRefused", "sendResourcesDuplicateRow"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoRows", "BadRow", "NoCastle", "NoMarket", "WrongTarget", "Refused", "Short", "NoCarts", "NoAnswer", "OnTheWay", "Sent", "RowDone", "AllDone", "DryRun"])
            expect(en[`statusSendResources${key}`]).toEqual(expect.any(String))
    })
})

describe("sending", () => {
    test("fills every free cart from the row's castle, joined first, after checking the target, riding the fastest coin horse", async () => {
        const { crms, sentCmds, status } = run({ options: { cartSends: [send()] } })
        await vi.advanceTimersByTimeAsync(MINUTE)
        expect(crms()).toEqual([])
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(crms()).toEqual([{ KID: 0, SID: 10, TX: 300, TY: 300, HBW: 2, PTT: 0, SD: 0, G: [["W", 1000]] }])
        const cmds = sentCmds()
        expect(cmds.indexOf("cmi")).toBeLessThan(cmds.indexOf("gaa"))
        expect(cmds.indexOf("gaa")).toBeLessThan(cmds.indexOf("jca"))
        expect(cmds.indexOf("jca")).toBeLessThan(cmds.indexOf("crm"))
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusSendResourcesSent", params: { amount: 1000, target: "300:300", sent: 1000, total: 100_000 } })
    })

    test("sends the resource each row picks, without a horse when the coin horse is off, and two rows of one castle share its carts", async () => {
        const { crms, status } = run({ options: { cartSends: [send({ cartResource: STONE }), send({ cartResource: FOOD })], cartCoinHorse: false }, capacity: 200 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms().map(p => [p.HBW, p.G])).toEqual([[-1, [["S", 1000]]], [-1, [["F", 1000]]]])
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesSent", params: { amount: 1000, sent: 1000 } })
    })

    test("the last load is only what is still missing from the total", async () => {
        const { amounts } = run({ options: { cartSends: [send({ cartTotal: 700 })] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(amounts()).toEqual([700])
    })
})

describe("cart capacity", () => {
    test("starts from 100 per cart plus the capacity boost, effect 90", async () => {
        const { amounts } = run({ options: { cartSends: [send()] }, market: { 10: { AE: [[90, [50]]] } }, capacity: 150 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(amounts()).toEqual([1500])
    })

    test("learns the load per cart from the carts the game used", async () => {
        const { amounts } = run({ options: { cartSends: [send()] }, capacity: 300 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(amounts()).toEqual([1000])
        await vi.advanceTimersByTimeAsync(25 * MINUTE)
        expect(amounts()).toEqual([1000, 2500])
    })

    test("after a load that fills every cart, tries one more per cart, and a refusal of that try settles the capacity", async () => {
        const { amounts, status } = run({ options: { cartSends: [send()] }, capacity: 100 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(amounts()).toEqual([1000])
        await vi.advanceTimersByTimeAsync(25 * MINUTE)
        expect(amounts()).toEqual([1000, 1010, 1000])
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesSent", params: { sent: 2000 } })
        await vi.advanceTimersByTimeAsync(25 * MINUTE)
        expect(amounts()).toEqual([1000, 1010, 1000, 1000])
    })

    test("a try that the game takes raises the capacity, and the next load tries one more again", async () => {
        const { amounts } = run({ options: { cartSends: [send()] }, capacity: 120 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        await vi.advanceTimersByTimeAsync(70 * MINUTE)
        expect(amounts()).toEqual([1000, 1120, 1130, 1140])
    })
})

describe("carts coming home", () => {
    test("sends the next load 10 seconds after the carts are home, as the way back the game pushes says", async () => {
        const { times } = run({ options: { cartSends: [send()] }, capacity: 200, travel: 600 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(times()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(21 * MINUTE)
        expect(times()).toHaveLength(2)
        const gap = times()[1] - times()[0]
        expect(gap).toBeGreaterThanOrEqual(1210 * SECOND)
        expect(gap).toBeLessThan(1212 * SECOND)
    })

    test("without the way back, sends again after twice the way there and a minute more", async () => {
        const { times } = run({ options: { cartSends: [send()] }, capacity: 200, travel: 600, noWayBack: true })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        await vi.advanceTimersByTimeAsync(22 * MINUTE)
        expect(times()).toHaveLength(2)
        const gap = times()[1] - times()[0]
        expect(gap).toBeGreaterThanOrEqual(1260 * SECOND)
        expect(gap).toBeLessThan(1262 * SECOND)
    })

    test("a settings change while the carts are out says they are on the way", async () => {
        const { bot, times, status } = run({ options: { cartSends: [send()] }, capacity: 200, travel: 600 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        bot.events.emit("configModified")
        await vi.advanceTimersByTimeAsync(15 * SECOND)
        expect(times()).toHaveLength(1)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusSendResourcesOnTheWay", params: { target: "300:300", sent: 1000, total: 100_000 } })
    })

    test("with no cart free, asks again a minute later", async () => {
        const { crms, status, markets, sentCmds } = run({ options: { cartSends: [send()] }, market: { 10: { AC: 0 } } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesNoCarts" })
        const asked = sentCmds().filter(cmd => cmd == "cmi").length
        markets.get(10).AC = 10
        await vi.advanceTimersByTimeAsync(MINUTE + 5 * SECOND)
        expect(sentCmds().filter(cmd => cmd == "cmi").length).toBe(asked + 1)
        expect(crms()).toHaveLength(1)
    })
})

describe("what a castle keeps", () => {
    test("a castle short of a full load above what it keeps sends nothing, says so, and looks again 10 minutes later", async () => {
        const { crms, status, markets } = run({ options: { cartSends: [send({ keep: 5000 })] }, market: { 10: { W: 5500 } } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusSendResourcesShort", params: { target: "300:300" } })
        markets.get(10).W = 6000
        await vi.advanceTimersByTimeAsync(6 * MINUTE)
        expect(crms()).toEqual([])
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(crms().map(p => p.G)).toEqual([[["W", 1000]]])
    })
})

describe("what stops a row", () => {
    test("a castle without a marketplace sends nothing and says so", async () => {
        const { crms, status } = run({ options: { cartSends: [send()] }, market: { 10: { TC: 0, AC: 0 } } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusSendResourcesNoMarket" })
    })

    test("a target that isn't a castle that takes resources is never sent to", async () => {
        const { crms, status } = run({ options: { cartSends: [send({ targetX: 600, targetY: 600 })] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesWrongTarget", params: { target: "600:600" } })
    })

    test("a castle that isn't on the account says so", async () => {
        const { crms, status } = run({ options: { cartSends: [send({ castle: { kingdom: 0, id: 99 } })] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesNoCastle" })
    })

    test("a refused send is reported and tried again 10 minutes later", async () => {
        let refuse = true
        const { crms, status } = run({ options: { cartSends: [send()] }, onCrm: () => refuse ? 5 : 0 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toHaveLength(1)
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesRefused" })
        refuse = false
        await vi.advanceTimersByTimeAsync(11 * MINUTE)
        expect(crms()).toHaveLength(2)
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesSent" })
    })

    test("a second row from the same castle to the same place with the same resource is left out and reported", async () => {
        const { crms, logs } = run({ options: { cartSends: [send(), send({ cartTotal: 5 })] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toHaveLength(1)
        expect(logs.some(([key]) => key == "sendResourcesDuplicateRow")).toBe(true)
    })

    test("with no rows, says how to add one", async () => {
        const { status } = run()
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusSendResourcesNoRows" })
    })
})

describe("the total", () => {
    test("a row that has sent its total is done: no more carts go, the status says so, and the saved row is left as the player set it", async () => {
        const options = { cartSends: [send({ cartTotal: 2000 })] }
        const saved = structuredClone(options)
        const { amounts, status, kept } = run({ options, capacity: 200 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        await vi.advanceTimersByTimeAsync(30 * MINUTE)
        expect(amounts()).toEqual([1000, 1000])
        expect(status()).toMatchObject({ reasonKey: "statusSendResourcesAllDone", params: { rows: 1 } })
        await vi.advanceTimersByTimeAsync(60 * MINUTE)
        expect(amounts()).toEqual([1000, 1000])
        expect(options).toEqual(saved)
        expect(kept.at(-1).key).toBe("sent")
    })

    test("what was sent outlives a restart through the plugin's memory, so the next run sends only the rest", async () => {
        const options = { cartSends: [send({ cartTotal: 1500 })] }
        const first = run({ options: structuredClone(options), capacity: 200 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(first.amounts()).toEqual([1000])
        vi.useRealTimers()

        const second = run({ options: structuredClone(options), capacity: 200, memory: first.memory() })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(second.amounts()).toEqual([500])
        expect(second.status()).toMatchObject({ reasonKey: "statusSendResourcesAllDone" })
    })

    test("a row taken off the plan forgets what it sent, so adding it again starts from nothing", async () => {
        const { bot, amounts, memory } = run({ options: { cartSends: [send({ cartTotal: 1500 })] }, capacity: 200 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(amounts()).toEqual([1000])
        bot.botConfig.plugins.sendResources.cartSends = []
        bot.events.emit("configModified")
        await vi.advanceTimersByTimeAsync(MINUTE)
        expect(memory()).toEqual({ sendResources: { sent: {} } })
    })
})

describe("dry runs and army starts", () => {
    test("a dry run logs the send it would make, sends nothing and counts nothing", async () => {
        const { crms, logs, status, kept } = run({ options: { cartSends: [send()], dryRunCarts: true } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(crms()).toEqual([])
        expect(logs).toContainEqual(["dryRunCrm", JSON.stringify({ KID: 0, SID: 10, TX: 300, TY: 300, HBW: 2, PTT: 0, SD: 0, G: [["W", 1000]] })])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusSendResourcesDryRun", params: { amount: 1000, target: "300:300" } })
        expect(kept).toEqual([])
    })

    test("carts leave at least 5 seconds after an army the account just started", async () => {
        const at = {}
        const attack = (cmd, bot) => {
            if (cmd != "gaa")
                return
            at.attack = Date.now()
            bot.xtHandler.emit("cra", { AAM: { M: { MID: 1, T: 0, KID: 0, OID: ME, SID: ME, TID: 3, TT: 60, PT: 0, TA: [2, 0, 0, 1], SA: [1, 110, 100, 10] } }, O: [] }, 0)
        }
        const { times } = run({ options: { cartSends: [send()] }, onSend: attack })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(times()).toHaveLength(1)
        expect(times()[0] - at.attack).toBeGreaterThanOrEqual(5 * SECOND)
        expect(times()[0] - at.attack).toBeLessThanOrEqual(11 * SECOND)
    })
})
