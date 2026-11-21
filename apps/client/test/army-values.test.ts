import { expect, test } from "vitest"
import { MAX_WAVES, emptyCustomWave, emptyPlan, emptyWave, type AutofillSource, type PluginOptionDef } from "@gge/contracts"
import { autofillOf, filledSlots, planCounts, pluginsSending, withAddedWave, withCourtyard, withSlot, withSupportTool, withWave, withWaveCopiedToRest, withoutWave } from "../src/army-values.ts"

const barons: AutofillSource = {
    sides: { left: "attackLeft", front: "attackMiddle", right: "attackRight", courtyard: "attackCourtyard" },
    whenNoSides: ["left", "front", "right", "courtyard"], waves: "attackWaves", tools: ["useWallTools", "useShields"], unitOrder: "unitOrder", supply: "supply",
}
const baronDefs: PluginOptionDef[] = [
    { type: "Checkbox", key: "useWallTools", default: true },
    { type: "Checkbox", key: "useShields", default: false },
]
const glory: AutofillSource = {
    sides: { left: true, front: true, right: true, courtyard: "courtyardWave" }, waves: "all", tools: ["waveTemplate"],
    unitOrder: "unitOrder", supply: "soldiers", minTroops: "minTroopsHome",
}
const gloryDefs: PluginOptionDef[] = [{ type: "Select", key: "waveTemplate", selection: ["Wall, gate and moat", "Wall, gate and mantlet"], default: 0 }]

test("autofill reads the sides, waves and tools from the plugin's own options", () => {
    const values = { attackLeft: true, attackMiddle: true, attackRight: true, attackCourtyard: true, attackWaves: "4", useWallTools: true, useShields: true, unitOrder: 2, supply: 1 }
    expect(autofillOf(barons, baronDefs, values)).toEqual({
        sides: ["left", "front", "right", "courtyard"], waves: 4, tools: ["useWallTools", "useShields"], unitOrder: "strongest", supply: "food", minTroops: 0,
    })
})

test("with no flank picked it is what the plugin fills by itself, and an empty wave count is every wave", () => {
    expect(autofillOf(barons, baronDefs, { attackCourtyard: true, attackWaves: "" })).toMatchObject({ sides: ["left", "front", "right", "courtyard"], waves: "all", tools: [], unitOrder: "castle", supply: "all" })
})

test("a side the plugin always fills needs no option, and a Select names its tools by its choice", () => {
    expect(autofillOf(glory, gloryDefs, { courtyardWave: false, waveTemplate: 1, soldiers: 2, minTroopsHome: 500 })).toEqual({
        sides: ["left", "front", "right"], waves: "all", tools: ["Wall, gate and mantlet"], unitOrder: "castle", supply: "mead", minTroops: 500,
    })
})

test("changing a slot makes a preset wave custom and leaves the plan it came from alone", () => {
    const plan = emptyPlan()
    const wave = withSlot(plan.waves[0]!, "front", "units", 5, { item: 601, amount: 100 })
    const next = withCourtyard(withSupportTool(withWave(plan, 0, wave), 2, 701), 7, { item: 603, amount: 50 })

    expect(wave).toEqual({ ...emptyCustomWave(), front: { tools: [null, null, null], units: [null, null, null, null, null, { item: 601, amount: 100 }] } })
    expect(filledSlots(wave)).toBe(1)
    expect(filledSlots(emptyWave())).toBe(0)
    expect(planCounts(next)).toEqual({ waves: 1, total: 4, supportTools: 1, courtyard: 1 })
    expect(plan).toEqual(emptyPlan())
})

test("a virtual preset is sent by the plugins whose stored waves name it, on either army mode", () => {
    const sent = { kind: "virtual" as const, presetId: "0b4e7c1e-2f43-4a3e-9d7e-5a0f3c2b1a10" }
    const plugins = {
        attackKhan: { enabled: true, options: { waves: sent, armyMode: "waves" } },
        attackNomads: { enabled: false, options: { waves: sent } },
        attackSamurai: { enabled: true, options: { waves: emptyPlan(), castle: { kingdom: 0, id: 1 } } },
        attackForeign: { enabled: true, options: { waves: { ...sent, presetId: "9b4e7c1e-2f43-4a3e-9d7e-5a0f3c2b1a10" } } },
    }
    expect(pluginsSending(plugins, sent.presetId)).toEqual(["attackKhan", "attackNomads"])
})

test("waves are added up to 25, removed down to one, and a wave copies into every wave after it", () => {
    const written = withSlot(emptyWave(), "front", "units", 0, { item: 601, amount: 100 })
    let plan = withWave(emptyPlan(), 1, written)
    expect(withAddedWave(plan).waves).toHaveLength(5)
    for (let i = 0; i < 40; i++) plan = withAddedWave(plan)
    expect(plan.waves).toHaveLength(MAX_WAVES)

    const copied = withWaveCopiedToRest(plan, 1)
    expect(copied.waves[0]).toEqual(emptyWave())
    expect(copied.waves.slice(1).every(wave => JSON.stringify(wave) === JSON.stringify(written))).toBe(true)
    expect(copied.waves[2]).not.toBe(copied.waves[3])
    expect(planCounts(copied)).toMatchObject({ waves: 24, total: 25 })
    expect(withWaveCopiedToRest(plan, 24)).toEqual(plan)

    let small = emptyPlan()
    for (let i = 0; i < 6; i++) small = withoutWave(small, 0)
    expect(small.waves).toHaveLength(1)
    expect(withoutWave(withWave(emptyPlan(), 2, written), 2).waves).toEqual([emptyWave(), emptyWave(), emptyWave()])
})
