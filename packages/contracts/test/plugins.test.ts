import { describe, expect, test } from "vitest"
import { PluginSettingsError, attackPluginLimit, effectivePluginConfig, normalizePluginSettings, type PluginCatalogEntry } from "../src/index.ts"

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

describe("bounded number options", () => {
    const bounded: PluginCatalogEntry[] = [{
        key: "attack", force: true, hidden: false, options: [
            { type: "Text", key: "attackDelaySeconds", default: "20", min: 15, max: 600 },
            { type: "Text", key: "attackLimit", min: 1 },
        ],
    }]
    const save = (options: Record<string, string>) => normalizePluginSettings(bounded, { attack: { enabled: true, options } })

    test("rejects values outside the range or not numbers", () => {
        expect(() => save({ attackDelaySeconds: "4.5" })).toThrow("attack.attackDelaySeconds must be between 15 and 600")
        expect(() => save({ attackDelaySeconds: "601" })).toThrow(PluginSettingsError)
        expect(() => save({ attackDelaySeconds: "abc" })).toThrow(PluginSettingsError)
    })

    test("accepts values in range and an empty value", () => {
        expect(save({ attackDelaySeconds: "20", attackLimit: "" }).attack!.options).toEqual({ attackDelaySeconds: "20", attackLimit: "" })
    })

    test("clamps values saved before the bounds existed", () => {
        const config = effectivePluginConfig(bounded, { attack: { enabled: true, options: { attackDelaySeconds: "4.5" } } })
        expect(config.attack!.attackDelaySeconds).toBe("15")
        const junk = effectivePluginConfig(bounded, { attack: { enabled: true, options: { attackDelaySeconds: "abc" } } })
        expect(junk.attack!.attackDelaySeconds).toBe("20")
    })
})

describe("attack plugin cap", () => {
    const attackers: PluginCatalogEntry[] = [
        { key: "attack", force: true, hidden: false, options: [], category: null },
        { key: "feast", force: false, hidden: false, options: [], category: null },
        ...Array.from({ length: 13 }, (_, i) => ({ key: `attack${i}`, force: false, hidden: false, options: [], category: "attack" as const })),
    ]
    const turnOn = (n: number) => ({
        feast: { enabled: true, options: {} },
        ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`attack${i}`, { enabled: true, options: {} }])),
    })

    test("maps each cap to a limit", () => {
        expect([attackPluginLimit("4"), attackPluginLimit("6"), attackPluginLimit("none")]).toEqual([4, 6, null])
    })

    test("rejects more attack plugins than the limit and counts only attack plugins", () => {
        expect(() => normalizePluginSettings(attackers, turnOn(5), 4)).toThrow("Your plan allows 4 attack plugins at once")
        expect(() => normalizePluginSettings(attackers, turnOn(4), 4)).not.toThrow()
    })

    test("disabled attack plugins don't count, and no limit allows all", () => {
        const settings = { ...turnOn(4), attack9: { enabled: false, options: {} } }
        expect(() => normalizePluginSettings(attackers, settings, 4)).not.toThrow()
        expect(() => normalizePluginSettings(attackers, turnOn(13), null)).not.toThrow()
    })
})
