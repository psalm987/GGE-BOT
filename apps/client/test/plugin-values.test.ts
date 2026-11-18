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

