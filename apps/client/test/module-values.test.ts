import { expect, test } from "vitest"
import type { PluginCatalogEntry } from "@gge/contracts"
import { attackPluginsOn, changedPlugins, dailyAsked, moduleReducer, pluginsToSave, startModule } from "../src/module-values.ts"

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
