import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const SECOND = 1000, MINUTE = 60 * SECOND
const SPEAR = 1, BOW = 2, LADDER = 614
const units = [
    { wodID: SPEAR, type: "Spearman", role: "melee" },
    { wodID: BOW, type: "Bowman", role: "ranged" },
    { wodID: LADDER, type: "Ladder", name: "Workshop" },
]
const currencies = [{ JSONKey: "MS4", Name: "30MinSkip" }, { JSONKey: "MS5", Name: "60MinSkip" }]

/** The account's castles: `[kingdom, id, area type, { wodID: amount }]`. Kingdom castles by default, plus an outpost and Berimond. */
const WORLD = [
    [0, 10, 1, { [SPEAR]: 5000, [LADDER]: 900 }],
    [0, 11, 4, { [SPEAR]: 90_000 }],
    [1, 20, 12, { [SPEAR]: 100, [LADDER]: 0 }],
    [2, 30, 12, { [SPEAR]: 4000 }],
    [3, 40, 12, { [SPEAR]: 0 }],
    [10, 50, 15, { [SPEAR]: 9000 }],
]

const troopRule = (toKingdom, fromKingdom, below, upTo, extra = {}) => ({ toKingdom, fromKingdom, troop: SPEAR, below, upTo, ...extra })

/**
 * The plugin against a game holding `world`. `kut` is answered with `onKut(params)`'s code (0 by default) and, on 0, a
 * kpi whose transfer into the target takes `transferSeconds`. `msk` is answered with `onSkip(params)`'s code and a kpi
 * with no transfer left. `inFlight` is the kpi's UT at login.
 */
function run({ options = {}, world = WORLD, inFlight = [], movements = [], onKut = () => 0, onSkip = () => 0, transferSeconds = 3600, skips = {}, onDcl } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.troopTransfer = { state: true, ...options }
    bot.botConfig.plugins.skips = { "30Minute": true, "1Hour": true }
    const reports = [], logs = [], at = {}
    const reply = (cmd, body, result = 0, ms = 100) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), ms)
    const dclFrame = () => ({ C: [...new Set(world.map(([k]) => k))].map(KID => ({ KID, AI: world.filter(([k]) => k == KID).map(([, AID, , inv]) => ({ AID, AC: Object.entries(inv).map(([id, n]) => [Number(id), n]) })) })) })
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p, Date.now()])
        if (cmd == "dcl") {
            onDcl?.(bot)
            reply("dcl", dclFrame())
        }
        if (cmd == "kut") {
            const code = onKut(p)
            reply("kut", code == 0 ? { kpi: { UT: [{ KID: p.TKID, RS: transferSeconds, I: p.A }] } } : {}, code)
        }
        if (cmd == "msk") {
            const code = onSkip(p)
            reply("msk", code == 0 ? { kpi: {} } : {}, code)
        }
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "debug").mockImplementation(() => {})
    loadModule("plugins/troopTransfer.js", { bot, parentPort, items: { units, currencies }, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [...new Set(world.map(([k]) => k))].map(KID => ({ KID, AI: world.filter(([k]) => k == KID).map(([, id, type]) => ({ AI: [type, 100 + id, 100, id, 7, 0, 0, 0, 0, 0, "Castle"] })) })) }, 0)
    bot.xtHandler.emit("dcl", dclFrame(), 0)
    bot.xtHandler.emit("kpi", { UL: [], UT: inFlight }, 0)
    bot.xtHandler.emit("sce", Object.entries({ MS4: 0, MS5: 0, ...skips }), 0)
    for (const movement of movements)
        bot.xtHandler.emit("gam", movement, 0)
    const sentOf = cmd => bot.sent.filter(([c]) => c == cmd)
    return { bot, kuts: () => sentOf("kut").map(([, p]) => p), kutTimes: () => sentOf("kut").map(([, , t]) => t), skipsSent: () => sentOf("msk").map(([, p]) => p), rounds: () => sentOf("dcl").length, status: () => reports.at(-1), logs, at }
}

const kut = (SCID, SKID, TKID, A) => ({ SCID, SKID, TKID, CID: -1, A })

describe("the catalog entry", () => {
    test("is accepted by the API", () => {
        const { mod } = loadModule("plugins/troopTransfer.js", { mainThread: true })
        const entry = { key: "troopTransfer", force: false, hidden: false, options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["troopRules", "toolRules", "useTimeSkips", "dryRunTransfers"])
        expect(mod.pluginOptions[0].columns.map(c => c.key)).toEqual(["toKingdom", "fromKingdom", "troop", "below", "upTo", "senderKeep"])
        expect(mod.pluginOptions[1].columns.map(c => c.key)).toEqual(["toKingdom", "fromKingdom", "tool", "below", "upTo", "senderKeep"])
    })

    test.each(["troopTransfer", "troopTransfer.description", "toKingdom", "fromKingdom", "below", "upTo", "senderKeep", "troopRules", "toolRules", "dryRunTransfers", "dryRunKut", "troopTransferSent", "troopTransferRefused", "troopTransferTwoSenders", "troopTransferBadRule"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoRules", "BadRule", "NoCastle", "Short", "Busy", "Refused", "TargetsMet", "Sent"])
            expect(en[`statusTroopTransfer${key}`]).toEqual(expect.any(String))
    })
})

describe("topping up", () => {
    test("sends the whole top-up from the sender's kingdom castle a few minutes after login, as a kut the client sends", async () => {
        const { kuts, status, rounds } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] } })
        await vi.advanceTimersByTimeAsync(1 * MINUTE)
        expect(rounds()).toBe(0)
        await vi.advanceTimersByTimeAsync(9 * MINUTE)
        expect(kuts()).toEqual([kut(10, 0, 1, [[SPEAR, 900]])])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusTroopTransferSent" })
    })

    test("sends nothing while the target is at or above its floor", async () => {
        const { kuts, status } = run({ options: { troopRules: [troopRule(1, 0, 100, 1000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusTroopTransferTargetsMet" })
    })

    test("counts the target's own troops that are out and coming home", async () => {
        const home = { M: [{ M: { MID: 5, T: 0, KID: 1, OID: 7, SID: 7, TID: 7, TT: 3600, PT: 0, TA: [12, 120, 100, 20, 7], SA: [2, 0, 0, 99, 0] }, GA: { L: [[SPEAR, 450]], M: [], R: [], RW: [] } }], O: [] }
        const { kuts } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] }, movements: [home] })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
    })

    test("counts troops already on their way into the target's kingdom", async () => {
        const { kuts, skipsSent } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)], useTimeSkips: true }, inFlight: [{ KID: 1, RS: 1200, I: [[SPEAR, 800]] }], skips: { MS4: 5 } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(skipsSent()).toEqual([])
    })

    test("never sends part of a top-up: a sender short of the whole amount waits and says so", async () => {
        const { kuts, status } = run({ options: { troopRules: [troopRule(1, 0, 500, 6000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusTroopTransferShort", params: { item: "Spearman" } })
    })

    test("the sender keeps what its row says to keep", async () => {
        const { kuts, status } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000, { senderKeep: 4500 })] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusTroopTransferShort" })
    })

    test("a troop and a tool for the same target go in one transfer", async () => {
        const { kuts } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)], toolRules: [{ toKingdom: 1, fromKingdom: 0, tool: LADDER, below: 50, upTo: 300 }] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([kut(10, 0, 1, [[SPEAR, 900], [LADDER, 300]])])
    })

    test("a sender feeding two kingdoms never counts the same troops twice", async () => {
        const { kuts } = run({ options: { troopRules: [troopRule(1, 0, 500, 3000), troopRule(3, 0, 500, 3000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([kut(10, 0, 1, [[SPEAR, 2900]])])
    })

    test("rechecks about every 30 minutes", async () => {
        const { rounds } = run({ options: { troopRules: [troopRule(1, 0, 100, 1000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(rounds()).toBe(1)
        await vi.advanceTimersByTimeAsync(18 * MINUTE)
        expect(rounds()).toBe(1)
        await vi.advanceTimersByTimeAsync(15 * MINUTE)
        expect(rounds()).toBe(2)
    })
})

describe("which castles take part", () => {
    test("only the kingdom castles: never an outpost, though it holds more", async () => {
        const { kuts } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] }, world: WORLD.map(c => c[1] == 10 ? [0, 10, 1, { [SPEAR]: 0 }] : c) })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
    })

    test("a rule into or out of Berimond is turned down", async () => {
        const { kuts, status } = run({ options: { troopRules: [troopRule(10, 0, 500, 1000), troopRule(1, 10, 500, 1000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusTroopTransferBadRule" })
    })

    test("one sender per target kingdom: a second sender's rule is left out and reported", async () => {
        const { kuts, logs } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000), troopRule(1, 2, 500, 1000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([kut(10, 0, 1, [[SPEAR, 900]])])
        expect(logs.some(([key]) => key == "troopTransferTwoSenders")).toBe(true)
    })

    test("a kingdom whose castle isn't known yet says so", async () => {
        const { kuts, status } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] }, world: WORLD.filter(c => c[0] != 1) })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusTroopTransferNoCastle" })
    })
})

describe("one transfer into a kingdom at a time", () => {
    test("waits for the transfer on its way, counting its timer down from when it was seen", async () => {
        const { kuts, status } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] }, inFlight: [{ KID: 1, RS: 15 * 60, I: [[BOW, 10]] }] })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusTroopTransferBusy" })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([kut(10, 0, 1, [[SPEAR, 900]])])
    })

    test("with time skips on, skips the transfer on its way with an msk for troops, then sends", async () => {
        const { kuts, skipsSent } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)], useTimeSkips: true }, inFlight: [{ KID: 1, RS: 25 * 60, I: [[BOW, 10]] }], skips: { MS4: 3 } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(skipsSent()).toEqual([{ MST: "MS4", KID: "1", TT: "1" }])
        expect(kuts()).toEqual([kut(10, 0, 1, [[SPEAR, 900]])])
    })

    test("without time skips, spends none", async () => {
        const { skipsSent } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] }, inFlight: [{ KID: 1, RS: 25 * 60, I: [[BOW, 10]] }], skips: { MS4: 3 } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(skipsSent()).toEqual([])
    })
})

describe("army starts", () => {
    test("a transfer waits at least 5 seconds after an attack the bot just started", async () => {
        const { kutTimes, at } = run({
            options: { troopRules: [troopRule(1, 0, 500, 1000)] },
            onDcl: bot => { at.attack = Date.now(); bot.xtHandler.emit("cra", { AAM: { M: { MID: 1, T: 0, KID: 0, OID: 7, SID: 7, TID: 3, TT: 60, PT: 0, TA: [2, 0, 0, 1], SA: [1, 0, 0, 10] } }, O: [] }, 0) },
        })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kutTimes()).toHaveLength(1)
        expect(kutTimes()[0] - at.attack).toBeGreaterThanOrEqual(5 * SECOND)
        expect(kutTimes()[0] - at.attack).toBeLessThanOrEqual(11 * SECOND)
    })

    test("two transfers in one round are 5 to 10 seconds apart", async () => {
        const { kutTimes } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000), troopRule(3, 2, 500, 1000)] } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kutTimes()).toHaveLength(2)
        expect(kutTimes()[1] - kutTimes()[0]).toBeGreaterThanOrEqual(5 * SECOND)
        expect(kutTimes()[1] - kutTimes()[0]).toBeLessThanOrEqual(11 * SECOND)
    })
})

describe("refusals and dry runs", () => {
    test("a refused transfer is reported and tried again next round", async () => {
        let refuse = true
        const { kuts, status } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)] }, onKut: () => refuse ? 61 : 0 })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toHaveLength(1)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusTroopTransferRefused" })
        refuse = false
        await vi.advanceTimersByTimeAsync(35 * MINUTE)
        expect(kuts()).toHaveLength(2)
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusTroopTransferSent" })
    })

    test("a dry run logs the transfer and sends nothing", async () => {
        const { kuts, logs, status } = run({ options: { troopRules: [troopRule(1, 0, 500, 1000)], dryRunTransfers: true } })
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(logs).toContainEqual(["dryRunKut", JSON.stringify(kut(10, 0, 1, [[SPEAR, 900]]))])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusTroopTransferSent" })
    })

    test("no rules: says how to add one and sends nothing", async () => {
        const { kuts, status } = run()
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(kuts()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusTroopTransferNoRules" })
    })
})
