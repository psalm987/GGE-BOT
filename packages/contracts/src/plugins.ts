import * as z from "zod"

const key = z.string().min(1)

/** The option types plugins declare today (bot-core plugins' pluginOptions). */
export const PluginOptionDef = z.discriminatedUnion("type", [
    /** Layout gap in the settings grid; holds no value. */
    z.looseObject({ type: z.literal(""), key: z.undefined().optional() }),
    z.looseObject({ type: z.literal("Label"), key }),
    z.looseObject({ type: z.literal("Text"), key, default: z.string().optional() }),
    z.looseObject({ type: z.literal("Checkbox"), key, default: z.boolean().optional() }),
    z.looseObject({ type: z.literal("Select"), key, selection: z.array(z.string()), default: z.union([z.string(), z.number()]).optional() }),
    z.looseObject({ type: z.literal("Channel"), key, default: z.string().optional() }),
])
export type PluginOptionDef = z.infer<typeof PluginOptionDef>

export const PluginCatalogEntry = z.object({
    key,
    force: z.boolean(),
    hidden: z.boolean(),
    options: z.array(PluginOptionDef),
})
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntry>

export const OptionValue = z.union([z.string(), z.number(), z.boolean()])
export type OptionValue = z.infer<typeof OptionValue>

export const PluginSetting = z.object({
    enabled: z.boolean(),
    options: z.record(z.string(), OptionValue),
})
export type PluginSetting = z.infer<typeof PluginSetting>

export const PluginSettings = z.record(z.string(), PluginSetting)
export type PluginSettings = z.infer<typeof PluginSettings>

export class PluginSettingsError extends Error {}

function normalizeValue(def: PluginOptionDef, value: OptionValue, where: string): OptionValue {
    switch (def.type) {
        case "":
        case "Label":
            throw new PluginSettingsError(`${where} takes no value`)
        case "Text":
        case "Channel":
            if (typeof value !== "string")
                throw new PluginSettingsError(`${where} must be text`)
            return value
        case "Checkbox":
            if (typeof value !== "boolean")
                throw new PluginSettingsError(`${where} must be true or false`)
            return value
        case "Select": {
            const index = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= def.selection.length)
                throw new PluginSettingsError(`${where} must be one of 0..${def.selection.length - 1}`)
            return index
        }
    }
}

/** Checks settings a user submits against the catalog and returns them cleaned. */
export function normalizePluginSettings(catalog: PluginCatalogEntry[], settings: PluginSettings): PluginSettings {
    const byKey = new Map(catalog.map(entry => [entry.key, entry]))
    const out: PluginSettings = {}
    for (const [pluginKey, setting] of Object.entries(settings)) {
        const entry = byKey.get(pluginKey)
        if (!entry || entry.hidden)
            throw new PluginSettingsError(`unknown plugin ${pluginKey}`)
        const defs = new Map(entry.options.flatMap(def => def.key ? [[def.key, def] as const] : []))
        const options: Record<string, OptionValue> = {}
        for (const [optionKey, value] of Object.entries(setting.options)) {
            const def = defs.get(optionKey)
            if (!def)
                throw new PluginSettingsError(`unknown option ${pluginKey}.${optionKey}`)
            options[optionKey] = normalizeValue(def, value, `${pluginKey}.${optionKey}`)
        }
        out[pluginKey] = { enabled: entry.force || setting.enabled, options }
    }
    return out
}

/**
 * What a bot worker reads as botConfig.plugins: every enabled plugin (force
 * plugins always) with option defaults under the saved values. Settings for
 * plugins no longer in the catalog are ignored.
 */
export function effectivePluginConfig(catalog: PluginCatalogEntry[], settings: PluginSettings) {
    const config: Record<string, Record<string, OptionValue> & { state: true }> = {}
    for (const entry of catalog) {
        const saved = settings[entry.key]
        if (!entry.force && !saved?.enabled)
            continue
        const plugin: Record<string, OptionValue> & { state: true } = { state: true }
        for (const def of entry.options)
            if (def.type !== "" && def.type !== "Label" && def.default !== undefined)
                plugin[def.key] = def.default
        Object.assign(plugin, saved?.options)
        config[entry.key] = plugin
    }
    return config
}
