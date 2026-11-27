import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ManualPlan, emptyCustomWave, emptyPlan, emptyWave } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { barons, fortress, melee, ranged, tool } = require("./harness/army-bots.cjs")
const { isManualPlan, parseArmy, presetsOf, rememberPresets, fillFromPlan } = require("../army.js")
const capture = require("./fixtures/protocol/presets-20261122.json")

afterEach(() => vi.restoreAllMocks())

const MELEE = 601, RANGED = 603, LADDER = 614, MANTLET = 615, RAM = 611, HORN = 701
const inventory = () => [
    melee(MELEE, 900), ranged(RANGED, 800),
    tool(LADDER, 400, { wallBonus: "10" }), tool(MANTLET, 400, { defRangeBonus: "10" }), tool(RAM, 400, { gateBonus: "10", slotTypes: "1,9" }),
    tool(HORN, 2, { toolCategory: "Support" }),
]
const slot = (item, amount) => ({ item, amount })
const EMPTY = [-1, 0]
const emptySide = (tools, units) => ({ T: Array(tools).fill(EMPTY), U: Array(units).fill(EMPTY) })
const emptyCraWave = { L: emptySide(2, 2), M: emptySide(3, 6), R: emptySide(2, 2) }

/** Wave 1 hits the left flank and the front with tools, wave 2 is empty, wave 3 the right flank, wave 4 the front. */
const plan = () => {
    const first = emptyCustomWave()
    first.left = { tools: [slot(LADDER, 10), slot(MANTLET, 5)], units: [slot(RANGED, 30), slot(MELEE, 10)] }
    first.front = { tools: [slot(RAM, 8), null, null], units: [slot(MELEE, 100), null, null, null, null, null] }
    const third = emptyCustomWave()
    third.right.units = [slot(MELEE, 20), null]
    const fourth = emptyCustomWave()
    fourth.front.units = [slot(RANGED, 40), null, null, null, null, null]
    return { ...emptyPlan(), waves: [first, { kind: "preset", preset: 0 }, third, fourth], ast: [HORN, null, null], rw: [slot(MELEE, 50), slot(RANGED, 25), null, null, null, null, null, null] }
}
const waves = (stored = plan()) => ({ armyMode: "waves", waves: stored, useCoin: true })

describe("a stored wave plan becomes the cra", () => {
    test("robber barons send the plan's flanks, support tools and courtyard, slot for slot", async () => {
        const { cra, castle } = await barons(waves(), { inventory: inventory() })

        expect(cra.A).toEqual([
            {
                L: { T: [[LADDER, 10], [MANTLET, 5]], U: [[RANGED, 30], [MELEE, 10]] },
                M: { T: [[RAM, 8], EMPTY, EMPTY], U: [[MELEE, 100], EMPTY, EMPTY, EMPTY, EMPTY, EMPTY] },
                R: emptySide(2, 2),
            },
            emptyCraWave,
            { ...emptyCraWave, R: { T: [EMPTY, EMPTY], U: [[MELEE, 20], EMPTY] } },
            { ...emptyCraWave, M: { T: [EMPTY, EMPTY, EMPTY], U: [[RANGED, 40], EMPTY, EMPTY, EMPTY, EMPTY, EMPTY] } },
        ])
        expect(cra.AST).toEqual([HORN, -1, -1])
        expect(cra.RW).toEqual([[MELEE, 50], [RANGED, 25], EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY])
        expect(cra).toMatchObject({ HBW: 1, PTT: 0, KID: 0, LID: 9, TX: 110, TY: 105 })
        const held = Object.fromEntries(castle.unitInventory.map(unit => [unit.unitInfo.wodID, unit.amount]))
        expect(held).toEqual({ [MELEE]: 900 - 180, [RANGED]: 800 - 95, [LADDER]: 390, [MANTLET]: 395, [RAM]: 392, [HORN]: 1 })
    })

    test("wave 4 repeats for every wave a commander adds", async () => {
        const { cra } = await barons(waves(), { inventory: inventory(), effects: { additionalWaves: 2 } })
        expect(cra.A).toHaveLength(6)
        expect(cra.A[4]).toEqual(cra.A[3])
        expect(cra.A[5]).toEqual(cra.A[3])
    })

    test("a six-wave plan sends all six waves while the commander adds two, each as written", async () => {
        const stored = plan()
        const fifth = emptyCustomWave()
        fifth.left.units = [slot(MELEE, 15), null]
        const sixth = emptyCustomWave()
        sixth.right.tools = [slot(LADDER, 7), null]
        sixth.right.units = [slot(RANGED, 12), null]
        stored.waves = [...stored.waves, fifth, sixth]
        const { cra } = await barons(waves(stored), { inventory: inventory(), effects: { additionalWaves: 2 } })
        expect(cra.A).toHaveLength(6)
        expect(cra.A[3]).toEqual({ ...emptyCraWave, M: { T: [EMPTY, EMPTY, EMPTY], U: [[RANGED, 40], EMPTY, EMPTY, EMPTY, EMPTY, EMPTY] } })
        expect(cra.A[4]).toEqual({ ...emptyCraWave, L: { T: [EMPTY, EMPTY], U: [[MELEE, 15], EMPTY] } })
        expect(cra.A[5]).toEqual({ ...emptyCraWave, R: { T: [[LADDER, 7], EMPTY], U: [[RANGED, 12], EMPTY] } })
    })

    test("a six-wave plan sends only the waves the game allows, the first four at level 70", async () => {
        const stored = plan()
        const fifth = emptyCustomWave()
        fifth.left.units = [slot(MELEE, 15), null]
        stored.waves = [...stored.waves, fifth, fifth]
        const { cra } = await barons(waves(stored), { inventory: inventory() })
        expect(cra.A).toEqual((await barons(waves(), { inventory: inventory() })).cra.A)
    })

    test("a wave copied to the rest sends the same slots in every wave", async () => {
        const stored = plan()
        stored.waves = Array.from({ length: 6 }, () => structuredClone(stored.waves[0]))
        const { cra, castle } = await barons(waves(stored), { inventory: inventory(), effects: { additionalWaves: 2 } })
        const copy = { L: { T: [[LADDER, 10], [MANTLET, 5]], U: [[RANGED, 30], [MELEE, 10]] }, M: { T: [[RAM, 8], EMPTY, EMPTY], U: [[MELEE, 100], EMPTY, EMPTY, EMPTY, EMPTY, EMPTY] }, R: emptySide(2, 2) }
        expect(cra.A).toEqual(Array(6).fill(copy))
        const held = Object.fromEntries(castle.unitInventory.map(unit => [unit.unitInfo.wodID, unit.amount]))
        expect(held).toMatchObject({ [MELEE]: 900 - 6 * 110 - 50, [RANGED]: 800 - 6 * 30 - 25, [LADDER]: 400 - 60, [MANTLET]: 400 - 30, [RAM]: 400 - 48 })
    })

    test("an amount above what a side holds fills the side, and no more", async () => {
        const stored = plan()
        stored.waves[0].left.units = [slot(RANGED, 9999), slot(MELEE, 9999)]
        stored.waves[0].left.tools = [slot(LADDER, 9999), null]
        stored.rw = [slot(MELEE, 9999), ...stored.rw.slice(1)]
        const { cra } = await barons(waves(stored), { inventory: [melee(MELEE, 5000), ranged(RANGED, 5000), ...inventory().slice(2)] })
        // A level 53 baron: 52 soldiers and 30 tools a flank, 1277 in the courtyard.
        expect(cra.A[0].L).toEqual({ T: [[LADDER, 30], EMPTY], U: [[RANGED, 52], EMPTY] })
        expect(cra.RW.slice(0, 2)).toEqual([[MELEE, 1277], EMPTY])
    })

    test("a front-only tool written on a flank is left out", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const stored = plan()
        stored.waves[0].left.tools = [slot(RAM, 10), slot(MANTLET, 5)]
        const { cra } = await barons(waves(stored), { inventory: inventory() })
        expect(cra.A[0].L.T).toEqual([EMPTY, [MANTLET, 5]])
        expect(console.warn).toHaveBeenCalledWith("armyToolWrongSide", RAM)
    })

    test("a commander with shield maidens sends no courtyard", async () => {
        const { cra } = await barons(waves(), { inventory: inventory(), effects: { AttackSupportUnits: 1 } })
        expect(cra.RW).toEqual(Array(8).fill(EMPTY))
    })

    test("a support tool the castle lacks is left out, and the rest move up", async () => {
        const stored = { ...plan(), ast: [999, HORN, null] }
        const { cra } = await barons(waves(stored), { inventory: inventory() })
        expect(cra.AST).toEqual([HORN, -1, -1])
    })

    test("fortresses send the plan too, on the horse the plugin is set to", async () => {
        const { cra } = await fortress({ ...waves(), horse: 1 }, { inventory: inventory() })
        expect(cra.A[0].L).toEqual({ T: [[LADDER, 10], [MANTLET, 5]], U: [[RANGED, 30], [MELEE, 10]] })
        expect(cra.A[3].M.U[0]).toEqual([RANGED, 40])
        expect(cra.AST).toEqual([HORN, -1, -1])
        expect(cra.RW.slice(0, 2)).toEqual([[MELEE, 50], [RANGED, 25]])
        expect(cra).toMatchObject({ HBW: 1, PTT: 0 })
    })
})

describe("a plan the castle can't fill", () => {
    test("sends nothing and takes nothing while a slot's troops are short", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { cra, castle, stopped } = await barons(waves(), { inventory: [melee(MELEE, 150), ...inventory().slice(1)] })
        expect(cra).toBeUndefined()
        expect(stopped).toEqual([])
        expect(castle.unitInventory.map(unit => unit.amount)).toEqual([150, 800, 400, 400, 400, 2])
        expect(console.warn).toHaveBeenCalledWith("armyPlanShort", String(MELEE))
    })
})

describe("a wave setting the bot can't send stops the plugin and says why", () => {
    const withPreset = () => ({ ...plan(), waves: [{ kind: "preset", preset: 3 }, ...plan().waves.slice(1)] })
    test.each([
        ["no plan", { armyMode: "waves" }, "statusArmyNoPlan", {}],
        ["an in-game preset the game doesn't list", waves(withPreset()), "statusArmyServerPreset", { preset: 3 }],
        ["a virtual preset the runner didn't find", waves({ kind: "virtual", presetId: "0b4e7c1e-2f43-4a3e-9d7e-5a0f3c2b1a10" }), "statusArmyPresetDeleted", {}],
        ["a plan with no troops", waves(emptyPlan()), "statusArmyPlanEmpty", {}],
        ["a plan that can't be read", waves({ kind: "manual", waves: [] }), "statusArmyPlanUnreadable", {}],
        ["an unknown mode", { armyMode: "both" }, "statusArmyModeUnknown", {}],
    ])("%s", async (_, options, reasonKey, params) => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        for (const run of [barons, fortress]) {
            const { cra, statuses } = await run(options, { inventory: inventory() })
            expect(cra, "autofill never stands in for a plan").toBeUndefined()
            expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey, params })
        }
    })
})

describe("an in-game preset", () => {
    afterEach(() => rememberPresets(null))
    const freshSide = (tools, units) => ({ T: Array.from({ length: tools }, () => [-1, 0]), U: Array.from({ length: units }, () => [-1, 0]) })
    const freshCra = () => ({ A: [{ L: freshSide(2, 2), M: freshSide(3, 6), R: freshSide(2, 2) }], RW: Array.from({ length: 8 }, () => [-1, 0]), AST: [-1, -1, -1] })
    const presetPlan = preset => ({ ...emptyPlan(), waves: [{ kind: "preset", preset }] })

    test("the game's list names each preset one past its slot, and unpacks it into a wave's sides", () => {
        const presets = presetsOf(capture.gas.reply)
        expect([...presets].map(([n, { name }]) => [n, name])).toEqual([[1, "shield"], [2, "wall+moat"], [3, "sand fire"], [4, "samu"]])
        expect(presets.get(1).wave.front).toEqual({ tools: [slot(26, 5), slot(25, 4), slot(27, 13)], units: [slot(216, 254), null, null, null, null, null] })
        expect(presets.get(1).wave.left).toEqual({ tools: [slot(26, 5), slot(27, 11)], units: [slot(216, 125), null] })
        expect(presets.get(4).wave.left).toEqual({ tools: [null, null], units: [null, null] })
        expect(ManualPlan.shape.waves.element.parse(presets.get(1).wave)).toEqual(presets.get(1).wave)
    })

    test("a preset with nothing in it, or one the reply can't say, is not listed", () => {
        const presets = presetsOf({ S: [{ S: 5, A: "[[],[],[],[],[],[]]", SN: "empty" }, { S: 6, A: "not json", SN: "broken" }, { S: 30, A: "[[1,1],[],[],[],[],[]]" }] })
        expect([...presets.keys()]).toEqual([])
    })

    test("a wave that names a preset sends it slot for slot, as the game's client sent it", () => {
        rememberPresets({ S: [{ ...capture.sas.payload, SN: "khan" }] })
        const attackInfo = freshCra()
        const inventory = [tool(740, 100), tool(738, 100), tool(739, 100), melee(215, 1000)]
        fillFromPlan(attackInfo, presetPlan(capture.sas.payload.S + 1), inventory, { flankUnits: 1000, frontUnits: 1000, flankTools: 100, frontTools: 100, courtyard: 0 })
        expect(attackInfo.A[0]).toEqual(capture.craFirstWave)
    })

    test("a plan whose preset the game lists is sent", async () => {
        const presets = { S: [{ S: 0, A: JSON.stringify([[], [LADDER, 10], [], [MELEE, 100], [RANGED, 30], []]), SN: "ladders" }] }
        for (const run of [barons, fortress]) {
            const { cra, statuses } = await run(waves(presetPlan(1)), { inventory: inventory(), presets })
            expect(statuses.filter(status => status.state == "error")).toEqual([])
            expect(cra.A[0].L.T[0]).toEqual([LADDER, 10])
            expect(cra.A[0].L.U[0][0]).toBe(RANGED)
        }
    })
})

describe("the bot's plan check agrees with the contracts", () => {
    const first = () => plan().waves[0]
    test.each([
        ["an empty plan", emptyPlan()],
        ["a filled plan", plan()],
        ["a fifth wave", { ...emptyPlan(), waves: [...emptyPlan().waves, { kind: "preset", preset: 0 }] }],
        ["three waves", { ...emptyPlan(), waves: emptyPlan().waves.slice(1) }],
        ["one wave", { ...emptyPlan(), waves: emptyPlan().waves.slice(3) }],
        ["twenty-five waves", { ...emptyPlan(), waves: Array.from({ length: 25 }, () => emptyWave()) }],
        ["twenty-six waves", { ...emptyPlan(), waves: Array.from({ length: 26 }, () => emptyWave()) }],
        ["no waves", { ...emptyPlan(), waves: [] }],
        ["preset 31", { ...emptyPlan(), waves: [{ kind: "preset", preset: 31 }, ...emptyPlan().waves.slice(1)] }],
        ["a third flank unit", { ...emptyPlan(), waves: [{ ...first(), left: { tools: [null, null], units: [null, null, null] } }, ...emptyPlan().waves.slice(1)] }],
        ["a missing side", { ...emptyPlan(), waves: [{ kind: "custom", left: first().left, front: first().front }, ...emptyPlan().waves.slice(1)] }],
        ["an amount of 0", { ...emptyPlan(), rw: [slot(MELEE, 0), ...emptyPlan().rw.slice(1)] }],
        ["a fractional amount", { ...emptyPlan(), rw: [slot(MELEE, 1.5), ...emptyPlan().rw.slice(1)] }],
        ["an amount past the limit", { ...emptyPlan(), rw: [slot(MELEE, 100_001), ...emptyPlan().rw.slice(1)] }],
        ["an item given as text", { ...emptyPlan(), rw: [slot("601", 5), ...emptyPlan().rw.slice(1)] }],
        ["a fourth support tool", { ...emptyPlan(), ast: [1, 2, 3, 4] }],
        ["a support tool of 0", { ...emptyPlan(), ast: [0, null, null] }],
        ["a virtual preset", { kind: "virtual", presetId: "0b4e7c1e-2f43-4a3e-9d7e-5a0f3c2b1a10" }],
        ["text", "preset 3"],
        ["nothing", null],
    ])("%s", (_, value) => {
        expect(isManualPlan(value)).toBe(ManualPlan.safeParse(value).success)
    })

    test("a config with no army mode is autofill", () => {
        expect(parseArmy({})).toEqual({ mode: "autofill" })
        expect(parseArmy({ armyMode: "autofill", waves: plan() })).toEqual({ mode: "autofill" })
    })
})

describe("what the game limits in a wave plan, as Lazy Lord's attackTemplates.js reads it", () => {
    const { loadModule } = require("./harness/load.cjs")
    const room = { flankUnits: 100, frontUnits: 100, flankTools: 50, frontTools: 50, courtyard: 0 }
    const slots = n => Array.from({ length: n }, () => [-1, 0])
    const side = (tools, units) => ({ T: slots(tools), U: slots(units) })
    const cra = (waveCount = 1) => ({
        A: Array.from({ length: waveCount }, () => ({ L: side(2, 2), M: side(3, 6), R: side(2, 2) })),
        AST: [-1, -1, -1], RW: slots(8),
    })
    const VETERAN = 720, NPC_SHIELD = 721, WARWAGON = 722
    const units = () => [
        melee(MELEE, 900), tool(VETERAN, 50, { amountPerWave: "5" }), tool(NPC_SHIELD, 50, { canBeUsedToAttackNPC: "0" }),
        tool(WARWAGON, 3, { toolCategory: "Support", effects: "9001&2" }),
    ]
    const withTools = (left, ast = [null, null, null]) => {
        const wave = emptyCustomWave()
        wave.left = { tools: left, units: [slot(MELEE, 10), null] }
        return { ...emptyPlan(), waves: [wave], ast, rw: Array(8).fill(null) }
    }
    const army = () => loadModule("army.js", { items: { effects: [{ effectID: "9001", effectTypeID: "156" }, { effectID: "9002", effectTypeID: "1" }] } }).mod

    test("a tool limited per wave (amountPerWave) is sent only up to that limit", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const attack = army().fillFromPlan(cra(), withTools([slot(VETERAN, 20), null]), units(), room, { kingdom: 0, areaType: 27 })
        expect(attack.A[0].L.T[0]).toEqual([VETERAN, 5])
    })

    test("a tool the game marks as not for NPC targets (canBeUsedToAttackNPC 0) is left out against a camp", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const attack = army().fillFromPlan(cra(), withTools([slot(NPC_SHIELD, 10), null]), units(), room, { kingdom: 0, areaType: 27 })
        expect(attack.A[0].L.T[0]).toEqual(EMPTY)
        expect(console.warn).toHaveBeenCalledWith("armyToolNotAllowed", NPC_SHIELD)
    })

    test("a support tool that adds waves (effect type 156) adds them to the attack, filled as the plan's last wave", () => {
        const attack = army().fillFromPlan(cra(1), withTools([null, null], [WARWAGON, null, null]), units(), room, { kingdom: 0, areaType: 27 })
        expect(attack.AST).toEqual([WARWAGON, -1, -1])
        expect(attack.A).toHaveLength(3)
        expect(attack.A.map(wave => wave.L.U[0])).toEqual([[MELEE, 10], [MELEE, 10], [MELEE, 10]])
    })
})

describe("toolAllowedAt and NPC targets", () => {
    const { toolAllowedAt } = require("../attackTargets.js")
    test("canBeUsedToAttackNPC 0 bars a tool from NPC targets, and not from Foreign or Bloodcrow castles, which the game treats as players", () => {
        const playerOnly = { canBeUsedToAttackNPC: "0" }
        for (const areaType of [2, 11, 17, 24, 25, 27, 29, 30, 35, 37])
            expect(toolAllowedAt(playerOnly, { kingdom: 0, areaType })).toBe(false)
        expect(toolAllowedAt(playerOnly, { kingdom: 0, areaType: 21 })).toBe(true)
        expect(toolAllowedAt(playerOnly, { kingdom: 0, areaType: 34 })).toBe(true)
        expect(toolAllowedAt({ canBeUsedToAttackNPC: "1" }, { kingdom: 0, areaType: 27 })).toBe(true)
    })
})
