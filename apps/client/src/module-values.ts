import { commanderPicks, writeCommanderPicks, type PluginCatalogEntry, type PluginSettings } from "@gge/contracts"
import { optionsToSave, pluginFormValues, type OptionValues, type PluginFormValues } from "./plugin-values.ts"

/**
 * What a module page is editing: the values of the module's plugins for one account, and the values they started from.
 * A page makes a fresh state for each account, so one account's edits never reach another's.
 */
export type ModuleState = { baseline: PluginFormValues; values: PluginFormValues }

/** A plugin whose commander list (`list`) and VIP cap (`vip`) the module's one commander picker sets, by option key. */
export type CommanderPlugin = { plugin: string; list: string; vip: string | undefined }

/** The plugins of a module that send commanders, in the module's order. */
export const commanderPlugins = (entries: PluginCatalogEntry[]): CommanderPlugin[] => entries.flatMap(entry => {
    const check = entry.checks?.find(check => check.type === "commanders")
    return check ? [{ plugin: entry.key, list: check.option, vip: check.vip }] : []
})

/** One commander list and VIP cap, written to every plugin the picker sets. Left out, a value stays as it is. */
export type SharedCommanders = { list?: string; vip?: number }

export type ModuleAction =
    | { type: "enabled"; plugin: string; enabled: boolean }
    | { type: "options"; plugin: string; options: OptionValues }
    | { type: "commanders"; plugins: CommanderPlugin[]; set: SharedCommanders }
    | { type: "discard" }
    | { type: "saved" }

function withCommanders(values: PluginFormValues, plugins: CommanderPlugin[], set: SharedCommanders): PluginFormValues {
    const out = { ...values }
    for (const { plugin, list, vip } of plugins) {
        const options = { ...out[plugin]!.options }
        if (set.list !== undefined) options[list] = set.list
        if (set.vip !== undefined && vip) options[vip] = set.vip
        out[plugin] = { ...out[plugin]!, options }
    }
    return out
}

/** The list and VIP cap the picker shows: the first commander plugin's. */
export function sharedCommanders(entries: PluginCatalogEntry[], values: PluginFormValues): { list: string; vip: number } | undefined {
    const first = commanderPlugins(entries)[0]
    if (!first) return undefined
    const options = values[first.plugin]?.options ?? {}
    return { list: String(options[first.list] ?? ""), vip: first.vip ? Number(options[first.vip] ?? 0) : 0 }
}

/** Whether the module's commander plugins hold different tiles or VIP caps. "1-50" and "1-99" are the same tiles. */
export function commandersDiffer(entries: PluginCatalogEntry[], values: PluginFormValues): boolean {
    const tiles = (p: CommanderPlugin) => {
        const options = values[p.plugin]?.options ?? {}
        return `${writeCommanderPicks(commanderPicks(String(options[p.list] ?? "")))}|${p.vip ? Number(options[p.vip] ?? 0) : 0}`
    }
    return new Set(commanderPlugins(entries).map(tiles)).size > 1
}

/**
 * A module's values for one account. Its commander plugins all take the first one's list and VIP cap, which the page's
 * one picker shows, so a save gives every plugin the list the player sees.
 */
export const startModule = (entries: PluginCatalogEntry[], saved: PluginSettings = {}): ModuleState => {
    const values = pluginFormValues(entries, saved)
    const shared = sharedCommanders(entries, values)
    const start = shared ? withCommanders(values, commanderPlugins(entries), shared) : values
    return { baseline: start, values: start }
}

export function moduleReducer(state: ModuleState, action: ModuleAction): ModuleState {
    switch (action.type) {
        case "enabled":
            return { ...state, values: { ...state.values, [action.plugin]: { ...state.values[action.plugin]!, enabled: action.enabled } } }
        case "options":
            return { ...state, values: { ...state.values, [action.plugin]: { ...state.values[action.plugin]!, options: action.options } } }
        case "commanders":
            return { ...state, values: withCommanders(state.values, action.plugins, action.set) }
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

/**
 * The attacks a day the plugins that are on ask for between them, by the option that caps each one. A plugin with no
 * cap of its own (0) asks for nothing here: it runs up to the account's cap.
 */
export function dailyAsked(entries: PluginCatalogEntry[], state: ModuleState, option: string | undefined): number {
    if (option === undefined) return 0
    return entries.reduce((total, entry) => {
        const value = state.values[entry.key]
        return total + (value?.enabled ? Number(value.options[option]) || 0 : 0)
    }, 0)
}
