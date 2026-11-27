import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

class Lord {
    constructor(raw) {
        this.lordID = Number(raw.ID)
        this.fromScreen = true
    }
}
class UnitInventory {
    constructor(gui) {
        this.unitInventory = gui.I.map(([wodID, amount]) => ({ unitInfo: { wodID }, amount }))
    }
}

const horses = [
    { wodID: 1, costFactorC1: "1", costFactorC2: "0", unitBoost: "10", spyBoost: "20" },
    { wodID: 2, costFactorC1: "0", costFactorC2: "5", unitBoost: "50", spyBoost: "50" },
    { wodID: 3, costFactorC1: "1", costFactorC2: "0", unitBoost: "30", spyBoost: "10" },
]
const KHAN_CAMP = 35
const target = () => ({ type: KHAN_CAMP, x: 300, y: 400, extraData: [] })
const castle = () => ({ id: 4, areaInfo: { x: 100, y: 200 }, unlockedHorses: [1, 2, 3], unitInventory: [] })
const known = { lordID: 3 }
const REPORT = [[[500, 2]], [[502, 1]], [[900, 50]], []]
const BONUSES = [[10000, [10]], [10001, [20]]]
/** A Khan camp's map entry: its wall, gate and moat at AI 10 to 12. */
const campAI = (x, y) => [KHAN_CAMP, x, y, 0, 0, 0, 0, 0, 0, 0, 40, 50, 60]

/**
 * attack.js against a game that has `spies` spies in the castle and whose attack screens show `reports` in turn (the
 * last one again after that). `csm` answers the spies; the default sends them on a 30 s trip.
 */
function spyGame({ spies = 20, reports = [REPORT], csm = () => [{ A: { M: { TT: 30, PT: 0, TA: [KHAN_CAMP, 300, 400] } } }, 0], pegasusTicket = 0 } = {}) {
    const bot = fakeBot()
    bot.playerInfo.level = 70
    let screens = 0
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p, Date.now()])
        const reply = {
            ssi: () => [{ TX: p.TX, TY: p.TY, AS: spies }, 0],
            csm,
            adi: () => [{ SCID: 4, gui: { I: [[9, 120]] }, gaa: { AI: campAI(p.TX, p.TY) }, gli: { C: [{ ID: 3 }] },
                S: reports[Math.min(screens++, reports.length - 1)], B: { AIE: BONUSES } }, 0],
            dcl: () => [{}, 0],
        }[cmd]?.()
        if (reply)
            setTimeout(() => bot.xtHandler.emit(cmd, ...reply), 10)
    }
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    const { mod } = loadModule("plugins/attack/attack.js", {
        bot, items: { horses },
        extra: { protocols: { resources: { pegasusTicket }, movementEvents: new EventEmitter(), ClassTypes: { Lord, UnitInventory }, lookTurn: task => task() } },
    })
    const sent = cmd => bot.sent.filter(([name]) => name == cmd)
    return { ...mod, bot, sent }
}

const quiet = () => ["log", "debug", "warn"].forEach(level => vi.spyOn(console, level).mockImplementation(() => {}))
const spyOn = (engine, options = {}) =>
    engine.waitToAttack(turn => engine.spyTarget(turn, { castle: castle(), areaInfo: target(), kingdomID: 0, commander: known, horse: {}, ...options }), "attackKhan")

describe("spying a target for wave 1", () => {
    test("sends every spy, lets the queue go on while they travel, then reads the report off a fresh attack screen", async () => {
        vi.useFakeTimers()
        quiet()
        const engine = spyGame()
        const spying = spyOn(engine)
        let otherRanAt
        const other = engine.waitToAttack(async () => (otherRanAt = Date.now(), true), "attackForeign")
        await vi.advanceTimersByTimeAsync(2 * 60_000)
        const spied = await spying
        await other

        expect(engine.sent("csm").map(([, p]) => p)).toEqual([{ SID: 4, TX: 300, TY: 400, SC: 20, ST: 0, SE: 100, HBW: -1, KID: 0, PTT: 0, SD: 0 }])
        const [[, , spiesSentAt]] = engine.sent("csm")
        const [[, , reopenedAt]] = engine.sent("adi")
        expect(reopenedAt - spiesSentAt, "the screen is opened once the spies have landed").toBeGreaterThanOrEqual(30_000)
        expect(otherRanAt, "another plugin's attack ran while the spies travelled").toBeLessThan(reopenedAt)
        expect(spied.report).toEqual({ spy: REPORT, targetEffects: BONUSES, structure: { wall: 40, gate: 50, moat: 60 }, target: { kingdom: 0, areaType: KHAN_CAMP } })
        expect(spied.lord).toMatchObject({ lordID: 3, fromScreen: true })
    })

    test("spies again while the screen shows no report, and gives up with NO_SPY_REPORT after 10 tries", async () => {
        vi.useFakeTimers()
        quiet()
        const engine = spyGame({ reports: [undefined] })
        const spying = spyOn(engine).catch(e => e)
        await vi.advanceTimersByTimeAsync(20 * 60_000)
        expect(await spying).toBe("NO_SPY_REPORT")
        expect(engine.sent("csm")).toHaveLength(10)
        expect(engine.sent("adi")).toHaveLength(10)
    })

    test("a report on the third try ends the spying there", async () => {
        vi.useFakeTimers()
        quiet()
        const engine = spyGame({ reports: [[], [[], [], [], []], REPORT] })
        const spying = spyOn(engine)
        await vi.advanceTimersByTimeAsync(5 * 60_000)
        expect((await spying).report.spy).toEqual(REPORT)
        expect(engine.sent("csm")).toHaveLength(3)
    })

    test("with no spies in the castle nothing is sent, and it is NO_SPY_REPORT", async () => {
        vi.useFakeTimers()
        quiet()
        const engine = spyGame({ spies: 0 })
        const spying = spyOn(engine).catch(e => e)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(await spying).toBe("NO_SPY_REPORT")
        expect(engine.sent("csm")).toEqual([])
        expect(console.warn.mock.calls.map(([key]) => key)).toContain("spyWaveNoSpies")
    })

    test("the game saying the spies ran out (NOT_ENOUGH_SPIES) is NO_SPY_REPORT too, with no second try", async () => {
        vi.useFakeTimers()
        quiet()
        const engine = spyGame({ csm: () => [{}, 105] })
        const spying = spyOn(engine).catch(e => e)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(await spying).toBe("NO_SPY_REPORT")
        expect(engine.sent("csm")).toHaveLength(1)
        expect(engine.sent("adi")).toEqual([])
    })

    test("a feather only when the plugin's horse is the feather and one is left; otherwise the coin horse with the best spy speed when a horse is chosen", async () => {
        vi.useFakeTimers()
        quiet()
        const ride = async (horse, pegasusTicket) => {
            const engine = spyGame({ pegasusTicket })
            const spying = spyOn(engine, { horse })
            await vi.advanceTimersByTimeAsync(2 * 60_000)
            await spying
            const [[, { HBW, PTT }]] = engine.sent("csm")
            return { HBW, PTT }
        }
        expect(await ride({ useFeather: true }, 5)).toEqual({ HBW: -1, PTT: 1 })
        expect(await ride({ useFeather: true }, 0)).toEqual({ HBW: 1, PTT: 0 })
        expect(await ride({ useCoin: true }, 5)).toEqual({ HBW: 1, PTT: 0 })
        expect(await ride({}, 5)).toEqual({ HBW: -1, PTT: 0 })
    })

    test("a dry run sends no spies and opens no screen; wave 1 is planned from the target's map entry alone", async () => {
        quiet()
        const engine = spyGame()
        const areaInfo = { ...target(), extraData: campAI(300, 400).slice(3) }
        const spied = await engine.waitToAttack(turn => engine.spyTarget(turn, { castle: castle(), areaInfo, kingdomID: 0, commander: known, horse: {}, dryRun: true }), "attackKhan")
        expect(engine.bot.sent).toEqual([])
        expect(spied.lord).toBe(known)
        expect(spied.report).toEqual({ spy: [], targetEffects: [], structure: { wall: 40, gate: 50, moat: 60 }, target: { kingdom: 0, areaType: KHAN_CAMP } })
        expect(console.log.mock.calls.map(([key]) => key)).toContain("dryRunSpy")
    })
})

describe("putting the planned wave 1 into the attack", () => {
    const unit = (wodID, amount, info) => ({ amount, unitInfo: { wodID, ...info } })
    const inventory = () => [
        unit(10, 1000, { fightType: "0", role: "ranged", rangeAttack: "20" }),
        unit(1, 1000, { fightType: "0", role: "melee", meleeAttack: "20" }),
        unit(614, 100, { typ: "Attack", slotTypes: "1,2", wallBonus: "10" }),
        unit(611, 100, { typ: "Attack", slotTypes: "1", gateBonus: "10" }),
    ]
    const report = { spy: [], targetEffects: [], structure: { wall: 30, gate: 20, moat: 0 }, target: { kingdom: 0, areaType: KHAN_CAMP } }
    const LEVEL = 70
    const thrown = run => {
        try {
            run()
        } catch (e) {
            return e
        }
    }

    test("wave 1 gets its troops and tools before the plugin's own waves, and the plugin's wave 1 goes back to the castle", () => {
        const { spyWave, getAttackInfo } = spyGame()
        const units = inventory()
        const wave = spyWave(report, { inventory: units, level: LEVEL, effects: {} })
        // At level 70 a flank holds 64 troops and the front 192, so 320 archers are taken before the plugin builds.
        expect(units[0].amount).toBe(680)

        const attackInfo = getAttackInfo(0, castle(), target(), known, LEVEL, 2, {}, 0)
        attackInfo.A[0].L.U[0] = [1, 50]
        attackInfo.A[1].L.U[0] = [1, 50]
        units[1].amount -= 100
        wave.place(attackInfo)

        expect(attackInfo.A[0].L).toEqual({ T: [[614, 3], [-1, 0]], U: [[10, 64], [-1, 0]] })
        expect(attackInfo.A[0].M).toEqual({ T: [[614, 3], [611, 2], [-1, 0]], U: [[10, 192], ...Array(5).fill([-1, 0])] })
        expect(attackInfo.A[0].R).toEqual({ T: [[614, 3], [-1, 0]], U: [[10, 64], [-1, 0]] })
        expect(attackInfo.A[1].L.U[0], "later waves are the plugin's").toEqual([1, 50])
        expect(units.map(u => u.amount), "the plugin's wave 1 went back to the castle").toEqual([680, 950, 91, 98])
    })

    test("a wall the castle's tools can't cancel is NOT_ENOUGH_TOOLS, and nothing is taken", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { spyWave } = spyGame()
        const units = inventory().filter(u => u.unitInfo.wodID != 614)
        expect(thrown(() => spyWave(report, { inventory: units, level: LEVEL, effects: {} }))).toBe("NOT_ENOUGH_TOOLS")
        expect(units.map(u => u.amount)).toEqual([1000, 1000, 100])
        expect(console.warn.mock.calls.map(([key]) => key)).toContain("spyWaveToolsShort")
    })

    test("with no ranged troop it is NO_MORE_TROOPS", () => {
        const { spyWave } = spyGame()
        const units = inventory().slice(1)
        expect(thrown(() => spyWave(report, { inventory: units, level: LEVEL, effects: {} }))).toBe("NO_MORE_TROOPS")
    })
})
