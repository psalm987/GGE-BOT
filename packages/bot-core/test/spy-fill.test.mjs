import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { planSpyWave, structureOf, wallOrGateLeft } = require("../spyFill.js")

const unit = (wodID, amount, info) => ({ amount, unitInfo: { wodID, ...info } })
const ranged = (wodID, amount, rangeAttack) => unit(wodID, amount, { fightType: "0", role: "ranged", rangeAttack: String(rangeAttack) })
const melee = (wodID, amount) => unit(wodID, amount, { fightType: "0", role: "melee", meleeAttack: "50" })
const tool = (wodID, amount, info) => unit(wodID, amount, { typ: "Attack", slotTypes: "1,2", name: "Workshop", ...info })

const ARCHER = 10, CROSSBOW = 11, SWORD = 1
const LADDER = 614, ELITE_LADDER = 700, EVENT_LADDER = 701, TOWER = 702, RAM = 611, FORTIFIED_RAM = 612, MANTLET = 615

/** The target's defence tools a spy report names, by wodID, as the items file lists them. */
const defence = {
    500: { wodID: 500, wallBonus: "5" },
    501: { wodID: 501, defRangeBonus: "50" },
    502: { wodID: 502, gateBonus: "20" },
    900: { wodID: 900, role: "ranged" },
}
const unitInfo = id => defence[id]

const report = {
    spy: [[[500, 2], [501, 1], [900, 100]], [[502, 1], [900, 80]], [[900, 50]], []],
    targetEffects: [[10000, [10]], [10001, [20]], [10004, [20]], [10007, [10]]],
}
const plan = (overrides = {}) => planSpyWave({
    ...report,
    structure: { wall: 20, gate: 30 },
    effects: { wallReduction: 10 },
    inventory: [
        ranged(ARCHER, 1000, 20), ranged(CROSSBOW, 100, 40), melee(SWORD, 5000),
        tool(LADDER, 100, { wallBonus: "10" }), tool(ELITE_LADDER, 100, { wallBonus: "10", name: "Elitetool" }),
        tool(RAM, 100, { gateBonus: "10", slotTypes: "1" }), tool(MANTLET, 100, { defRangeBonus: "10" }),
    ],
    room: { flankUnits: 60, frontUnits: 120, flankTools: 30, frontTools: 40 },
    slots: { flankTools: 2, frontTools: 3 },
    target: { kingdom: 0, areaType: 35 },
    unitInfo,
    ...overrides,
})
const ids = side => ({
    troop: side.troop && [side.troop.unit.unitInfo.wodID, side.troop.amount],
    tools: side.tools.map(({ unit, amount }) => [unit.unitInfo.wodID, amount]),
})

describe("wave 1 from a spy report", () => {
    test("each side gets one ranged troop and just enough tools for its wall, the front's gate, and the ranged defence", () => {
        const wave = plan()
        // Left: wall 20 + 10 (bonus) + 2 x 5 (spied) - 10 (commander) = 30; ranged 100 + 20 + 10 + 50 (spied) = 180.
        expect(ids(wave.L)).toEqual({ troop: [ARCHER, 60], tools: [[ELITE_LADDER, 3], [MANTLET, 18]] })
        // Front: wall 20; gate 30 + 20 + 20 (spied) = 70; ranged 130.
        expect(ids(wave.M)).toEqual({ troop: [ARCHER, 120], tools: [[ELITE_LADDER, 2], [RAM, 7], [MANTLET, 13]] })
        expect(ids(wave.R)).toEqual({ troop: [ARCHER, 60], tools: [[ELITE_LADDER, 2], [MANTLET, 13]] })
        expect(wallOrGateLeft(wave)).toBe(false)
    })

    test("the troop is the strongest ranged one the castle has enough of for the whole wave, else the strongest", () => {
        expect(ids(plan().L).troop, "100 crossbows can't fill 240 places").toEqual([ARCHER, 60])
        const short = plan({ inventory: [ranged(ARCHER, 100, 20), ranged(CROSSBOW, 150, 40), melee(SWORD, 5000)] })
        expect([short.L, short.M, short.R].map(side => ids(side).troop)).toEqual([[CROSSBOW, 60], [CROSSBOW, 90], undefined])
        expect(plan({ inventory: [melee(SWORD, 5000)] }).L.troop).toBeUndefined()
    })

    test("among tools that cancel a defence alone the highest bonus goes first, with event and elite tools ahead at the same bonus", () => {
        const wave = plan({ inventory: [
            ranged(ARCHER, 1000, 20), tool(TOWER, 1, { wallBonus: "25" }),
            tool(LADDER, 100, { wallBonus: "10" }), tool(EVENT_LADDER, 100, { wallBonus: "10", name: "Eventtool" }),
        ] })
        expect(ids(wave.L).tools, "one tower can't cancel 30 alone").toEqual([[EVENT_LADDER, 3]])
    })

    test("when no tool cancels it alone, the one kind that cancels the most fills the room, and the wall is left standing", () => {
        const wave = plan({ inventory: [ranged(ARCHER, 1000, 20), tool(TOWER, 1, { wallBonus: "25" }), tool(LADDER, 2, { wallBonus: "10" })] })
        expect(ids(wave.L).tools).toEqual([[TOWER, 1]])
        expect(wave.L.uncancelled.wall).toBe(5)
        expect(wallOrGateLeft(wave)).toBe(true)
    })

    test("a gate left standing counts too, but ranged defence left over does not", () => {
        const noRams = plan({ inventory: [ranged(ARCHER, 1000, 20), tool(LADDER, 100, { wallBonus: "10" }), tool(MANTLET, 100, { defRangeBonus: "10" })] })
        expect(noRams.M.uncancelled.gate).toBe(70)
        expect(wallOrGateLeft(noRams)).toBe(true)
        const noMantlets = plan({ inventory: [ranged(ARCHER, 1000, 20), tool(LADDER, 100, { wallBonus: "10" }), tool(RAM, 100, { gateBonus: "10", slotTypes: "1" })] })
        expect(noMantlets.L.uncancelled.ranged).toBe(180)
        expect(wallOrGateLeft(noMantlets)).toBe(false)
    })

    test("a side never takes more tool kinds than it has slots, nor more tools than its room", () => {
        const oneSlot = plan({ slots: { flankTools: 1, frontTools: 1 } })
        expect(ids(oneSlot.L).tools).toEqual([[ELITE_LADDER, 3]])
        expect(ids(oneSlot.M).tools, "the gate needs a second kind").toEqual([[ELITE_LADDER, 2]])
        const tight = plan({ room: { flankUnits: 60, frontUnits: 120, flankTools: 10, frontTools: 40 } })
        expect(ids(tight.L).tools).toEqual([[ELITE_LADDER, 3], [MANTLET, 7]])
        expect(tight.L.uncancelled.ranged).toBe(110)
    })

    test("a tool the game limits per wave is shared by the three sides, and the stock by everything", () => {
        const wave = plan({ inventory: [
            ranged(ARCHER, 1000, 20), tool(ELITE_LADDER, 100, { wallBonus: "10", name: "Elitetool", amountPerWave: "4" }), tool(LADDER, 3, { wallBonus: "10" }),
        ] })
        expect(ids(wave.L).tools).toEqual([[ELITE_LADDER, 3]])
        expect(ids(wave.M).tools, "one elite ladder is left for the wave").toEqual([[LADDER, 2]])
        expect(ids(wave.R).tools, "one ladder is left, and one elite ladder").toEqual([[ELITE_LADDER, 1]])
        expect(wave.R.uncancelled.wall).toBe(10)
    })

    test("tools the target bars are left out", () => {
        const wave = plan({ inventory: [
            ranged(ARCHER, 1000, 20), tool(EVENT_LADDER, 100, { wallBonus: "10", name: "Eventtool", allowedToAttack: "0+29" }),
            tool(ELITE_LADDER, 100, { wallBonus: "10", name: "Elitetool", canBeUsedToAttackNPC: "0" }), tool(LADDER, 100, { wallBonus: "10" }),
        ] })
        expect(ids(wave.L).tools).toEqual([[LADDER, 3]])
    })

    test("a tool that lowers two defences counts for both", () => {
        const wave = plan({ inventory: [
            ranged(ARCHER, 1000, 20), tool(LADDER, 100, { wallBonus: "10" }),
            tool(FORTIFIED_RAM, 100, { gateBonus: "10", defRangeBonus: "5", slotTypes: "1" }), tool(MANTLET, 100, { defRangeBonus: "10" }),
        ] })
        // 7 rams take 35 off the front's ranged defence of 130.
        expect(ids(wave.M).tools).toEqual([[LADDER, 2], [FORTIFIED_RAM, 7], [MANTLET, 10]])
    })

    test("with no report the wall and gate are the target's own, its bonuses, and the commander's reduction", () => {
        const wave = plan({ spy: undefined, targetEffects: undefined, effects: {} })
        expect(ids(wave.L).tools).toEqual([[ELITE_LADDER, 2], [MANTLET, 10]])
        expect(ids(wave.M).tools).toEqual([[ELITE_LADDER, 2], [RAM, 3], [MANTLET, 10]])
    })
})

describe("the target's own wall, gate and moat", () => {
    const extraData = Array.from({ length: 12 }, (_, i) => 100 + i)
    test("sit at AI 6 to 8 for castles, 10 to 12 for Khan camps and 9 to 11 for Daimyo castles", () => {
        // extraData is AI from index 3 on.
        expect(structureOf(21, extraData)).toEqual({ wall: 103, gate: 104, moat: 105 })
        expect(structureOf(34, extraData)).toEqual({ wall: 103, gate: 104, moat: 105 })
        expect(structureOf(35, extraData)).toEqual({ wall: 107, gate: 108, moat: 109 })
        expect(structureOf(37, extraData)).toEqual({ wall: 106, gate: 107, moat: 108 })
    })
    test("a short map entry reads as no structure", () => {
        expect(structureOf(35, [1, 2])).toEqual({ wall: 0, gate: 0, moat: 0 })
    })
})
