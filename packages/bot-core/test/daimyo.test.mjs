import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { loadModule } = require("./harness/load.cjs")
const { readDaimyoCastle, eventCampOptions, EVENT_PROFILES } = require("../eventCamps.js")
const trace = require("./fixtures/protocol/daimyo-20261120.json")

const { GAAAreaInfo } = loadModule("protocols.js").mod.ClassTypes
/** The areas the bot's gaa handler makes of a reply's AI rows. */
const mapOf = fixture => fixture.reply.payload.AI.map(ai => new GAAAreaInfo(ai))
/** Rows of items_v790.06.json, trimmed to what the plugin reads. */
const daimyoCastles = [
    { id: "1", rank: "1", level: "81", coolDown: "1800" },
    { id: "11", rank: "2", level: "91", coolDown: "3600" },
    { id: "21", rank: "3", level: "106", coolDown: "7200" },
    { id: "26", rank: "4", level: "116", coolDown: "18000" },
]
const eventAutoScalingCamps = [{ eventAutoScalingCampID: "401", eventID: "80", difficultyID: "201", areaType: "37", camplevel: "21", rank: "2", coolDown: "3600" }]
const rows = { classicRows: daimyoCastles, scalingRows: eventAutoScalingCamps }
const inventory = () => [
    melee(601, 900, { meleeAttack: "90" }),
    ranged(603, 900, { rangeAttack: "80" }),
    tool(614, 400, { wallBonus: "10" }),
]
const daimyo = (options, game) => runEvent("attackDaimyo", { commanderWhiteList: "1-99", ...options },
    { inventory: inventory(), start: { EDID: -1 }, items: { daimyoCastles, eventAutoScalingCamps }, areas: mapOf(trace.gaa_reply), ...game })
const targets = sent => sent.map(cra => [cra.TX, cra.TY])
const instant = { pause: async () => {}, boxMullerRandom: () => 0 }

afterEach(() => vi.restoreAllMocks())

describe("reading a Daimyo castle off the map", () => {
    test("the rank and level come from the castle's daimyoCastles row on the classic difficulty", () => {
        const reads = mapOf(trace.gaa_reply).map(area => readDaimyoCastle(area.extraData, rows))
        expect(reads).toEqual([
            { rank: 1, level: 81, campID: 1 }, { rank: 2, level: 91, campID: 11 }, { rank: 3, level: 106, campID: 21 }, { rank: 4, level: 116, campID: 26 },
            { problem: "hidden" },
        ])
    })

    test("a castle that names an eventAutoScalingCamps row is read from that row, as the client does", () => {
        const [area] = mapOf(trace.gaa_reply_scaled)
        expect(readDaimyoCastle(area.extraData, rows)).toEqual({ rank: 2, level: 21, campID: 401 })
    })

    test("an entry in another shape, or naming a castle no row holds, is a problem and not a guess", () => {
        const [first] = trace.gaa_reply.reply.payload.AI
        const read = ai => readDaimyoCastle(new GAAAreaInfo(ai).extraData, rows)
        expect(read(first.slice(0, 7))).toEqual({ problem: "shape" })
        expect(read(first.with(5, -30))).toEqual({ problem: "shape" })
        expect(read(first.with(4, "castle"))).toEqual({ problem: "shape" })
        expect(read(first.with(4, 99))).toEqual({ problem: "unknownCastle" })
        expect(read(first.with(8, 999))).toEqual({ problem: "unknownCastle" })
    })
})

describe("the Attack Daimyo options", () => {
    const options = eventCampOptions(EVENT_PROFILES.daimyo)
    const keys = options.map(option => option.key)

    test("rank 1 alone is ticked by default, and the ranks sit under Target", () => {
        expect(options.filter(option => option.key.startsWith("daimyoRank")).map(option => [option.key, option.default]))
            .toEqual([["daimyoRank1", true], ["daimyoRank2", false], ["daimyoRank3", false], ["daimyoRank4", false]])
        expect(keys.indexOf("daimyoRank1")).toBeLessThan(keys.indexOf("limitSettings"))
    })

    test("it has time skips, horse, commanders and the army options, and no difficulty or score of its own", () => {
        expect(keys).toEqual(expect.arrayContaining(["targetMode", "skipTypes", "skipBudgetPerDay", "horse", "commanderWhiteList", "armyMode", "waves", "attackWaves"]))
        expect(keys).not.toEqual(expect.arrayContaining(["eventDifficulty"]))
        expect(keys).not.toContain("scoreShutoff")
        expect(keys).not.toContain("lowValueChests")
    })
})

describe("Attack Daimyo", () => {
    test("by default it attacks the rank 1 castle, with the frame the recorded client sent", async () => {
        const { sent, frames } = await daimyo({ targetMode: 1 })
        expect(targets(sent)).toEqual([[695, 528]])
        const recorded = trace.cra_1.payload
        expect([sent[0].TX, sent[0].TY, sent[0].KID]).toEqual([recorded.TX, recorded.TY, recorded.KID])
        expect(Object.keys(sent[0]).sort()).toEqual(Object.keys(recorded).sort())
        expect(frames.map(([command]) => command)).not.toContain("sede")
    })

    test("each rank ticked adds its castles, and a waiting castle's wait is skipped", async () => {
        const garrison = [melee(601, 90_000), ranged(603, 90_000), tool(614, 4000, { wallBonus: "10" })]
        const { sent, skipped } = await daimyo({ daimyoRank2: true, daimyoRank4: true }, { sends: 3, inventory: garrison })
        expect(targets(sent).sort()).toEqual([[687, 528], [695, 528], [698, 535]])
        expect(skipped).toEqual(["MS3"])
    })

    test("without skips a waiting castle is left alone and no skip is spent", async () => {
        const { sent, skipped, statuses } = await daimyo({ targetMode: 1, daimyoRank1: false, daimyoRank2: true }, { wait: 10 })
        expect([sent, skipped]).toEqual([[], []])
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusDaimyoCooling", params: { minutes: 10 } })
    })

    test("a castle on a scaled difficulty is attacked by the rank of its eventAutoScalingCamps row", async () => {
        const { sent } = await daimyo({ daimyoRank1: false, daimyoRank2: true }, { areas: mapOf(trace.gaa_reply_scaled), start: { EDID: 201 } })
        expect(targets(sent)).toEqual([[695, 528]])
    })

    test("with no rank ticked it says so and asks nothing of the map", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { sent, statuses, requests } = await daimyo({ daimyoRank1: false }, { wait: 10 })
        expect([sent, requests]).toEqual([[], []])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusDaimyoNoRanks" })
    })

    test("a castle entry in a shape the bot does not know stops it with the reason, and the log names the entry", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const odd = new GAAAreaInfo([37, 695, 528, -1, 1, 0])
        const { sent, statuses } = await daimyo({}, { areas: [odd], wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusDaimyoUnreadable", params: { count: 1 } })
        expect(warn).toHaveBeenCalledWith("campsUnreadable", "695:528 shape [-1,1,0]")
    })

    test("with no castle of the ticked ranks nearby it looks again every 10 minutes, and attacks once one shows", async () => {
        const areas = []
        const slept = []
        const sleep = async ms => {
            slept.push(ms)
            areas.push(...mapOf(trace.gaa_reply))
        }
        const { sent, statuses } = await daimyo({}, { areas, extra: { "pacing.js": { ...instant, sleep } } })
        expect(statuses).toContainEqual(expect.objectContaining({ state: "waiting", reasonKey: "statusDaimyoNoneFound", params: { castle: "100:100", minutes: 10 } }))
        expect(slept[0]).toBe(10 * 60_000)
        expect(targets(sent)).toEqual([[695, 528]])
    })

    test("the event ending while it waits to look again ends the wait without an attack", async () => {
        const areas = []
        let wake
        const sleep = () => new Promise(resolve => { wake = resolve })
        const { sent, bot } = await daimyo({}, { areas, wait: 5, extra: { "pacing.js": { ...instant, sleep } } })
        bot.events.emit("eventStop", { EID: 80 })
        areas.push(...mapOf(trace.gaa_reply))
        wake()
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(sent).toEqual([])
    })

    test("it never sends a Samurai event tool, which may attack only Samurai camps", async () => {
        const samuraiTool = unit(26, 50, { toolCategory: "Event", typ: "Attack", wallBonus: "25", samuraiTokenBooster: "3", allowedToAttack: "0+29", usageEventID: "80", slotTypes: "1,2,9" })
        const { cra } = await daimyo({}, { inventory: [...inventory(), samuraiTool] })
        const sentUnits = cra.A.flatMap(wave => [...wave.L.T, ...wave.M.T, ...wave.R.T]).map(([wodID]) => wodID)
        expect(sentUnits).toContain(614)
        expect(sentUnits).not.toContain(26)
    })
})

describe("skipping a Daimyo castle's wait", () => {
    test("sends the msd frame the recorded client sent", async () => {
        const { mod, bot } = loadModule("protocols.js")
        mod.ClientCommands.skipTarget(37, 695, 528, 0, "MS4")
        await new Promise(resolve => setImmediate(resolve))
        expect(bot.sent[0]).toEqual(["msd", trace.msd_1.payload])
    })
})
