import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const MINUTE = 60_000, HOUR = 60 * MINUTE
const STORAGE = { MRW: 10_000, MRS: 10_000 }

/** The account's castles: `[kingdom, id, area type, resources]`. */
const WORLD = [
    [0, 10, 1, { W: 9500, S: 9000 }],
    [1, 20, 12, { W: 9800, S: 2000 }],
    [4, 40, 12, { W: 10_000, S: 10_000 }],
]
const row = (kingdom, id, donateAt = 90, storageKeep = 50) => ({ castle: { kingdom, id }, donateAt, storageKeep })

/** The plugin against a game holding `world`. `cde` answers with `onDonate(params)`'s code. */
function run({ options = {}, world = WORLD, onDonate = () => 0 } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.colossusEventDonate = { state: true, ...options }
    const reports = [], logs = []
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const dclFrame = () => ({ C: [...new Set(world.map(([k]) => k))].map(KID => ({ KID, AI: world.filter(([k]) => k == KID).map(([, AID, , res]) => ({ AID, ...res, gpa: STORAGE })) })) })
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "dcl")
            reply("dcl", dclFrame())
        if (cmd == "cde")
            reply("cde", {}, onDonate(p))
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "debug").mockImplementation(() => {})
    loadModule("plugins/colossusEventDonate.js", { bot, parentPort, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [...new Set(world.map(([k]) => k))].map(KID => ({ KID, AI: world.filter(([k]) => k == KID).map(([, id, type]) => ({ AI: [type, 100 + id, 100, id, 7, 0, 0, 0, 0, 0, "Castle"] })) })) }, 0)
    bot.xtHandler.emit("dcl", dclFrame(), 0)
    const donations = () => bot.sent.filter(([c]) => c == "cde").map(([, p]) => p)
    return { bot, donations, status: () => reports.at(-1), logs }
}

const cde = (DW, DS, SCID, SKID) => ({ DW, DS, SCID, SKID })

describe("the catalog entry", () => {
    test("is accepted by the API", () => {
        const { mod } = loadModule("plugins/colossusEventDonate.js", { mainThread: true })
        const entry = { key: "colossusEventDonate", force: false, hidden: false, options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["colossusCastles", "dryRunDonations"])
        expect(mod.pluginOptions[0].columns.map(c => c.key)).toEqual(["castle", "donateAt", "storageKeep"])
    })

    test.each(["colossusEventDonate", "colossusEventDonate.description", "colossusCastles", "donateAt", "dryRunCde", "colossusDonated", "colossusDonationRefused"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoCastles", "NoEvent", "BelowThreshold", "Refused", "Donated"])
            expect(en[`statusColossus${key}`]).toEqual(expect.any(String))
    })
})

describe("what each castle gives", () => {
    test("once a resource reaches the threshold, gives it down to the kept share, not to 0", async () => {
        const { donations, status } = run({ options: { colossusCastles: [row(0, 10)] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([cde(4500, 4000, 10, 0)])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusColossusDonated" })
    })

    test("a resource below the threshold is not given, though the other one is", async () => {
        const { donations } = run({ options: { colossusCastles: [row(1, 20)] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([cde(4800, 0, 20, 1)])
    })

    test("a castle below its threshold gives nothing, and the status says so", async () => {
        const { donations, status } = run({ options: { colossusCastles: [row(0, 10, 99)] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusColossusBelowThreshold" })
    })

    test("only castles in the four home kingdoms give", async () => {
        const { donations } = run({ options: { colossusCastles: [row(4, 40)] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([])
    })

    test("looks again about every 10 minutes", async () => {
        const { bot } = run({ options: { colossusCastles: [row(0, 10, 99)] } })
        const looks = () => bot.sent.filter(([c]) => c == "dcl").length
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(looks()).toBe(1)
        await vi.advanceTimersByTimeAsync(6 * MINUTE)
        expect(looks()).toBe(1)
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(looks()).toBe(2)
    })
})

describe("the event", () => {
    test("209 means the event isn't running: stops the round and asks again hours later, not every 10 minutes", async () => {
        const { donations, status } = run({ options: { colossusCastles: [row(0, 10), row(1, 20)] }, onDonate: () => 209 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toHaveLength(1)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusColossusNoEvent" })
        await vi.advanceTimersByTimeAsync(3 * HOUR)
        expect(donations()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(4 * HOUR)
        expect(donations()).toHaveLength(2)
    })

    test.each([44, 57])("a Colossus event %i starting ends the wait at once", async eventID => {
        let running = false
        const { bot, donations } = run({ options: { colossusCastles: [row(0, 10)] }, onDonate: () => running ? 0 : 209 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toHaveLength(1)
        running = true
        bot.xtHandler.emit("sei", { E: [{ EID: eventID }] }, 0)
        await vi.advanceTimersByTimeAsync(12 * MINUTE)
        expect(donations()).toHaveLength(2)
    })

    test("an event id that is listed while the game still says 209 doesn't make it ask every round", async () => {
        const { bot, donations } = run({ options: { colossusCastles: [row(0, 10)] }, onDonate: () => 209 })
        bot.xtHandler.emit("sei", { E: [{ EID: 44 }] }, 0)
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(donations()).toHaveLength(1)
    })

    test("never switches itself off or rewrites the settings", async () => {
        const { bot } = run({ options: { colossusCastles: [row(0, 10)] }, onDonate: () => 209 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(bot.botConfig.plugins.colossusEventDonate.colossusCastles).toEqual([row(0, 10)])
    })
})

describe("refusals and dry runs", () => {
    test("another refusal holds that castle back an hour, and the next castle is still tried", async () => {
        const { donations, status } = run({ options: { colossusCastles: [row(0, 10), row(1, 20)] }, onDonate: p => p.SCID == 10 ? 61 : 0 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations().map(d => d.SCID)).toEqual([10, 20])
        expect(status()).toMatchObject({ state: "running" })
        await vi.advanceTimersByTimeAsync(40 * MINUTE)
        expect(donations().filter(d => d.SCID == 10)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(30 * MINUTE)
        expect(donations().filter(d => d.SCID == 10)).toHaveLength(2)
    })

    test("a dry run logs the donation and sends nothing", async () => {
        const { donations, logs } = run({ options: { colossusCastles: [row(0, 10)], dryRunDonations: true } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([])
        expect(logs).toContainEqual(["dryRunCde", JSON.stringify(cde(4500, 4000, 10, 0))])
    })

    test("no castles listed: asks the game nothing", async () => {
        const { bot, status } = run()
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(bot.sent.filter(([c]) => c == "dcl" || c == "cde")).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusColossusNoCastles" })
    })
})
