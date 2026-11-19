import { expect, test } from "vitest"
import type { PluginCatalogEntry } from "@gge/contracts"
import { changedAdvanced, optionValues, optionsToSave } from "../src/plugin-values.ts"

const entry: PluginCatalogEntry = {
    key: "attackForeign", force: false, hidden: false, options: [
        { type: "Label", key: "general" },
        { type: "Select", key: "difficulty", selection: ["Easy", "Hard"], default: "1" },
        { type: "Number", key: "stopMinutesBefore", min: 0, max: 240, default: 30 },
        { type: "OrderedList", key: "bannerOrder", catalog: "banners", default: [660, 661], advanced: true },
        { type: "CastlePicker", key: "source" },
        { type: "Checkbox", key: "dryRun", default: false, advanced: true },
    ],
}

test("the dialog starts from saved values over defaults", () => {
    expect(optionValues(entry, { bannerOrder: [24] })).toEqual({ difficulty: 1, stopMinutesBefore: 30, bannerOrder: [24], source: undefined, dryRun: false })
})

test("only values that differ from their default are saved, a reordered list included", () => {
    const values = { difficulty: 1, stopMinutesBefore: 30, bannerOrder: [661, 660], source: null, dryRun: true }
    expect(optionsToSave(entry, values)).toEqual({ bannerOrder: [661, 660], dryRun: true })
    expect(optionsToSave(entry, { ...values, bannerOrder: [660, 661], dryRun: false })).toEqual({})
    expect(changedAdvanced(entry, values)).toBe(2)
})


const towers: PluginCatalogEntry = {
    key: "attackBarronsGreatEmpire", force: false, hidden: false, options: [
        { type: "Select", key: "horse", selection: ["No horse", "Coin horse", "Feather", "By distance"], default: 1, legacy: { from: { useFeather: false, useCoin: true }, cases: [[{ useFeather: true }, 2], [{ useCoin: true }, 1]], otherwise: 0 } },
        { type: "Select", key: "tools", selection: ["No tools", "Ladders only", "Ladders, rams and mantlets"], default: 1, legacy: { from: { useWallTools: true, useShields: false }, cases: [[{ useWallTools: false }, 0], [{ useShields: true }, 2]], otherwise: 1 } },
        { type: "Select", key: "attackWaves", selection: ["All waves", "1 wave", "2 waves", "3 waves", "4 waves"], default: 2, legacy: { from: { attackWaves: "" }, cases: [[{ attackWaves: "1" }, 1], [{ attackWaves: "2" }, 2], [{ attackWaves: "3" }, 3], [{ attackWaves: "4" }, 4]], otherwise: 0 } },
    ],
}

test.each([
    ["nothing stored", {}, { horse: 1, tools: 1, attackWaves: 2 }],
    ["a feather, shields and four waves", { useFeather: true, useCoin: false, useShields: true, attackWaves: "4" }, { horse: 2, tools: 2, attackWaves: 4 }],
    ["no horse, no wall tools and every wave", { useCoin: false, useWallTools: false, attackWaves: "" }, { horse: 0, tools: 0, attackWaves: 0 }],
])("a config stored before the Selects shows the same choices: %s", (_, stored, shown) => {
    expect(optionValues(towers, stored)).toEqual(shown)
})

test("an old config is unchanged until the player changes it, and then saves only the new options", () => {
    const stored = { useFeather: true, useCoin: false, attackWaves: "" }
    const shown = optionValues(towers, stored)
    expect(optionsToSave(towers, shown)).toEqual({ horse: 2, attackWaves: 0 })
    expect(optionsToSave(towers, { ...shown, horse: 3 })).toEqual({ horse: 3, attackWaves: 0 })
})
