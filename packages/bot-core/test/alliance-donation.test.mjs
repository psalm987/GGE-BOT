import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const MINUTE = 60_000
const currencies = [{ JSONKey: "AC", Name: "AllianceCoin" }, { JSONKey: "RC", Name: "RiftCoin" }, { JSONKey: "LRC", Name: "LegendaryRiftCoin" }]
const STORAGE = { MRW: 10_000, MRS: 10_000, MRF: 10_000, MRI: 10_000, MRO: 10_000, MRG: 10_000, MRC: 10_000 }
const FULL = { W: 9000, S: 9000, F: 9000, I: 9000, O: 9000, G: 9000, C: 9000 }

/** The account's castles: `[kingdom, id, area type, resources]`. */
const WORLD = [
    [0, 10, 1, FULL],
    [1, 20, 12, { ...FULL, W: 5000 }],
]
const row = (kingdom, id, storageKeep = 80) => ({ castle: { kingdom, id }, storageKeep })

/**
 * The plugin against a game holding `world`, in alliance `alliance` (-1 for none). `gdr` answers with `fresh[id]` or
 * the castle's list figures. `ado` answers with `onAdo(params)`'s code.
 */
function run({ options = {}, world = WORLD, alliance = 5, fresh = {}, onAdo = () => 0, coins = {} } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.allianceDonation = { state: true, ...options }
    bot.playerInfo.alliance = { id: alliance }
    const reports = [], logs = []
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const dclFrame = () => ({ C: [...new Set(world.map(([k]) => k))].map(KID => ({ KID, AI: world.filter(([k]) => k == KID).map(([, AID, , res]) => ({ AID, ...res, gpa: STORAGE })) })) })
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "dcl")
            reply("dcl", dclFrame())
        if (cmd == "gdr") {
            const [, , , res] = world.find(([k, id]) => k == p.KID && id == p.AID)
            reply("gdr", { grc: { KID: p.KID, AID: p.AID, ...res, ...fresh[p.AID] } })
        }
        if (cmd == "ado")
            reply("ado", {}, onAdo(p))
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    loadModule("plugins/allianceDonation.js", { bot, parentPort, items: { currencies }, extra: { "./castleListRead.js": { watchCastleList() {} } } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [...new Set(world.map(([k]) => k))].map(KID => ({ KID, AI: world.filter(([k]) => k == KID).map(([, id, type]) => ({ AI: [type, 100 + id, 100, id, 7, 0, 0, 0, 0, 0, "Castle"] })) })) }, 0)
    bot.xtHandler.emit("dcl", dclFrame(), 0)
    bot.xtHandler.emit("sce", Object.entries({ AC: 0, RC: 0, LRC: 0, ...coins }), 0)
    const sentOf = cmd => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
    return { bot, donations: () => sentOf("ado"), looks: () => sentOf("gdr"), status: () => reports.at(-1), logs }
}

const ado = (AID, KID, RV) => ({ AID, KID, RV })

describe("the catalog entry", () => {
    test("is accepted by the API", () => {
        const { mod } = loadModule("plugins/allianceDonation.js", { mainThread: true })
        const entry = { key: "allianceDonation", force: false, hidden: false, options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual([
            "donateCastles", "donateWood", "donateStone", "donateIron", "donateOil", "donateGlass", "donateCoal",
            "donateAllianceCoins", "allianceCoinsKeep", "donateRiftCoins", "riftCoinsKeep", "donateLegendaryRiftCoins", "legendaryRiftCoinsKeep", "dryRunDonations",
        ])
        expect(mod.pluginOptions[0].columns.map(c => c.key)).toEqual(["castle", "storageKeep"])
    })

    test.each(["allianceDonation", "allianceDonation.description", "donateCastles", "storageKeep", "donateWood", "donateAllianceCoins", "allianceCoinsKeep", "dryRunDonations", "dryRunAdo", "allianceDonated", "allianceDonationShort", "allianceDonationRefused"])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })

    test("every status key it reports is in en.json", () => {
        for (const key of ["Starting", "NoCastles", "NoAlliance", "JustJoined", "FundsFull", "Short", "Refused", "BelowKeep", "Donated"])
            expect(en[`statusAllianceDonation${key}`]).toEqual(expect.any(String))
    })
})

describe("what each castle gives", () => {
    test("gives what is above its kept share of storage, per ticked resource, and never food", async () => {
        const { donations, looks, status } = run({ options: { donateCastles: [row(0, 10)] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(looks()).toEqual([{ AID: 10, KID: 0 }])
        expect(donations()).toEqual([ado(10, 0, { W: 1000, S: 1000, I: 1000, O: 1000, G: 1000, C: 1000 })])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusAllianceDonationDonated" })
    })

    test("leaves out a resource that isn't ticked", async () => {
        const { donations } = run({ options: { donateCastles: [row(0, 10)], donateIron: false, donateOil: false, donateGlass: false, donateCoal: false } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([ado(10, 0, { W: 1000, S: 1000 })])
    })

    test("works from the castle's figures the gdr reply gives, not the older castle list", async () => {
        const { donations } = run({ options: { donateCastles: [row(0, 10)], donateStone: false, donateIron: false, donateOil: false, donateGlass: false, donateCoal: false }, fresh: { 10: { W: 9500 } } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([ado(10, 0, { W: 1500 })])
    })

    test("each castle keeps its own share", async () => {
        const { donations } = run({ options: { donateCastles: [row(0, 10, 85), row(1, 20, 40)], donateStone: false, donateIron: false, donateOil: false, donateGlass: false, donateCoal: false } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([ado(10, 0, { W: 500 }), ado(20, 1, { W: 1000 })])
    })

    test("a castle at or below its share gives nothing, and the status says so", async () => {
        const { donations, status } = run({ options: { donateCastles: [row(0, 10, 90)] } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusAllianceDonationBelowKeep" })
    })

    test("gives again about every 10 minutes", async () => {
        const { looks } = run({ options: { donateCastles: [row(0, 10)] } })
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(looks()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(6 * MINUTE)
        expect(looks()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(4 * MINUTE)
        expect(looks()).toHaveLength(2)
    })
})

describe("the alliance's coins", () => {
    test("gives the ticked coins above their keep from the main castle, kingdom 0", async () => {
        const { donations } = run({ options: { donateAllianceCoins: true, allianceCoinsKeep: 100, donateRiftCoins: true }, coins: { AC: 450, RC: 30, LRC: 99 } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([ado(10, 0, { AC: 350, RC: 30 })])
    })

    test("gives no coins unless ticked", async () => {
        const { donations, status } = run({ options: {}, coins: { AC: 450, RC: 30, LRC: 99 } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([])
        expect(status()).toMatchObject({ reasonKey: "statusAllianceDonationNoCastles" })
    })
})

describe("refusals", () => {
    test("not in an alliance: asks the game nothing until the player joins one", async () => {
        const { bot, looks, donations, status } = run({ options: { donateCastles: [row(0, 10)] }, alliance: -1 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(looks()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusAllianceDonationNoAlliance" })
        bot.playerInfo.alliance.id = 5
        await vi.advanceTimersByTimeAsync(12 * MINUTE)
        expect(donations()).toHaveLength(1)
    })

    test.each([[270, "NoAlliance"], [124, "JustJoined"], [398, "FundsFull"]])("refusal %i ends the round: the next castle isn't tried", async (code, status) => {
        const { looks, donations, status: last } = run({ options: { donateCastles: [row(0, 10), row(1, 20, 10)] }, onAdo: () => code })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(looks()).toEqual([{ AID: 10, KID: 0 }])
        expect(donations()).toHaveLength(1)
        expect(last()).toMatchObject({ state: "waiting", reasonKey: `statusAllianceDonation${status}` })
    })

    test.each([55, 117, 327])("refusal %i is said once for that castle, and the next castle is still tried", async code => {
        const { donations, logs } = run({ options: { donateCastles: [row(0, 10), row(1, 20, 10)] }, onAdo: p => p.AID == 10 ? code : 0 })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations().map(d => d.AID)).toEqual([10, 20])
        await vi.advanceTimersByTimeAsync(25 * MINUTE)
        expect(donations().filter(d => d.AID == 10).length).toBeGreaterThan(1)
        expect(logs.filter(([key]) => key == "allianceDonationShort")).toHaveLength(1)
    })
})

describe("dry runs", () => {
    test("a dry run logs each donation and sends none", async () => {
        const { donations, logs, status } = run({ options: { donateCastles: [row(0, 10)], dryRunDonations: true, donateStone: false, donateIron: false, donateOil: false, donateGlass: false, donateCoal: false } })
        await vi.advanceTimersByTimeAsync(5 * MINUTE)
        expect(donations()).toEqual([])
        expect(logs).toContainEqual(["dryRunAdo", JSON.stringify(ado(10, 0, { W: 1000 }))])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusAllianceDonationDonated" })
    })
})
