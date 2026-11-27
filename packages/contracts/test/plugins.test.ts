import { describe, expect, test } from "vitest"
import { BUILD_PLAN_MAX_CASTLES, PluginCatalogEntry, PluginSettingsError, attackPluginLimit, buildingFitsKingdom, effectivePluginConfig, normalizePluginSettings, readLegacy, type BladeCoastSetup, type BuildPlan, type BuildingChoice, type PluginOptionDef } from "../src/index.ts"

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

const problemOf = (run: () => unknown) => {
    try { run() } catch (error) { return (error as PluginSettingsError).problem }
    return undefined
}

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
        expect(problemOf(() => save({ attackDelaySeconds: "4.5" }))).toEqual({ code: "PLUGIN_OPTION_RANGE", params: { where: "attack.attackDelaySeconds", min: 15, max: 600 } })
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
        expect(problemOf(() => normalizePluginSettings(attackers, turnOn(5), 4))).toEqual({ code: "PLUGIN_ATTACK_CAP", params: { count: 4 } })
        expect(() => normalizePluginSettings(attackers, turnOn(4), 4)).not.toThrow()
    })

    test("disabled attack plugins don't count, and no limit allows all", () => {
        const settings = { ...turnOn(4), attack9: { enabled: false, options: {} } }
        expect(() => normalizePluginSettings(attackers, settings, 4)).not.toThrow()
        expect(() => normalizePluginSettings(attackers, turnOn(13), null)).not.toThrow()
    })
})

describe("the richer option types", () => {
    const richer: PluginCatalogEntry[] = [{
        key: "attackForeign", force: false, hidden: false, options: [
            { type: "Number", key: "stopMinutesBefore", min: 0, max: 240, step: 5, unit: "minutes", default: 30 },
            { type: "OrderedList", key: "bannerOrder", catalog: "banners", default: [660, 661] },
            {
                type: "Rows", key: "reserve", default: [], columns: [
                    { key: "castle", type: "castle" },
                    { key: "troop", type: "troop" },
                    { key: "keep", type: "number", min: 0, max: 100000 },
                ],
            },
            { type: "CastlePicker", key: "source" },
            {
                type: "Rows", key: "destinations", default: [], columns: [
                    { key: "kingdom", type: "kingdom" },
                    { key: "x", type: "number", min: 0, max: 1300 },
                ],
            },
        ],
    }]
    const save = (options: Record<string, unknown>) =>
        normalizePluginSettings(richer, { attackForeign: { enabled: true, options: options as never } }).attackForeign!.options

    test("each new type is a catalog entry the API accepts", () => {
        expect(PluginCatalogEntry.array().parse(richer)).toEqual(richer)
        expect(PluginCatalogEntry.safeParse({ ...richer[0], options: [{ type: "Number", key: "n", min: 0, max: 1, unit: "parsecs" }] }).success).toBe(false)
        expect(PluginCatalogEntry.safeParse({ ...richer[0], options: [{ type: "OrderedList", key: "o", catalog: "spells", default: [] }] }).success).toBe(false)
        expect(PluginCatalogEntry.safeParse({ ...richer[0], options: [{ type: "Rows", key: "r", columns: [], default: [] }] }).success).toBe(false)
    })

    test("accepts values of the right shape", () => {
        const row = { castle: { kingdom: 0, id: 1234 }, troop: 602, keep: 500 }
        expect(save({ stopMinutesBefore: 45, bannerOrder: [661, 24, 660], reserve: [row], source: { kingdom: 2, id: 77 } }))
            .toEqual({ stopMinutesBefore: 45, bannerOrder: [661, 24, 660], reserve: [row], source: { kingdom: 2, id: 77 } })
        expect(save({ source: null, bannerOrder: [], reserve: [] })).toEqual({ source: null, bannerOrder: [], reserve: [] })
        expect(save({ destinations: [{ kingdom: 2, x: 10 }, { kingdom: 0, x: 5 }] }), "a kingdom column takes the game's kingdom ids")
            .toEqual({ destinations: [{ kingdom: 2, x: 10 }, { kingdom: 0, x: 5 }] })
    })

    test("a kingdom column refuses the kingdoms it excludes, and takes the rest", () => {
        const noBerimond = [{ ...richer[0]!, options: [{ type: "Rows", key: "rules", default: [], columns: [{ key: "to", type: "kingdom", exclude: [10] }] }] }] as never
        const saveRules = (rules: unknown) => normalizePluginSettings(noBerimond, { attackForeign: { enabled: true, options: { rules } as never } })
        expect(saveRules([{ to: 2 }]).attackForeign!.options).toEqual({ rules: [{ to: 2 }] })
        expect(() => saveRules([{ to: 10 }])).toThrow()
    })

    test("a choice column keeps the index of one of its choices, and refuses any other value", () => {
        const sends = [{ ...richer[0]!, options: [{ type: "Rows", key: "sends", default: [], columns: [{ key: "resource", type: "choice", selection: ["wood", "stone", "food"] }] }] }] as never
        const saveSends = (rows: unknown) => normalizePluginSettings(sends, { attackForeign: { enabled: true, options: { sends: rows } as never } })
        expect(saveSends([{ resource: 0 }, { resource: 2 }]).attackForeign!.options).toEqual({ sends: [{ resource: 0 }, { resource: 2 }] })
        for (const bad of [3, -1, 1.5, { kingdom: 0, id: 1 }])
            expect(problemOf(() => saveSends([{ resource: bad }]))).toEqual({ code: "PLUGIN_OPTION_CHOICE", params: { where: "attackForeign.sends[0].resource", last: 2 } })
    })

    test.each([
        ["a number out of range", { stopMinutesBefore: 241 }, "PLUGIN_OPTION_RANGE"],
        ["a number off its step", { stopMinutesBefore: 7 }, "PLUGIN_OPTION_STEP"],
        ["a number given as text", { stopMinutesBefore: "30" }, "PLUGIN_OPTION_RANGE"],
        ["an item listed twice", { bannerOrder: [660, 660] }, "PLUGIN_OPTION_LIST"],
        ["a list of names", { bannerOrder: ["Flag"] }, "PLUGIN_OPTION_LIST"],
        ["a row missing a cell", { reserve: [{ castle: { kingdom: 0, id: 1 }, troop: 602 }] }, "PLUGIN_OPTION_RANGE"],
        ["a row with an unknown column", { reserve: [{ castle: { kingdom: 0, id: 1 }, troop: 602, keep: 1, extra: 2 }] }, "PLUGIN_OPTION_ROW"],
        ["a row number out of range", { reserve: [{ castle: { kingdom: 0, id: 1 }, troop: 602, keep: -1 }] }, "PLUGIN_OPTION_RANGE"],
        ["a row item that is a castle", { reserve: [{ castle: { kingdom: 0, id: 1 }, troop: { kingdom: 0, id: 2 }, keep: 1 }] }, "PLUGIN_OPTION_ITEM"],
        ["a castle without its kingdom", { source: { id: 77 } }, "PLUGIN_OPTION_CASTLE"],
        ["a kingdom the game doesn't have", { destinations: [{ kingdom: 7, x: 10 }] }, "PLUGIN_OPTION_ITEM"],
    ])("rejects %s with a code the browser can translate", (_, options, code) => {
        expect(() => save(options)).toThrow(PluginSettingsError)
        try { save(options) } catch (error) { expect((error as PluginSettingsError).problem.code).toBe(code) }
    })

    test("gives workers the defaults, and brings a saved number back into range", () => {
        expect(effectivePluginConfig(richer, { attackForeign: { enabled: true, options: {} } }).attackForeign)
            .toEqual({ state: true, stopMinutesBefore: 30, bannerOrder: [660, 661], reserve: [], destinations: [] })
        expect(effectivePluginConfig(richer, { attackForeign: { enabled: true, options: { stopMinutesBefore: 900 } } }).attackForeign!.stopMinutesBefore).toBe(240)
        expect(effectivePluginConfig(richer, { attackForeign: { enabled: true, options: { stopMinutesBefore: "junk" } } }).attackForeign!.stopMinutesBefore).toBe(30)
    })
})

describe("options a Select replaced", () => {
    const towers: PluginCatalogEntry[] = [{
        key: "towers", force: false, hidden: false, options: [
            { type: "Select", key: "horse", selection: ["No horse", "Coin horse", "Feather"], default: 1, legacy: { from: { useFeather: false, useCoin: true }, cases: [[{ useFeather: true }, 2], [{ useCoin: true }, 1]], otherwise: 0 } },
            { type: "Select", key: "waves", selection: ["All", "1", "2"], default: 2, legacy: { from: { waves: "" }, cases: [[{ waves: "1" }, 1], [{ waves: "2" }, 2]], otherwise: 0 } },
            { type: "CastlePicker", key: "source", kingdom: 2 },
            { type: "Number", key: "radius", min: 10, max: 100, unit: "clicks", display: "slider", default: 50 },
        ],
    }]
    const defs = towers[0]!.options

    test("a stored record reads as the choice its old options made, and loses them", () => {
        expect(readLegacy(defs, { useFeather: true })).toEqual({ horse: 2 })
        expect(readLegacy(defs, { useCoin: false, waves: "" })).toEqual({ horse: 0, waves: 0 })
        expect(readLegacy(defs, { waves: "1" })).toEqual({ waves: 1 })
    })
    test("a stored choice wins over the options it replaced", () => {
        expect(readLegacy(defs, { horse: 0, useFeather: true, waves: 2 })).toEqual({ horse: 0, waves: 2 })
    })
    test("a record with neither is left alone, so the defaults apply", () => {
        expect(readLegacy(defs, {})).toEqual({})
        expect(effectivePluginConfig(towers, { towers: { enabled: true, options: {} } }).towers).toEqual({ state: true, horse: 1, waves: 2, radius: 50 })
    })
    test("saving a record that still holds the old options stores the choice instead of refusing them", () => {
        const out = normalizePluginSettings(towers, { towers: { enabled: true, options: { useFeather: true, useCoin: false, waves: "" } } })
        expect(out.towers!.options).toEqual({ horse: 2, waves: 0 })
    })
    describe("a Select that kept its own key and took over other options", () => {
        const supply: PluginCatalogEntry[] = [{
            key: "camps", force: false, hidden: false, options: [{
                type: "Select", key: "supply", selection: ["All", "Food only", "Mead only"], default: 0,
                legacy: { from: { supply: 0, foodTroopsOnly: false, useFood: true }, cases: [[{ supply: 1 }, 1], [{ supply: "1" }, 1], [{ supply: 2 }, 2], [{ supply: "2" }, 2], [{ foodTroopsOnly: true }, 1], [{ useFood: false }, 2]], otherwise: 0 },
            }],
        }]
        const read = (stored: Record<string, string | number | boolean>) => readLegacy(supply[0]!.options, stored)

        test("reads its choice again while an option it replaced is stored beside it", () => {
            expect(read({ supply: 0, foodTroopsOnly: true })).toEqual({ supply: 1 })
            expect(read({ foodTroopsOnly: true })).toEqual({ supply: 1 })
            expect(read({ supply: 0, useFood: false })).toEqual({ supply: 2 })
            expect(read({ useFood: false })).toEqual({ supply: 2 })
            expect(read({ foodTroopsOnly: false, useFood: true })).toEqual({ supply: 0 })
        })
        test("keeps a choice its own stored value makes", () => {
            expect(read({ supply: 2, foodTroopsOnly: true })).toEqual({ supply: 2 })
            expect(read({ supply: 1, useFood: false })).toEqual({ supply: 1 })
            expect(read({ supply: "2", foodTroopsOnly: true })).toEqual({ supply: 2 })
        })
        test("leaves a record with none of the options it replaced as it was", () => {
            expect(read({})).toEqual({})
            expect(read({ supply: 2 })).toEqual({ supply: 2 })
            expect(read({ supply: 0 })).toEqual({ supply: 0 })
        })
        test("saving a record that still holds the old option stores the choice instead of refusing it", () => {
            const out = normalizePluginSettings(supply, { camps: { enabled: true, options: { supply: 0, foodTroopsOnly: true } } })
            expect(out.camps!.options).toEqual({ supply: 1 })
        })
    })
    test("a Number that was a Text reads its stored string as a number in range, and an empty or unreadable one as nothing", () => {
        const score: PluginCatalogEntry[] = [{ key: "camps", force: false, hidden: false, options: [{ type: "Number", key: "score", min: 0, max: 1000, default: 0, legacy: "text" }, { type: "Number", key: "plain", min: 0, max: 9 }] }]
        const read = (stored: Record<string, string | number>) => readLegacy(score[0]!.options, stored)
        expect(read({ score: "250" })).toEqual({ score: 250 })
        expect(read({ score: "" })).toEqual({})
        expect(read({ score: "many" })).toEqual({})
        expect(read({ score: "-4" })).toEqual({ score: 0 })
        expect(read({ score: "5000" })).toEqual({ score: 1000 })
        expect(read({ score: 40 })).toEqual({ score: 40 })
        expect(read({ plain: "3" })).toEqual({ plain: "3" })
        expect(normalizePluginSettings(score, { camps: { enabled: true, options: { score: "250" } } }).camps!.options).toEqual({ score: 250 })
        expect(effectivePluginConfig(score, { camps: { enabled: true, options: { score: "" } } }).camps).toMatchObject({ score: 0 })
    })
    test("any option with a key may show only for some choices of a Select", () => {
        const defs = [
            { type: "SkipTypes", key: "skipTypes", default: null, showWhen: { key: "mode", in: [0, 2] } },
            { type: "Checkbox", key: "flag", showWhen: { key: "mode", in: [1] } },
            { type: "Label", key: "heading", showWhen: { key: "mode", in: [1] } },
        ]
        expect(PluginCatalogEntry.safeParse({ key: "camps", force: false, hidden: false, options: defs }).success).toBe(true)
        expect(PluginCatalogEntry.safeParse({ key: "camps", force: false, hidden: false, options: [{ ...defs[1], showWhen: { key: "mode", in: [] } }] }).success).toBe(false)
    })
    test("the bot gets the old choice, not the new default", () => {
        expect(effectivePluginConfig(towers, { towers: { enabled: true, options: { useCoin: false, waves: "1" } } }).towers).toMatchObject({ horse: 0, waves: 1 })
    })
})

describe("a Rows castle column that replaced a kingdom column", () => {
    const options: PluginCatalogEntry["options"] = [{
        type: "Rows", key: "targets", default: [],
        columns: [{ key: "castle", type: "castle", legacyKingdom: "kingdom" }, { key: "tool", type: "tool" }, { key: "stock", type: "number", min: 0, max: 100, default: 0 }],
    }]
    const catalog = [{ key: "buyTools", force: false, hidden: false, options }]

    test("a stored kingdom row reads as the kingdom's main castle and saves back with a castle", () => {
        const stored = { targets: [{ kingdom: 1, tool: 614, stock: 5 }] }
        const read = readLegacy(options, stored)
        expect(read).toEqual({ targets: [{ tool: 614, stock: 5, castle: { kingdom: 1, id: -1 } }] })
        expect(normalizePluginSettings(catalog, { buyTools: { enabled: true, options: read } }).buyTools!.options).toEqual(read)
    })

    test("a kingdom row sent to the API is saved as the castle it reads as", () => {
        const out = normalizePluginSettings(catalog, { buyTools: { enabled: true, options: { targets: [{ kingdom: 1, tool: 614, stock: 5 }] } } })
        expect(out.buyTools!.options).toEqual({ targets: [{ tool: 614, stock: 5, castle: { kingdom: 1, id: -1 } }] })
    })

    test("a stock of 0 is allowed", () => {
        expect(() => normalizePluginSettings(catalog, { buyTools: { enabled: true, options: { targets: [{ castle: { kingdom: 0, id: 4 }, tool: 614, stock: 0 }] } } })).not.toThrow()
    })
})

describe("a Blade Coast setup", () => {
    const setupDef: PluginOptionDef = {
        type: "BladeCoastSetup", key: "bladeSetup",
        troops: [{ type: "MeleeAttacker", nameKey: "meleeattacker_name", name: "Swordsman", recruitGroup: "attackTroops", levels: [3, 5] }],
        tools: [
            { type: "Ladder", nameKey: "ladder_name", name: "Ladder", recruitGroup: "attackTools", levels: [1, 2], roles: ["wall"] },
            { type: "Ram", nameKey: "ram_name", name: "Battering ram", recruitGroup: "attackTools", levels: [1], roles: ["gate"] },
            { type: "Mantlet", nameKey: "mantlet_name", name: "Mantlet", recruitGroup: "attackTools", levels: [1], roles: ["ranged", "wall"] },
        ],
    }
    const catalog: PluginCatalogEntry[] = [{ key: "bladeCoast", force: false, hidden: false, options: [setupDef], eventOnly: 4 }]
    const save = (value: unknown) => normalizePluginSettings(catalog, { bladeCoast: { enabled: true, options: { bladeSetup: value as never } } }).bladeCoast!.options.bladeSetup
    const full: BladeCoastSetup = { castle: { kingdom: 1, id: 1201 }, troop: "MeleeAttacker#5", tools: { wall: "Ladder#2", gate: "Ram#1", ranged: "Mantlet#1" } }

    test("saves a castle, a troop and a tool for each defence, each as a type and level the catalog offers", () => {
        expect(save(full)).toEqual(full)
        expect(PluginCatalogEntry.parse(catalog[0])).toEqual(catalog[0])
    })

    test("saves a setup still being filled in, and none at all", () => {
        const partial = { castle: null, troop: null, tools: { wall: "Ladder#1", gate: null, ranged: null } }
        expect(save(partial)).toEqual(partial)
        expect(save(null)).toBeNull()
    })

    test.each([
        ["a castle in Berimond", { ...full, castle: { kingdom: 10, id: 7 } }, "PLUGIN_OPTION_CASTLE"],
        ["a troop the catalog doesn't offer", { ...full, troop: "Knight#5" }, "PLUGIN_OPTION_ITEM"],
        ["a level the troop doesn't have", { ...full, troop: "MeleeAttacker#4" }, "PLUGIN_OPTION_ITEM"],
        ["a troop without a level", { ...full, troop: "MeleeAttacker" }, "PLUGIN_OPTION_ITEM"],
        ["a tool for a defence it doesn't lower", { ...full, tools: { ...full.tools, gate: "Ladder#1" } }, "PLUGIN_OPTION_ITEM"],
        ["one tool for two defences", { ...full, tools: { ...full.tools, wall: "Mantlet#1" } }, "PLUGIN_OPTION_ITEM"],
        ["a missing defence", { ...full, tools: { wall: "Ladder#1", gate: "Ram#1" } }, "PLUGIN_OPTION_ITEM"],
    ])("refuses %s", (_, value, code) => {
        expect(problemOf(() => save(value))).toMatchObject({ code, params: { where: expect.stringContaining("bladeCoast.bladeSetup") } })
    })

    test("reaches the bot as it was saved, and as null until the player sets it up", () => {
        expect(effectivePluginConfig(catalog, { bladeCoast: { enabled: true, options: { bladeSetup: full } } }).bladeCoast!.bladeSetup).toEqual(full)
        expect(effectivePluginConfig(catalog, { bladeCoast: { enabled: true, options: {} } }).bladeCoast).toEqual({ state: true })
    })
})

describe("a build plan", () => {
    const choice = (name: string, rest: Partial<BuildingChoice> = {}): BuildingChoice => ({
        name, nameKey: `${name.toLowerCase()}_name`, label: name, category: "CIVIL", maxLevel: 3, maxCount: 0, upgradeOnly: false, all: false,
        kingdoms: [], notKingdoms: [], areaTypes: [], requires: [[1, 0], [5, 0], [30, 0]], ...rest,
    })
    const planDef: PluginOptionDef = {
        type: "BuildPlan", key: "plan", default: [],
        buildings: [
            choice("Farm"), choice("Barracks", { category: "MILITARY", maxCount: 1 }), choice("Stable", { kingdoms: [0, 1, 2, 3], maxCount: 1 }),
            choice("Keep", { category: "CASTLE", upgradeOnly: true, maxCount: 1, notKingdoms: [10] }),
            choice("Towers", { category: "CASTLE", upgradeOnly: true, all: true, notKingdoms: [10] }),
            choice("FactionFlag", { category: "DECO", kingdoms: [10], maxLevel: 1 }),
        ],
    }
    const catalog: PluginCatalogEntry[] = [{ key: "build", force: false, hidden: false, options: [planDef] }]
    const save = (value: unknown) => normalizePluginSettings(catalog, { build: { enabled: true, options: { plan: value as never } } }).build!.options.plan
    const castle = (rows: unknown[], rest: Record<string, unknown> = {}) => ({ castle: { kingdom: 0, id: 100 }, useSkips: false, buyExpansions: false, rows, ...rest })
    const row = (building: string, level = 1, count = 1) => ({ building, level, count })
    const full: BuildPlan = [
        { castle: { kingdom: 0, id: 100 }, useSkips: true, buyExpansions: true, rows: [row("Farm", 3, 12), row("Keep", 2), row("Towers", 3)] },
        { castle: { kingdom: 10, id: 7 }, useSkips: false, buyExpansions: false, rows: [row("FactionFlag", 1, 4)] },
        { castle: { kingdom: 2, id: -1 }, useSkips: false, buyExpansions: true, rows: [] },
    ]

    test("saves each castle's rows and switches, and the catalog entry that offers the buildings", () => {
        expect(save(full)).toEqual(full)
        expect(save([])).toEqual([])
        expect(PluginCatalogEntry.parse(catalog[0])).toEqual(catalog[0])
    })

    test.each([
        ["something that isn't a plan", "Farm", "PLUGIN_OPTION_ITEM"],
        ["a castle without its switches", [{ castle: { kingdom: 0, id: 100 }, rows: [] }], "PLUGIN_OPTION_ITEM"],
        ["a field the plan doesn't have", [castle([], { payRubies: true })], "PLUGIN_OPTION_ITEM"],
        ["a row field the plan doesn't have", [castle([{ ...row("Farm"), rubies: 1 }])], "PLUGIN_OPTION_ITEM"],
        ["the same castle twice", [castle([]), castle([])], "PLUGIN_OPTION_CASTLE"],
        ["a building the catalog doesn't offer", [castle([row("Bakery")])], "PLUGIN_OPTION_ITEM"],
        ["the same building twice in a castle", [castle([row("Farm"), row("Farm", 2)])], "PLUGIN_OPTION_ITEM"],
        ["a level past the building's last", [castle([row("Farm", 4)])], "PLUGIN_OPTION_RANGE"],
        ["a level of 0", [castle([row("Farm", 0)])], "PLUGIN_OPTION_ITEM"],
        ["more than the game allows of a building", [castle([row("Barracks", 1, 2)])], "PLUGIN_OPTION_RANGE"],
        ["more than 100 of a building", [castle([row("Farm", 1, 101)])], "PLUGIN_OPTION_RANGE"],
        ["two of an upgrade-only kind", [castle([row("Keep", 2, 2)])], "PLUGIN_OPTION_RANGE"],
        ["a building of another kingdom", [castle([row("Stable")], { castle: { kingdom: 4, id: 9 } })], "PLUGIN_OPTION_ITEM"],
        ["a castle building in the Berimond camp", [castle([row("Farm")], { castle: { kingdom: 10, id: 9 } })], "PLUGIN_OPTION_ITEM"],
        ["the keep in the Berimond camp", [castle([row("Keep")], { castle: { kingdom: 10, id: 9 } })], "PLUGIN_OPTION_ITEM"],
        ["a Berimond decoration in a castle", [castle([row("FactionFlag")])], "PLUGIN_OPTION_ITEM"],
    ])("refuses %s", (_, value, code) => {
        expect(problemOf(() => save(value))).toMatchObject({ code, params: { where: expect.stringContaining("build.plan") } })
    })

    test("refuses more castles or rows than a plan holds", () => {
        const many = Array.from({ length: BUILD_PLAN_MAX_CASTLES + 1 }, (_, id) => castle([], { castle: { kingdom: 0, id } }))
        expect(problemOf(() => save(many))).toMatchObject({ code: "PLUGIN_OPTION_ROWS", params: { max: BUILD_PLAN_MAX_CASTLES } })
        expect(() => save(many.slice(1))).not.toThrow()
    })

    test("says which row was refused", () => {
        expect(problemOf(() => save([castle([row("Farm"), row("Barracks", 9)])]))).toMatchObject({ params: { where: "build.plan[0].rows[1].level", min: 1, max: 3 } })
    })

    test("a building fits a kingdom that it names, any castle when it names none, and Berimond only when it names it", () => {
        const [farm, , stable, keep, , flag] = planDef.type === "BuildPlan" ? planDef.buildings : []
        expect([0, 4, 10].map(k => buildingFitsKingdom(farm!, k))).toEqual([true, true, false])
        expect([0, 4, 10].map(k => buildingFitsKingdom(stable!, k))).toEqual([true, false, false])
        expect([0, 10].map(k => buildingFitsKingdom(keep!, k))).toEqual([true, false])
        expect([0, 10].map(k => buildingFitsKingdom(flag!, k))).toEqual([false, true])
    })

    test("reaches the bot as it was saved, and as an empty plan until the player writes one", () => {
        expect(effectivePluginConfig(catalog, { build: { enabled: true, options: { plan: full } } }).build!.plan).toEqual(full)
        expect(effectivePluginConfig(catalog, { build: { enabled: true, options: {} } }).build).toEqual({ state: true, plan: [] })
    })
})
