import { describe, expect, test } from "vitest"
import { PluginSettingsError, effectivePluginConfig, normalizePluginSettings, type PluginCatalogEntry } from "../src/index.ts"

const catalog: PluginCatalogEntry[] = [
    {
        key: "attack", force: true, hidden: false, options: [
            { type: "Text", key: "attackDelaySeconds", default: "4.5" },
            { type: "Text", key: "attackLimit" },
        ],
    },
    {
        key: "attackNomads", force: false, hidden: false, options: [
            { type: "Label", key: "general" },
            { type: "" },
            { type: "Select", key: "eventDifficulty", selection: ["Classic", "Easy", "Hard"], default: "1" },
            { type: "Checkbox", key: "lowValueChests", default: false },
            { type: "Channel", key: "channelID" },
        ],
    },
    { key: "commander", force: false, hidden: true, options: [] },
]

describe("normalizePluginSettings", () => {
    test("accepts valid values and turns a numeric-string select into its index", () => {
        const out = normalizePluginSettings(catalog, {
            attackNomads: { enabled: true, options: { eventDifficulty: "2", lowValueChests: true, channelID: "123" } },
        })
        expect(out.attackNomads).toEqual({ enabled: true, options: { eventDifficulty: 2, lowValueChests: true, channelID: "123" } })
    })

    test("force plugins are always enabled", () => {
        const out = normalizePluginSettings(catalog, { attack: { enabled: false, options: {} } })
        expect(out.attack!.enabled).toBe(true)
    })

    test.each([
        ["an unknown plugin", { nope: { enabled: true, options: {} } }],
        ["a hidden plugin", { commander: { enabled: true, options: {} } }],
        ["an unknown option", { attackNomads: { enabled: true, options: { bogus: 1 } } }],
        ["a value on a label", { attackNomads: { enabled: true, options: { general: "x" } } }],
        ["a checkbox given a string", { attackNomads: { enabled: true, options: { lowValueChests: "yes" } } }],
        ["a select index out of range", { attackNomads: { enabled: true, options: { eventDifficulty: 7 } } }],
        ["text given a number", { attack: { enabled: true, options: { attackLimit: 5 } } }],
    ])("rejects %s", (_, settings) => {
        expect(() => normalizePluginSettings(catalog, settings as never)).toThrow(PluginSettingsError)
    })
})

describe("effectivePluginConfig", () => {
    test("gives each enabled plugin its defaults under saved values, in the shape workers read", () => {
        const config = effectivePluginConfig(catalog, {
            attackNomads: { enabled: true, options: { lowValueChests: true } },
        })
        expect(config).toEqual({
            attack: { state: true, attackDelaySeconds: "4.5" },
            attackNomads: { state: true, eventDifficulty: "1", lowValueChests: true },
        })
    })

    test("leaves out disabled plugins and settings for plugins no longer in the catalog", () => {
        const config = effectivePluginConfig(catalog, {
            attackNomads: { enabled: false, options: {} },
            removedPlugin: { enabled: true, options: {} },
        })
        expect(Object.keys(config)).toEqual(["attack"])
    })
})
