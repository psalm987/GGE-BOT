import type { PluginCatalogEntry, PluginSettings } from "@gge/contracts"
import { optionsToSave, pluginFormValues, type OptionValues, type PluginFormValues } from "./plugin-values.ts"

/**
 * What a module page is editing: the values of the module's plugins for one account, and the values they started from.
 * A page makes a fresh state for each account, so one account's edits never reach another's.
 */
export type ModuleState = { baseline: PluginFormValues; values: PluginFormValues }

export type ModuleAction =
    | { type: "enabled"; plugin: string; enabled: boolean }
    | { type: "options"; plugin: string; options: OptionValues }
    | { type: "discard" }
    | { type: "saved" }

export const startModule = (entries: PluginCatalogEntry[], saved: PluginSettings = {}): ModuleState => {
    const values = pluginFormValues(entries, saved)
    return { baseline: values, values }
}

export function moduleReducer(state: ModuleState, action: ModuleAction): ModuleState {
    switch (action.type) {
        case "enabled":
            return { ...state, values: { ...state.values, [action.plugin]: { ...state.values[action.plugin]!, enabled: action.enabled } } }
        case "options":
            return { ...state, values: { ...state.values, [action.plugin]: { ...state.values[action.plugin]!, options: action.options } } }
        case "discard":
            return { ...state, values: state.baseline }
        case "saved":
            return { ...state, baseline: state.values }
    }
}

/** Which plugins differ from where they started: their switch, or any option that isn't left at its default alike in both. */
export function changedPlugins(entries: PluginCatalogEntry[], state: ModuleState): string[] {
    return entries.filter(entry => {
        const now = state.values[entry.key], was = state.baseline[entry.key]
        return now?.enabled !== was?.enabled || JSON.stringify(optionsToSave(entry, now?.options)) !== JSON.stringify(optionsToSave(entry, was?.options))
    }).map(entry => entry.key)
}

/** The account's whole plugin settings with this module's plugins replaced, for `accounts.update`. */
export function pluginsToSave(saved: PluginSettings, entries: PluginCatalogEntry[], values: PluginFormValues): PluginSettings {
    const out: PluginSettings = { ...saved }
    for (const entry of entries) {
        const value = values[entry.key]
        if (value) out[entry.key] = { enabled: entry.force || value.enabled, options: optionsToSave(entry, value.options) }
    }
    return out
}

/** How many attack plugins would be on: this module's from the form, every other module's as saved. */
export function attackPluginsOn(catalog: PluginCatalogEntry[], saved: PluginSettings, values: PluginFormValues): number {
    return catalog.filter(e => e.category === "attack" && !e.force && !e.hidden && (values[e.key] ? values[e.key]!.enabled : saved[e.key]?.enabled)).length
}
