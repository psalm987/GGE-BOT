import { holdsValue, type OptionValue, type PluginCatalogEntry, type PluginSetting, type PluginSettings, type ValueOptionDef } from "@gge/contracts"

export type OptionValues = Record<string, OptionValue | undefined>
export type PluginFormValues = Record<string, { enabled: boolean; options: OptionValues }>

/** A Select's default is stored as text in some plugins; the form holds its index. */
const defaultOf = (def: ValueOptionDef): OptionValue | undefined =>
    def.type === "Select" && def.default !== undefined ? Number(def.default) : def.default

const same = (a: OptionValue | undefined, b: OptionValue | undefined) =>
    a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b))

/** One plugin's values on screen: saved values over catalog defaults. */
export function optionValues(entry: PluginCatalogEntry, saved: PluginSetting["options"] = {}): OptionValues {
    const options: OptionValues = {}
    for (const def of entry.options.filter(holdsValue)) {
        const value = saved[def.key] ?? defaultOf(def)
        options[def.key] = def.type === "Select" && value !== undefined ? Number(value) : value
    }
    return options
}

/** What the API stores for one plugin: only options that differ from their default, nothing empty. */
export function optionsToSave(entry: PluginCatalogEntry, values: OptionValues = {}): PluginSetting["options"] {
    const options: PluginSetting["options"] = {}
    for (const def of entry.options.filter(holdsValue)) {
        const value = values[def.key]
        if (value === undefined || value === "" || value === null || same(value, defaultOf(def)))
            continue
        options[def.key] = value
    }
    return options
}

/** Form values for every visible plugin. */
export function pluginFormValues(catalog: PluginCatalogEntry[], saved: PluginSettings = {}): PluginFormValues {
    return Object.fromEntries(catalog.filter(e => !e.hidden).map(entry =>
        [entry.key, { enabled: entry.force || Boolean(saved[entry.key]?.enabled), options: optionValues(entry, saved[entry.key]?.options) }]))
}

export function toPluginSettings(catalog: PluginCatalogEntry[], values: PluginFormValues): PluginSettings {
    const out: PluginSettings = {}
    for (const entry of catalog.filter(e => !e.hidden)) {
        const value = values[entry.key]
        if (value)
            out[entry.key] = { enabled: entry.force || value.enabled, options: optionsToSave(entry, value.options) }
    }
    return out
}

/** Saved settings with one plugin's options replaced; its enabled state stays as saved. */
export const withPluginOptions = (saved: PluginSettings, entry: PluginCatalogEntry, values: OptionValues): PluginSettings =>
    ({ ...saved, [entry.key]: { enabled: entry.force || Boolean(saved[entry.key]?.enabled), options: optionsToSave(entry, values) } })

/** How many advanced options hold something other than their default. */
export const changedAdvanced = (entry: PluginCatalogEntry, values: OptionValues) =>
    Object.keys(optionsToSave({ ...entry, options: entry.options.filter(def => def.advanced) }, values)).length
