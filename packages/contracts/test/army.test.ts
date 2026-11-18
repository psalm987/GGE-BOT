import { describe, expect, test } from "vitest"
import {
    Army, ManualPlan, PluginCatalogEntry, PluginSettingsError, SkipTypes, WavePlan, effectivePluginConfig, emptyCustomWave, emptyPlan, normalizePluginSettings,
    serverPresetsIn, waveIsEmpty,
} from "../src/index.ts"

const PRESET = "0b4e7c1e-2f43-4a3e-9d7e-5a0f3c2b1a10"
const custom = () => ({ ...emptyCustomWave(), left: { tools: [{ item: 614, amount: 10 }, null], units: [{ item: 601, amount: 9999 }, null] } })
const plan = (): ManualPlan => ({ ...emptyPlan(), waves: [custom(), { kind: "preset", preset: 7 }, { kind: "preset", preset: 0 }, { kind: "preset", preset: 7 }], ast: [701, null, null] })

describe("WavePlan", () => {
    test("an empty plan is four empty waves, three support slots and eight courtyard rows", () => {
        const empty = emptyPlan()
        expect(ManualPlan.parse(empty)).toEqual(empty)
        expect(empty.waves.every(waveIsEmpty)).toBe(true)
        expect([empty.waves.length, empty.ast.length, empty.rw.length]).toEqual([4, 3, 8])
    })

    test("a custom wave has 2 tools and 2 units a flank, and 3 tools and 6 units in front", () => {
        const wave = emptyCustomWave()
        expect([wave.left.tools.length, wave.left.units.length, wave.front.tools.length, wave.front.units.length, wave.right.tools.length, wave.right.units.length]).toEqual([2, 2, 3, 6, 2, 2])
        expect(waveIsEmpty(wave)).toBe(true)
        expect(waveIsEmpty(custom())).toBe(false)
    })

    test.each([
        ["a fifth wave", { ...emptyPlan(), waves: [...emptyPlan().waves, { kind: "preset", preset: 0 }] }],
        ["preset 31", { ...emptyPlan(), waves: [{ kind: "preset", preset: 31 }, ...emptyPlan().waves.slice(1)] }],
        ["a third flank unit", { ...emptyPlan(), waves: [{ ...emptyCustomWave(), left: { tools: [null, null], units: [null, null, null] } }, ...emptyPlan().waves.slice(1)] }],
        ["an amount of 0", { ...emptyPlan(), rw: [{ item: 601, amount: 0 }, ...emptyPlan().rw.slice(1)] }],
        ["a fourth support tool", { ...emptyPlan(), ast: [1, 2, 3, 4] }],
        ["a virtual preset without an id", { kind: "virtual" }],
        ["no kind", { waves: [] }],
    ])("refuses %s", (_, value) => {
        expect(WavePlan.safeParse(value).success).toBe(false)
    })

    test("names the in-game presets it uses, once each, leaving out the empty one", () => {
        expect(serverPresetsIn(plan())).toEqual([7])
        expect(serverPresetsIn(emptyPlan())).toEqual([])
    })

    test("an army is autofill or waves, never both", () => {
        expect(Army.safeParse({ mode: "waves", waves: { kind: "virtual", presetId: PRESET } }).success).toBe(true)
        expect(Army.safeParse({ mode: "waves" }).success).toBe(false)
        expect(Army.safeParse({ mode: "autofill", autofill: { sides: ["left"], waves: "all", tools: [], unitOrder: "castle", supply: "all", minTroops: 0 } }).success).toBe(true)
    })
})

describe("SkipTypes", () => {
    test("is null to follow the Skips settings, or a list of the game's skips", () => {
        expect(SkipTypes.parse(null)).toBeNull()
        expect(SkipTypes.parse([5, 60])).toEqual([5, 60])
        expect(SkipTypes.safeParse([7]).success).toBe(false)
        expect(SkipTypes.safeParse([5, 5]).success).toBe(false)
    })
})

describe("army options in plugin settings", () => {
    const catalog: PluginCatalogEntry[] = [{
        key: "attackBarrons", force: false, hidden: false, options: [
            { type: "Checkbox", key: "attackLeft", default: false, army: "autofill" },
            { type: "ArmyMode", key: "armyMode", default: "autofill", autofill: { sides: { left: "attackLeft" }, waves: "all", tools: [] } },
            { type: "Waves", key: "waves", army: "waves" },
            { type: "SkipTypes", key: "skipTypes", default: null },
        ],
    }]
    const save = (options: Record<string, unknown>) => normalizePluginSettings(catalog, { attackBarrons: { enabled: true, options: options as never } }).attackBarrons!.options
    const problemOf = (run: () => unknown) => {
        try { run() } catch (error) { return (error as PluginSettingsError).problem }
        return undefined
    }

    test("a wave plan, an army mode and a skip list are kept as given", () => {
        expect(save({ armyMode: "waves", waves: plan(), skipTypes: [5] })).toEqual({ armyMode: "waves", waves: plan(), skipTypes: [5] })
        expect(save({ waves: { kind: "virtual", presetId: PRESET }, skipTypes: null })).toEqual({ waves: { kind: "virtual", presetId: PRESET }, skipTypes: null })
    })

    test.each([
        ["armyMode", "both"],
        ["waves", { kind: "manual", waves: [] }],
        ["waves", "preset 3"],
        ["skipTypes", [2]],
    ])("a bad %s is refused, naming the option", (option, value) => {
        expect(problemOf(() => save({ [option]: value }))).toEqual({ code: "PLUGIN_OPTION_ARMY", params: { where: `attackBarrons.${option}` } })
    })

    test("a config from before these options reaches the bot with autofill and no plan", () => {
        expect(effectivePluginConfig(catalog, { attackBarrons: { enabled: true, options: { attackLeft: true } } }).attackBarrons)
            .toEqual({ state: true, attackLeft: true, armyMode: "autofill", skipTypes: null })
    })
})
