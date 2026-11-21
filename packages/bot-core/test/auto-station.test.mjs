import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot, repo } = require("./harness/load.cjs")
const { PluginStatus, Notify } = require("../actions.json")
const en = require("../locales/en.json")
const stationFrames = require("./fixtures/protocol/station.json")
const gateFrames = require("./fixtures/protocol/open-gate-mos.json")
const costTables = require("./fixtures/protocol/cost-tables.json")

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

const S = 1000
const ME = 7, ALLIANCE = 9, RAIDER = 1
const STATIONED_MID = stationFrames.recall_mcm.payload.MID
const { SID: KEEP, TX: ALLY_X, TY: ALLY_Y } = stationFrames.station_cds.payload
const ARCHER = 10, PIKE = 608, RAM = 611

/** Soldiers and a tool as the items file has them: the archer hits harder than it defends, the pikeman the other way round. */
const units = [
    { wodID: ARCHER, role: "ranged", fightType: "0", meleeAttack: "0", rangeAttack: "40", meleeDefence: "10", rangeDefence: "20" },
    { wodID: PIKE, role: "melee", fightType: "0", meleeAttack: "15", rangeAttack: "0", meleeDefence: "50", rangeDefence: "45" },
    { wodID: RAM, typ: "Attack", toolCategory: "Basic", fightType: "0", gateBonus: "10" },
]

/** Our castles as `gcl` lists them: [kingdom, id, type, x, y, name]. The Keep is the fixture's station source. */
const CASTLES = [
    [0, KEEP, 1, 100, 200, "Ada's Keep"],
    [0, 2001, 4, 150, 250, "Ada's Outpost"],
    [10, 3001, 15, 40, 40, "Ada's Berimond Camp"],
]

/** An alliance member as `ain` lists it; `castles` are `AP` entries [kingdom, id, x, y, type]. */
const member = (OID, N, RPT, castles) => ({ OID, N, AID: ALLIANCE, RPT, RNP: 0, AP: castles })
const ALLY = member(3, "Ally", 5 * 3600, [[0, 555, ALLY_X, ALLY_Y, 1]])

/**
 * Auto Station against a stand-in game. The real incoming-attack detector reads the `gam` frames; the game answers
 * `ain`, `cds`, `mcm` and `mos` after 50 ms, the way `replies` say.
 */
function autoStation({ options = {}, members = [ALLY], inventory = { [ARCHER]: 200, [PIKE]: 300, [RAM]: 50 }, openGateCount = 0,
    rubies = 100_000, commanders = [{ ID: 1, VIS: 0, N: "Hal" }], replies = {}, alliance = ALLIANCE, stationMarch = 120 } = {}) {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const bot = fakeBot()
    bot.playerInfo.playerID = ME
    bot.playerInfo.alliance = { id: alliance }
    bot.playerInfo.rubies = rubies
    bot.botConfig.plugins.autoStation = { state: true, ...options }
    const reports = [], notices = [], logs = []
    const answer = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 50)
    // The real wait gives up after its timeout; the stand-in does too.
    const wait = bot.waitForResult
    bot.waitForResult = (key, timeout, filter) => Promise.race([wait(key, timeout, filter), new Promise((_, reject) => setTimeout(() => reject("TIMED_OUT"), timeout))])
    let mid = STATIONED_MID
    const stationedAt = []
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "ain")
            answer("ain", { A: { AID: p.AID, M: [member(ME, "Ada", 0, CASTLES.map(([k, id, type, x, y]) => [k, id, x, y, type])), ...members] } })
        if (cmd == "cds") {
            const refused = replies.cds?.(p)
            if (refused == "silent")
                return
            if (refused)
                return answer("cds", {}, refused)
            stationedAt.push([p.TX, p.TY])
            answer("cds", { gcu: { C1: 0, C2: rubies }, O: [], A: { M: { MID: mid++, T: 1, KID: 0, OID: ME, SID: ME, TID: 3, TT: stationMarch, PT: 0, HBW: -1, TA: [1, p.TX, p.TY, 555], SA: [1, 100, 200, KEEP] }, UM: { L: { ID: p.LID } } } })
        }
        if (cmd == "mcm" && replies.mcm)
            answer("mcm", {}, replies.mcm)
        else if (cmd == "mcm")
            answer("mcm", { A: { M: { MID: p.MID, T: 2, KID: 0, OID: ME, SID: 3, TID: ME, TT: 120, PT: 0, HBW: -1, TA: [1, 100, 200, KEEP], SA: [1, ALLY_X, ALLY_Y, 555] } } })
        if (cmd == "dcl")
            answer("dcl", castleList())
        if (cmd == "mos")
            answer("mos", { gcu: { C1: 0, C2: rubies }, CID: p.CID, KID: p.KID, RPT: p.CD == 0 ? 6 * 3600 : 12 * 3600 }, replies.mos ?? 0)
    }
    const parentPort = {
        postMessage: ([action, payload]) => action == PluginStatus ? reports.push(payload) : action == Notify ? notices.push(payload) : undefined,
        on() {},
    }
    for (const level of ["log", "warn", "info", "error"])
        vi.spyOn(console, level).mockImplementation((...args) => logs.push(args))
    loadModule("plugins/autoStation.js", { bot, parentPort, items: { units } })
    const commander = { ...require(path.join(repo, "plugins/commander.js")), ...require(path.join(repo, "castleLock.js")) }
    bot.xtHandler.emit("gcl", { C: [0, 10].map(KID => ({ KID, AI: CASTLES.filter(([k]) => k == KID).map(([, id, type, x, y, name]) => ({ AI: [type, x, y, id, 0, 0, 0, 0, 0, 0, name] })) })) }, 0)
    const castleList = () => ({ C: [0, 10].map(KID => ({ KID, AI: CASTLES.filter(([k]) => k == KID).map(([, AID]) => ({ AID, ...(openGateCount != null && { OGC: openGateCount }), gpa: {}, AC: Object.entries(inventory).map(([wod, n]) => [Number(wod), n]) })) })) })
    bot.xtHandler.emit("dcl", castleList(), 0)
    bot.xtHandler.emit("gli", { C: commanders }, 0)
    bot.events.emit("load")

    const owners = [{ OID: RAIDER, N: "Raider", AID: 2, AN: "Wolves" }, { OID: ME, N: "Ada", AID: alliance }, { OID: 3, N: "Ally", AID: ALLIANCE }]
    /** An attack on `castle` (an index into CASTLES) by `from`, landing `lands` seconds from now. */
    const attack = ({ id = 42, from = RAIDER, to = ME, castle = 0, lands = 600, type = 0, army } = {}) => {
        const [KID, cid, areaType, x, y, name] = CASTLES[castle]
        bot.xtHandler.emit("gam", {
            O: owners,
            M: [{
                M: { MID: id, T: type, KID, OID: from, SID: from, TID: to, TT: lands, PT: 0, HBW: -1, TA: [areaType, x, y, cid, 0, 0, 0, 0, 0, 0, name], SA: [1, 0, 0, 77] },
                ...(army && { GA: army }),
            }],
        }, 0)
    }
    const sent = cmd => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
    const keys = () => logs.map(([key]) => key)
    return { bot, attack, sent, reports, status: () => reports.at(-1), notices, logs, keys, commander, stationedAt }
}

describe("the catalog entry", () => {
    const { mod } = loadModule("plugins/autoStation.js", { mainThread: true })
    const byKey = Object.fromEntries(mod.pluginOptions.filter(o => o.key).map(o => [o.key, o]))

    test("is accepted by the API, marks that it ends protection, and checks the commander list", () => {
        const entry = { key: "autoStation", force: false, hidden: false, options: mod.pluginOptions, checks: mod.checks, breaksPeace: mod.breaksPeace }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.breaksPeace).toBe(true)
        expect(mod.checks).toEqual([{ type: "commanders", option: "commanderWhiteList", vip: "vipCommanders" }])
        expect(byKey.vipCommanders).toMatchObject({ type: "Number", min: 0, max: 300, default: 0 })
    })

    test("leaves 60 seconds before the attack by default and never less than 20", () => {
        expect(byKey.stationLeadSeconds).toMatchObject({ type: "Number", default: 60, min: 20, unit: "seconds" })
    })

    test("keeps the gates shut unless the player picks a length, and caps what one opening may cost", () => {
        expect(byKey.stationGateFallback.default).toBe(0)
        expect(byKey.stationGateFallback.selection[0]).toBe("Off")
        expect(byKey.stationGateMaxRubies).toMatchObject({ default: 700, unit: "rubies" })
    })

    test("leaves dry run off by default", () => {
        expect(byKey.stationDryRun.default).toBe(false)
    })
})

test("en.json words every option, column, log line and status the plugin uses", () => {
    const { mod } = loadModule("plugins/autoStation.js", { mainThread: true })
    const source = readFileSync(path.join(repo, "plugins/autoStation.js"), "utf8")
    const said = [...source.matchAll(/console\.\w+\("(\w+)"/g), ...source.matchAll(/reportStatus\("\w+", "(\w+)"/g)].map(([, key]) => key)
    const options = mod.pluginOptions.flatMap(o => [o.key, ...(o.columns ?? []).map(c => c.key)])
    expect(said.length).toBeGreaterThan(20)
    for (const key of ["autoStation", "CASTLE_LOCKED", ...options, ...said])
        expect(en[key] ?? en[`${key}_other`], key).toEqual(expect.any(String))
})

describe("when a player attacks one of our castles", () => {
    test("the troops leave for the protected alliance castle at the landing time minus the lead, as the fixture `cds`", async () => {
        const { attack, sent } = autoStation()
        attack({ lands: 600 })

        await vi.advanceTimersByTimeAsync(539 * S)
        expect([...sent("ain"), ...sent("cds")]).toEqual([])

        await vi.advanceTimersByTimeAsync(1 * S)
        expect(sent("ain"), "it looks for a destination at landing minus 60 s").toEqual([{ AID: ALLIANCE }])
        await vi.advanceTimersByTimeAsync(0.1 * S)
        expect(sent("cds")).toEqual([stationFrames.station_cds.payload])
    })

    test("a longer lead moves them out sooner", async () => {
        const { attack, sent } = autoStation({ options: { stationLeadSeconds: 120 } })
        attack({ lands: 600 })

        await vi.advanceTimersByTimeAsync(479 * S)
        expect(sent("ain")).toEqual([])
        await vi.advanceTimersByTimeAsync(1.1 * S)
        expect(sent("cds")).toHaveLength(1)
    })

    test("they never leave sooner than 5 seconds after the attack is seen", async () => {
        const { attack, sent } = autoStation()
        attack({ lands: 30 })

        await vi.advanceTimersByTimeAsync(4.9 * S)
        expect(sent("cds")).toEqual([])
        await vi.advanceTimersByTimeAsync(0.2 * S)
        expect(sent("cds")).toHaveLength(1)
    })

    test("a second, earlier attack on the same castle brings the departure forward, and the castle moves out once", async () => {
        const { attack, sent } = autoStation()
        attack({ id: 1, lands: 900 })
        attack({ id: 2, lands: 600 })

        await vi.advanceTimersByTimeAsync(541 * S)
        expect(sent("cds")).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(400 * S)
        expect(sent("cds")).toHaveLength(1)
    })

    test("tells the owner once, with the attacker, the castle and when it lands", async () => {
        const { attack, notices } = autoStation()
        attack({ id: 1, lands: 600 })
        attack({ id: 2, lands: 700 })

        expect(notices).toEqual([{
            kind: "incoming_attack", key: `0:${KEEP}:1`,
            data: { attacker: "Raider", castle: "Ada's Keep", arrival: new Date(1_800_000_000_000 + 600 * S).toISOString() },
        }])
    })

    test("says where the troops went once the game confirms the station", async () => {
        const { attack, notices } = autoStation()
        attack({ lands: 600 })
        await vi.advanceTimersByTimeAsync(541 * S)

        expect(notices.at(-1)).toMatchObject({ kind: "station_result", data: { castle: "Ada's Keep", outcome: "stationed", destination: `Ally (${ALLY_X}:${ALLY_Y})`, rubies: null } })
    })
})

describe("which attacks count", () => {
    test("an NPC attack, an attack on an alliance member and a support march move nothing", async () => {
        const { attack, sent, notices } = autoStation()
        attack({ id: 1, from: -801 })
        attack({ id: 2, to: 3 })
        attack({ id: 3, type: 1 })

        await vi.advanceTimersByTimeAsync(700 * S)
        expect([...sent("ain"), ...sent("cds"), ...sent("mos")]).toEqual([])
        expect(notices).toEqual([])
    })

    test("a visible army smaller than the minimum is ignored, and a large enough one is not", async () => {
        const small = autoStation({ options: { stationMinArmy: 500 } })
        small.attack({ army: { L: [[ARCHER, 100]], M: [], R: [], RW: [] } })
        await vi.advanceTimersByTimeAsync(700 * S)
        expect(small.sent("cds")).toEqual([])

        const large = autoStation({ options: { stationMinArmy: 500 } })
        large.attack({ army: { L: [[ARCHER, 300]], M: [[PIKE, 300]], R: [], RW: [] } })
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(large.sent("cds")).toHaveLength(1)
    })

    test("an army that turns out too small once it is visible calls the evacuation off", async () => {
        const { attack, sent, commander } = autoStation({ options: { stationMinArmy: 500 } })
        attack({ lands: 600 })
        await vi.advanceTimersByTimeAsync(520 * S)
        expect(commander.isCastleLocked(0, 100, 200)).toBe(true)

        attack({ lands: 80, army: { L: [[ARCHER, 10]], M: [], R: [], RW: [] } })
        await vi.advanceTimersByTimeAsync(100 * S)
        expect(sent("cds")).toEqual([])
        expect(commander.isCastleLocked(0, 100, 200)).toBe(false)
    })

    test("a castle kind switched off in the scope is not watched", async () => {
        const { attack, sent } = autoStation({ options: { stationScopeOutposts: false } })
        attack({ castle: 1 })
        await vi.advanceTimersByTimeAsync(700 * S)
        expect(sent("cds")).toEqual([])
    })
})

describe("the destination", () => {
    const FAR = member(11, "Far", 10 * 3600, [[0, 601, 400, 400, 1]])
    const NEAR_UNPROTECTED = member(12, "Near", 0, [[0, 602, 101, 201, 1]])
    const NEAR_SHORT = member(13, "Short", 1800, [[0, 603, 102, 202, 1]])
    const NEAR_OUTPOST = member(14, "Post", 7200, [[0, 604, 103, 203, 4]])
    const OTHER_KINGDOM = member(15, "Abroad", 7200, [[2, 605, 100, 200, 12]])
    const MID = member(16, "Mid", 7200, [[0, 606, 200, 250, 12]])
    const members = [FAR, NEAR_UNPROTECTED, NEAR_SHORT, NEAR_OUTPOST, OTHER_KINGDOM, MID]

    const firstTarget = async options => {
        const run = autoStation({ members, options })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        const [first] = run.sent("cds")
        return [first.TX, first.TY]
    }

    test("is the nearest castle in the same kingdom whose owner has enough protection left", async () => {
        expect(await firstTarget()).toEqual([200, 250])
    })

    test("an owner with exactly the minimum protection left counts, and a longer minimum leaves that castle out", async () => {
        const run = autoStation({ members: [...members, member(17, "Brief", 3600, [[0, 607, 101, 202, 1]])] })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(run.sent("cds")[0]).toMatchObject({ TX: 101, TY: 202 })
        expect(await firstTarget({ stationMinProtectionHours: 3 })).toEqual([400, 400])
    })

    test("an alliance outpost counts only when outposts are allowed", async () => {
        expect(await firstTarget({ stationAllowOutposts: true })).toEqual([103, 203])
    })

    test("when the game refuses one castle, the next nearest is tried", async () => {
        const run = autoStation({ members, replies: { cds: p => p.TX == 200 ? 131 : 0 } })
        run.attack()
        await vi.advanceTimersByTimeAsync(542 * S)
        expect(run.sent("cds").map(p => [p.TX, p.TY])).toEqual([[200, 250], [400, 400]])
        expect(run.notices.at(-1).data).toMatchObject({ outcome: "stationed", destination: "Far (400:400)" })
    })

    test("fixed coordinates for the kingdom are used in order, the second as a backup", async () => {
        const fixed = [{ stationKingdom: 2, stationX: 9, stationY: 9 }, { stationKingdom: 0, stationX: 310, stationY: 402 }, { stationKingdom: 0, stationX: 320, stationY: 404 }]
        const run = autoStation({ options: { stationDestination: 1, stationFixedDestinations: fixed }, replies: { cds: p => p.TX == 310 ? 131 : 0 } })
        run.attack()
        await vi.advanceTimersByTimeAsync(542 * S)
        expect(run.sent("ain")).toEqual([])
        expect(run.sent("cds").map(p => [p.TX, p.TY])).toEqual([[310, 402], [320, 404]])
    })
})

describe("what leaves", () => {
    const army = async options => {
        const run = autoStation({ options })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        return run.sent("cds")[0].A
    }

    test("every soldier but no tools by default", async () => {
        expect(await army()).toEqual([[ARCHER, 200], [PIKE, 300]])
    })

    test("the reserve for this castle stays home, and another castle's reserve doesn't count", async () => {
        const stationReserve = [
            { castle: { kingdom: 0, id: KEEP }, troop: PIKE, stationKeep: 100 },
            { castle: { kingdom: 0, id: KEEP }, troop: ARCHER, stationKeep: 500 },
            { castle: { kingdom: 0, id: 2001 }, troop: PIKE, stationKeep: 300 },
        ]
        expect(await army({ stationReserve })).toEqual([[PIKE, 200]])
    })

    test("attack troops only leaves the defenders home", async () => {
        expect(await army({ stationTroops: 1 })).toEqual([[ARCHER, 200]])
    })

    test("with no free commander nothing is stationed", async () => {
        const run = autoStation({ commanders: [] })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(run.sent("cds")).toEqual([])
        expect(run.notices.at(-1).data.outcome).toBe("unprotected")
        expect(run.keys()).toContain("stationNoCommander")
    })

    test("two castles moving out at once each keep their own station and recall it", async () => {
        const commanders = [{ ID: 1, VIS: 0 }, { ID: 2, VIS: 1 }]
        const run = autoStation({ commanders })
        run.attack({ id: 1, castle: 0 })
        run.attack({ id: 2, castle: 1 })
        await vi.advanceTimersByTimeAsync(700 * S)
        expect(run.sent("cds").map(p => [p.SID, p.LID])).toEqual([[KEEP, 1], [2001, 2]])
        expect(run.sent("mcm").map(p => p.MID).sort()).toEqual([STATIONED_MID, STATIONED_MID + 1])
    })

    test("only whitelisted commanders go, and no more at once than the limit", async () => {
        const commanders = [{ ID: 1, VIS: 0 }, { ID: 2, VIS: 1 }, { ID: 3, VIS: 2 }]
        const run = autoStation({ commanders, options: { commanderWhiteList: "2-3", stationMaxCommanders: 1 } })
        run.attack({ id: 1, castle: 0 })
        run.attack({ id: 2, castle: 1 })
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(run.sent("cds").map(p => p.LID)).toEqual([2])
        expect(run.notices.filter(n => n.kind == "station_result").map(n => n.data.outcome).sort()).toEqual(["stationed", "unprotected"])
    })
})

describe("coming home", () => {
    test("the troops are recalled 60 seconds after the last attack lands, with the stationed march's id", async () => {
        const { attack, sent } = autoStation()
        attack({ id: 1, lands: 600 })
        attack({ id: 2, lands: 630 })

        await vi.advanceTimersByTimeAsync(689 * S)
        expect(sent("mcm")).toEqual([])
        await vi.advanceTimersByTimeAsync(2 * S)
        expect(sent("mcm")).toEqual([stationFrames.recall_mcm.payload])
    })

    test("an attack seen while the troops are away keeps them away until it lands too", async () => {
        const { attack, sent } = autoStation()
        attack({ id: 1, lands: 600 })
        await vi.advanceTimersByTimeAsync(630 * S)
        attack({ id: 2, lands: 300 })

        await vi.advanceTimersByTimeAsync(300 * S)
        expect(sent("mcm")).toEqual([])
        await vi.advanceTimersByTimeAsync(61 * S)
        expect(sent("mcm")).toHaveLength(1)
        expect(sent("cds")).toHaveLength(1)
    })

    test("attacks leave the castle again only once the troops are called home", async () => {
        const { attack, commander } = autoStation()
        attack({ lands: 600 })
        await vi.advanceTimersByTimeAsync(509 * S)
        expect(commander.isCastleLocked(0, 100, 200), "free until 30 s before the troops leave").toBe(false)
        await vi.advanceTimersByTimeAsync(2 * S)
        expect(commander.isCastleLocked(0, 100, 200)).toBe(true)
        await vi.advanceTimersByTimeAsync(140 * S)
        expect(commander.isCastleLocked(0, 100, 200)).toBe(true)
        await vi.advanceTimersByTimeAsync(21 * S)
        expect(commander.isCastleLocked(0, 100, 200)).toBe(false)
    })

    test("recalled while still marching out, the commander is free only once the march home ends", async () => {
        const { attack, commander } = autoStation({ stationMarch: 300 })
        attack({ lands: 600 })
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(commander.takeFreeCommander("1"), "away with the station").toBeUndefined()
        await vi.advanceTimersByTimeAsync(239 * S)
        expect(commander.takeFreeCommander("1"), "recalled at 660 s, home at 781 s").toBeUndefined()
        await vi.advanceTimersByTimeAsync(5 * S)
        expect(commander.takeFreeCommander("1")?.lordID).toBe(1)
        await vi.advanceTimersByTimeAsync(100 * S)
        expect(commander.takeFreeCommander("1"), "the station's own arrival time frees nothing a second time").toBeUndefined()
    })

    test("a refused recall keeps the commander held, since the troops are still out", async () => {
        const { attack, commander, keys } = autoStation({ replies: { mcm: 114 } })
        attack({ lands: 600 })
        await vi.advanceTimersByTimeAsync(800 * S)
        expect(keys()).toContain("stationRecallRefused")
        expect(commander.takeFreeCommander("1")).toBeUndefined()
        expect(commander.isCastleLocked(0, 100, 200)).toBe(false)
    })

    test("an attack seen while the recall is on its way starts a new evacuation", async () => {
        const { attack, sent } = autoStation()
        attack({ id: 1, lands: 600 })
        await vi.advanceTimersByTimeAsync(660.01 * S)
        expect(sent("mcm")).toHaveLength(1)
        attack({ id: 2, lands: 400 })
        await vi.advanceTimersByTimeAsync(339 * S)
        expect(sent("cds")).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(2 * S)
        expect(sent("cds"), "the troops, home again by then, leave for the second attack").toHaveLength(2)
    })

    test("an attack called off before the troops leave moves nothing and frees the castle", async () => {
        const { bot, attack, sent, commander } = autoStation()
        attack({ lands: 600 })
        await vi.advanceTimersByTimeAsync(520 * S)
        bot.xtHandler.emit("dms", { MID: [42] }, 0)
        await vi.advanceTimersByTimeAsync(200 * S)
        expect(sent("cds")).toEqual([])
        expect(commander.isCastleLocked(0, 100, 200)).toBe(false)
        expect(commander.takeFreeCommander("1")?.lordID, "the held commander is back in the pool").toBe(1)
    })
})

describe("the gate fallback", () => {
    const noDestination = { members: [] }

    test("stays shut by default when no alliance castle can take the troops", async () => {
        const run = autoStation(noDestination)
        run.attack()
        await vi.advanceTimersByTimeAsync(700 * S)
        expect(run.sent("mos")).toEqual([])
        expect(run.notices.at(-1).data.outcome).toBe("unprotected")
    })

    test("opens the gates for 6 hours as the fixture `mos` when the player chose it", async () => {
        const run = autoStation({ ...noDestination, options: { stationGateFallback: 1 } })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(run.sent("mos")).toEqual([{ ...gateFrames.open_6h.payload, CID: KEEP }])
        expect(run.notices.at(-1).data).toMatchObject({ outcome: "gates_opened", rubies: 450 })
        await vi.advanceTimersByTimeAsync(200 * S)
        expect(run.sent("mcm"), "open gates leave nothing to recall").toEqual([])
    })

    test("opens them for 12 hours when stationing is refused everywhere", async () => {
        const run = autoStation({ options: { stationGateFallback: 2, stationGateMaxRubies: 1000 }, replies: { cds: () => 131 } })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(run.sent("mos")).toEqual([{ ...gateFrames.open_12h.payload, CID: KEEP }])
    })

    test("charges what the client's formula says for the castle's open-gate count", async () => {
        for (const row of costTables.openGate_before_discounts) {
            const run = autoStation({ ...noDestination, openGateCount: row.openGateCounter_OGC, options: { stationGateFallback: 1, stationGateMaxRubies: 60_000 } })
            run.attack()
            await vi.advanceTimersByTimeAsync(541 * S)
            expect(run.notices.at(-1).data.rubies, `OGC ${row.openGateCounter_OGC}`).toBe(row.CD0_6h_rubies)
        }
    })

    test("refuses an opening that costs more than the cap or than the rubies the player has", async () => {
        const overCap = autoStation({ ...noDestination, openGateCount: 2, options: { stationGateFallback: 1, stationGateMaxRubies: 2000 } })
        overCap.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(overCap.sent("mos")).toEqual([])

        const poor = autoStation({ ...noDestination, rubies: 449, options: { stationGateFallback: 1 } })
        poor.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(poor.sent("mos")).toEqual([])
    })

    test("keeps them shut when the castle's open-gate count is unknown, since the cost can't be checked", async () => {
        const run = autoStation({ ...noDestination, openGateCount: null, options: { stationGateFallback: 1 } })
        run.attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(run.sent("mos")).toEqual([])
        expect(run.keys()).toContain("stationGateCountUnknown")
    })

    test("a station the game never answers is not retried and opens no gates, and the castle list is read again", async () => {
        const run = autoStation({ options: { stationGateFallback: 1 }, members: [ALLY, member(11, "Far", 10 * 3600, [[0, 601, 400, 400, 1]])], replies: { cds: () => "silent" } })
        run.attack()
        await vi.advanceTimersByTimeAsync(590 * S)
        expect(run.sent("cds")).toHaveLength(1)
        expect(run.sent("mos")).toEqual([])
        expect(run.sent("dcl")).toHaveLength(1)
        expect(run.notices.at(-1).data.outcome).toBe("unprotected")
        expect(run.commander.takeFreeCommander("1"), "the commander may have left with the troops").toBeUndefined()
    })

    test("never opens the gates in Berimond", async () => {
        const run = autoStation({ ...noDestination, options: { stationGateFallback: 1 } })
        run.attack({ castle: 2 })
        await vi.advanceTimersByTimeAsync(700 * S)
        expect(run.sent("mos")).toEqual([])
        expect(run.keys()).toContain("stationGateBerimond")
    })
})

describe("dry run", () => {
    test("logs the station, the recall and the gates it would send and sends none of them", async () => {
        const run = autoStation({ options: { stationDryRun: true, stationGateFallback: 1 } })
        run.attack({ id: 1, castle: 0 })
        await vi.advanceTimersByTimeAsync(700 * S)
        expect([...run.sent("cds"), ...run.sent("mcm"), ...run.sent("mos")]).toEqual([])
        const dry = run.logs.filter(([key]) => key.startsWith("dryRun"))
        expect(dry.map(([key]) => key)).toEqual(["dryRunCds", "dryRunMcm"])
        expect(JSON.parse(dry[0][1])).toEqual(stationFrames.station_cds.payload)
        expect(run.commander.takeFreeCommander("1")?.lordID, "a dry run hands its commander back").toBe(1)

        const gates = autoStation({ members: [], options: { stationDryRun: true, stationGateFallback: 1 } })
        gates.attack()
        await vi.advanceTimersByTimeAsync(700 * S)
        expect(gates.sent("mos")).toEqual([])
        expect(gates.logs.find(([key]) => key == "dryRunMos")?.[1]).toBe(JSON.stringify({ ...gateFrames.open_6h.payload, CID: KEEP }))
    })
})

describe("its status line", () => {
    test("counts the watched castles, then says when the troops leave, that they are away and when they come home", async () => {
        const { attack, status, reports } = autoStation()
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusStationWatching", params: { count: 3 } })

        attack({ lands: 600 })
        expect(status()).toMatchObject({ reasonKey: "statusStationThreat", params: { castle: "Ada's Keep", at: new Date(1_800_000_000_000 + 540 * S).toISOString() } })
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(reports.map(r => r.reasonKey)).toContain("statusStationEvacuating")
        expect(status()).toMatchObject({ reasonKey: "statusStationed", params: { castle: "Ada's Keep" } })
        await vi.advanceTimersByTimeAsync(60 * S)
        expect(status()).toMatchObject({ reasonKey: "statusStationRecalling", params: { at: new Date(1_800_000_000_000 + 660 * S).toISOString() } })
        await vi.advanceTimersByTimeAsync(61 * S)
        expect(status()).toMatchObject({ reasonKey: "statusStationWatching" })
    })

    test("says when an attacked castle has no troops to move, and tells the owner nothing about a station", async () => {
        const { attack, status, sent, notices } = autoStation({ inventory: { [RAM]: 50 } })
        attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(status()).toMatchObject({ reasonKey: "statusStationEmpty", params: { castle: "Ada's Keep" } })
        expect(sent("cds")).toEqual([])
        expect(notices.map(n => n.kind)).toEqual(["incoming_attack"])
    })

    test("says when nothing could protect the troops", async () => {
        const { attack, status } = autoStation({ members: [] })
        attack()
        await vi.advanceTimersByTimeAsync(541 * S)
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusStationUnprotected", params: { castle: "Ada's Keep" } })
    })
})
