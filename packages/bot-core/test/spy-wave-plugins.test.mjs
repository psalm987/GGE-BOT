import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { loadModule } = require("./harness/load.cjs")
const daimyoTrace = require("./fixtures/protocol/daimyo-20261120.json")

afterEach(() => vi.restoreAllMocks())

const LADDER = 614, RAM = 611, MANTLET = 615, ARCHER = 603
const empty = [-1, 0]
const REPORT = [[[900, 40]], [[900, 80]], [[900, 40]], []]
const siegeTools = () => [
    tool(LADDER, 400, { wallBonus: "10", slotTypes: "1,2" }), tool(RAM, 400, { gateBonus: "10", slotTypes: "1" }), tool(MANTLET, 400, { defRangeBonus: "10", slotTypes: "1,2" }),
]
/** Every attack in the queue gets its turn at once, and the spies' trip takes no time. */
const waitToAttack = job => job({ outsideQueue: async () => {} })

/** The game's answers to the spies and to the attack screen opened after them, whose map entry is `ai(x, y)`. */
const spyGame = (ai, { spies = 12 } = {}) => (cmd, p) => ({
    ssi: [{ TX: p.TX, TY: p.TY, AS: spies }, 0],
    csm: [{ A: { M: { TT: 1, PT: 0, TA: [ai(p.TX, p.TY)[0], p.TX, p.TY] } } }, 0],
    adi: [{ gaa: { AI: ai(p.TX, p.TY) }, S: REPORT, B: { AIE: [] } }, 0],
})[cmd]
const commands = frames => frames.map(([cmd]) => cmd).filter(cmd => ["ssi", "csm", "adi"].includes(cmd))

describe("Attack Khan with wave 1 from a spy report", () => {
    /** A Khan camp's map entry: its scaling camp 5 at AI 9 and its wall of 40 at AI 10. */
    const campAI = (x, y) => [35, x, y, 0, 0, 0, 0, 0, 0, 5, 40, 0, 0]
    const inventory = () => [melee(601, 5000, { meleeAttack: "90" }), ranged(ARCHER, 5000, { rangeAttack: "80" }), unit(162, 500, { typ: "Attack", slotTypes: "1,2,9", khanTabletBooster: "4" }), ...siegeTools()]
    const khan = (game = {}) => runEvent("attackKhan", { commanderWhiteList: "1-99", spyWaveOne: true }, {
        inventory: inventory(), areas: [{ type: 35, x: 110, y: 105, extraData: campAI(110, 105).slice(3) }], start: { EDID: 3 },
        items: { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50", playerRageCap: "1500" }] },
        waitToAttack, answer: spyGame(campAI), ...game,
    })

    test("spies the camp, reads the report, and fills wave 1 from it", async () => {
        const { cra, frames } = await khan()
        expect(commands(frames)).toEqual(["ssi", "csm", "adi"])
        // Level 50: the camp's wall of 40 takes 4 ladders a side, and the ranged defence of 100 takes 10 mantlets.
        expect(cra.A[0].L).toEqual({ T: [[LADDER, 4], [MANTLET, 10]], U: [[ARCHER, 52], empty] })
        expect(cra.A[0].M).toEqual({ T: [[LADDER, 4], [MANTLET, 10], empty], U: [[ARCHER, 154], ...Array(5).fill(empty)] })
    })

    test("with no spies it sends nothing and waits 10 minutes", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { sent, statuses } = await khan({ answer: spyGame(campAI, { spies: 0 }) })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusSpyNoReport", params: { minutes: 10 } })
    })
})

describe("Attack Daimyo with wave 1 from a spy report", () => {
    const { GAAAreaInfo } = loadModule("protocols.js").mod.ClassTypes
    const traced = daimyoTrace.gaa_reply.reply.payload.AI
    /** The castles' map entries as the capture has them: wall 110, gate 110 and moat 0 at AI 9 to 11. */
    const castleAI = (x, y) => traced.find(ai => ai[1] == x && ai[2] == y)
    const daimyoCastles = [{ id: "1", rank: "1", level: "81", coolDown: "1800" }, { id: "11", rank: "2", level: "91", coolDown: "3600" }]
    const daimyo = (inventory, game = {}) => runEvent("attackDaimyo", { commanderWhiteList: "1-99", targetMode: 1, spyWaveOne: true }, {
        inventory, start: { EDID: -1 }, items: { daimyoCastles, eventAutoScalingCamps: [] }, areas: traced.map(ai => new GAAAreaInfo(ai)),
        waitToAttack, answer: spyGame(castleAI), ...game,
    })

    test("breaks the castle's wall and gate in wave 1, as the report and its map entry call for", async () => {
        const { cra, frames } = await daimyo([melee(601, 900, { meleeAttack: "90" }), ranged(ARCHER, 900, { rangeAttack: "80" }), ...siegeTools()])
        expect(commands(frames)).toEqual(["ssi", "csm", "adi"])
        expect([cra.TX, cra.TY]).toEqual([695, 528])
        // Level 81: 64 troops a flank and 192 on the front; wall 110 and gate 110 take 11 tools each.
        expect(cra.A[0].L).toEqual({ T: [[LADDER, 11], [MANTLET, 10]], U: [[ARCHER, 64], empty] })
        expect(cra.A[0].M).toEqual({ T: [[LADDER, 11], [RAM, 11], [MANTLET, 10]], U: [[ARCHER, 192], ...Array(5).fill(empty)] })
    })

    test("with no tools for the gate it stops, saying why", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { sent, statuses } = await daimyo([ranged(ARCHER, 900, { rangeAttack: "80" }), ...siegeTools().filter(t => t.unitInfo.wodID != RAM)])
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusSpyToolsShort" })
    })
})
