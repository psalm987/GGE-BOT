import { expect, test } from "vitest"
import type { PluginCatalogEntry } from "@gge/contracts"
import { attackPluginsOn, changedPlugins, commanderPlugins, commandersDiffer, dailyAsked, moduleReducer, pluginsToSave, sharedCommanders, startModule } from "../src/module-values.ts"
import { pluginFormValues } from "../src/plugin-values.ts"

const khan: PluginCatalogEntry = {
    key: "attackKhan", force: false, hidden: false, category: "attack",
    options: [{ type: "Number", key: "score", min: 0, max: 100, default: 10 }, { type: "Checkbox", key: "dryRun", default: false }],
}
const nomads: PluginCatalogEntry = { key: "attackNomads", force: false, hidden: false, category: "attack", options: [] }
const feast: PluginCatalogEntry = { key: "feast", force: false, hidden: false, options: [] }

test("each account starts from its own saved values, so one account's edits never reach another's", () => {
    const a = startModule([khan], { attackKhan: { enabled: true, options: { score: 50 } } })
    const edited = moduleReducer(a, { type: "options", plugin: "attackKhan", options: { score: 99, dryRun: true } })
    const b = startModule([khan], { attackKhan: { enabled: false, options: { score: 20 } } })
    expect(edited.values.attackKhan).toEqual({ enabled: true, options: { score: 99, dryRun: true } })
    expect(b.values.attackKhan).toEqual({ enabled: false, options: { score: 20, dryRun: false } })
    expect(changedPlugins([khan], b)).toEqual([])
    expect(a.values.attackKhan!.options.score).toBe(50)
})

test("an account with nothing saved shows the defaults, with the plugin off", () => {
    expect(startModule([khan]).values.attackKhan).toEqual({ enabled: false, options: { score: 10, dryRun: false } })
})

test("a change is seen until it is discarded or saved, and an option set back to its default is no change", () => {
    const start = startModule([khan])
    const toggled = moduleReducer(start, { type: "enabled", plugin: "attackKhan", enabled: true })
    expect(changedPlugins([khan], toggled)).toEqual(["attackKhan"])
    expect(changedPlugins([khan], moduleReducer(toggled, { type: "discard" }))).toEqual([])
    expect(changedPlugins([khan], moduleReducer(toggled, { type: "saved" }))).toEqual([])
    const typed = moduleReducer(start, { type: "options", plugin: "attackKhan", options: { score: 10, dryRun: false } })
    expect(changedPlugins([khan], typed)).toEqual([])
})

test("saving replaces this module's plugins and keeps every other plugin as saved", () => {
    const saved = { feast: { enabled: true, options: {} }, attackKhan: { enabled: false, options: {} } }
    let state = startModule([khan], saved)
    state = moduleReducer(state, { type: "enabled", plugin: "attackKhan", enabled: true })
    state = moduleReducer(state, { type: "options", plugin: "attackKhan", options: { score: 40, dryRun: false } })
    expect(pluginsToSave(saved, [khan], state.values)).toEqual({
        feast: { enabled: true, options: {} },
        attackKhan: { enabled: true, options: { score: 40 } },
    })
})

test("the attack count takes this module from the form and every other module as saved", () => {
    const catalog = [khan, nomads, feast]
    const saved = { attackNomads: { enabled: true, options: {} }, attackKhan: { enabled: false, options: {} }, feast: { enabled: true, options: {} } }
    const state = moduleReducer(startModule([khan], saved), { type: "enabled", plugin: "attackKhan", enabled: true })
    expect(attackPluginsOn(catalog, saved, state.values)).toBe(2)
    expect(attackPluginsOn(catalog, saved, startModule([khan], saved).values)).toBe(1)
})

test("the attacks a day a page asks for are those of the plugins that are on, and a plugin with no cap asks for none", () => {
    const state = startModule([khan, nomads], { attackKhan: { enabled: true, options: { score: 50 } }, attackNomads: { enabled: false, options: {} } })
    expect(dailyAsked([khan, nomads], state, "score")).toBe(50)
    expect(dailyAsked([khan, nomads], moduleReducer(state, { type: "enabled", plugin: "attackKhan", enabled: false }), "score")).toBe(0)
    expect(dailyAsked([khan, nomads], state, undefined)).toBe(0)
})

const tower = (key: string): PluginCatalogEntry => ({
    key, force: false, hidden: false, category: "attack",
    checks: [{ type: "commanders", option: "commanderWhiteList", vip: "vipCommanders" }],
    options: [{ type: "Text", key: "commanderWhiteList", default: "1-50" }, { type: "Number", key: "vipCommanders", min: 0, max: 300, default: 0 }],
})
const towers = [tower("attackBarronsGreatEmpire"), tower("attackBarronsBurningSands")]

test("the commander picker writes one list and VIP cap to every plugin of the page that sends commanders", () => {
    const start = startModule([...towers, feast])
    const picked = moduleReducer(start, { type: "commanders", plugins: commanderPlugins([...towers, feast]), set: { list: "36;2;5", vip: 3 } })
    expect(towers.map(entry => picked.values[entry.key]!.options)).toEqual([
        { commanderWhiteList: "36;2;5", vipCommanders: 3 }, { commanderWhiteList: "36;2;5", vipCommanders: 3 },
    ])
    expect(picked.values.feast).toEqual(start.values.feast)
    expect(changedPlugins(towers, picked)).toEqual(["attackBarronsGreatEmpire", "attackBarronsBurningSands"])
    expect(sharedCommanders(towers, picked.values)).toEqual({ list: "36;2;5", vip: 3 })
})

test("kingdoms saved with different lists start on the first one's, which a save gives them all", () => {
    const saved = {
        attackBarronsGreatEmpire: { enabled: true, options: { commanderWhiteList: "1;2;3" } },
        attackBarronsBurningSands: { enabled: true, options: { commanderWhiteList: "4-6" } },
    }
    const start = startModule(towers, saved)
    expect(commandersDiffer(towers, pluginFormValues(towers, saved))).toBe(true)
    expect(changedPlugins(towers, start)).toEqual([])
    expect(pluginsToSave(saved, towers, start.values)).toEqual({
        attackBarronsGreatEmpire: { enabled: true, options: { commanderWhiteList: "1;2;3" } },
        attackBarronsBurningSands: { enabled: true, options: { commanderWhiteList: "1;2;3" } },
    })
})

test("an old range and the default are the same tiles, so they are not different lists", () => {
    const saved = { attackBarronsGreatEmpire: { enabled: true, options: { commanderWhiteList: "1-99" } } }
    expect(commandersDiffer(towers, pluginFormValues(towers, saved))).toBe(false)
})
