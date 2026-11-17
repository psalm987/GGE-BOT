import * as z from "zod"
import { PluginCheckDef } from "./plugin-checks.ts"

const key = z.string().min(1)
/** Puts the option in the settings dialog's Advanced view. */
const advanced = z.literal(true).optional()

/** One of the player's castles, as a bot reports it: the castle's object id within its kingdom. */
export const CastleRef = z.object({ kingdom: z.number().int().min(0), id: z.number().int() })
export type CastleRef = z.infer<typeof CastleRef>

/** The game items an OrderedList picks from. */
export const ItemCatalog = z.enum(["banners", "tools", "troops", "supportTools"])
export type ItemCatalog = z.infer<typeof ItemCatalog>

/** What a Number option counts, shown after its value. */
export const NumberUnit = z.enum(["seconds", "minutes", "hours", "percent", "attacks", "troops", "rubies", "coins"])
export type NumberUnit = z.infer<typeof NumberUnit>

/** A column of a Rows option: a castle, a game item, or a bounded number. */
export const RowColumn = z.discriminatedUnion("type", [
    z.object({ key, type: z.literal("castle") }),
    z.object({ key, type: z.literal("tool") }),
    z.object({ key, type: z.literal("troop") }),
    z.object({ key, type: z.literal("number"), min: z.number(), max: z.number(), default: z.number().optional() }),
])
export type RowColumn = z.infer<typeof RowColumn>

/** One row of a Rows option, by column key: a castle, an item's wodID, or a number. */
export const RowValue = z.record(z.string(), z.union([z.number(), CastleRef]))
export type RowValue = z.infer<typeof RowValue>

/** The option types plugins declare (bot-core plugins' pluginOptions). Any option may set `advanced`. */
export const PluginOptionDef = z.discriminatedUnion("type", [
    /** Layout gap in the settings grid; holds no value. */
    z.looseObject({ type: z.literal(""), key: z.undefined().optional(), advanced }),
    z.looseObject({ type: z.literal("Label"), key, advanced }),
    /** `min` and `max` make it a number field; an empty value means "use the default". */
    z.looseObject({ type: z.literal("Text"), key, default: z.string().optional(), min: z.number().optional(), max: z.number().optional(), advanced }),
    z.looseObject({ type: z.literal("Checkbox"), key, default: z.boolean().optional(), advanced }),
    z.looseObject({ type: z.literal("Select"), key, selection: z.array(z.string()), default: z.union([z.string(), z.number()]).optional(), advanced }),
    z.looseObject({ type: z.literal("Channel"), key, default: z.string().optional(), advanced }),
    z.looseObject({ type: z.literal("Number"), key, min: z.number(), max: z.number(), step: z.number().positive().optional(), unit: NumberUnit.optional(), default: z.number().optional(), advanced }),
    /** Items from `catalog` in the order the plugin tries them, as wodIDs. */
    z.looseObject({ type: z.literal("OrderedList"), key, catalog: ItemCatalog, default: z.array(z.number().int()), advanced }),
    z.looseObject({ type: z.literal("Rows"), key, columns: z.array(RowColumn).min(1), default: z.array(RowValue), advanced }),
    /** One of the account's castles; null until the player picks one. */
    z.looseObject({ type: z.literal("CastlePicker"), key, default: z.null().optional(), advanced }),
])
export type PluginOptionDef = z.infer<typeof PluginOptionDef>
/** An option that holds a value: every type but the layout gap and the label. */
export type ValueOptionDef = Exclude<PluginOptionDef, { type: "" | "Label" }>
export const holdsValue = (def: PluginOptionDef): def is ValueOptionDef => def.type !== "" && def.type !== "Label"

export const PluginCatalogEntry = z.object({
    key,
    force: z.boolean(),
    hidden: z.boolean(),
    options: z.array(PluginOptionDef),
    /** "attack" plugins count toward the attack plugin cap. */
    category: z.literal("attack").nullish(),
    /** The settings dialog's Setup checks for this plugin. */
    checks: z.array(PluginCheckDef).optional(),
    /** Running it ends the account's beginner or peace protection. */
    breaksPeace: z.boolean().optional(),
})

/** How many attack plugins one account may run at once. Set by an admin: a global default and a per-user override. */
export const AttackPluginCap = z.enum(["4", "6", "none"])
export type AttackPluginCap = z.infer<typeof AttackPluginCap>

/** The number of attack plugins a cap allows; null means no limit. */
export const attackPluginLimit = (cap: AttackPluginCap): number | null => cap === "none" ? null : Number(cap)

export const TOO_MANY_ATTACK_PLUGINS = "TOO_MANY_ATTACK_PLUGINS"

/** Attack plugins a settings record turns on. Force plugins don't count: nobody can turn them off. */
export const enabledAttackPlugins = (catalog: PluginCatalogEntry[], settings: PluginSettings) =>
    catalog.filter(e => e.category === "attack" && !e.force && settings[e.key]?.enabled).length
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntry>

export const OptionValue = z.union([z.string(), z.number(), z.boolean(), z.null(), CastleRef, z.array(z.number().int()), z.array(RowValue)])
export type OptionValue = z.infer<typeof OptionValue>

export const PluginSetting = z.object({
    enabled: z.boolean(),
    options: z.record(z.string(), OptionValue),
})
export type PluginSetting = z.infer<typeof PluginSetting>

export const PluginSettings = z.record(z.string(), PluginSetting)
export type PluginSettings = z.infer<typeof PluginSettings>

/** Why a settings record was refused: a code and params the API turns into a translatable error. */
export type PluginSettingsProblem =
    | { code: "PLUGIN_UNKNOWN"; params: { plugin: string } }
    | { code: "PLUGIN_OPTION_UNKNOWN"; params: { plugin: string; option: string } }
    | { code: "PLUGIN_OPTION_RANGE"; params: { where: string; min: number | string; max: number | string } }
    | { code: "PLUGIN_OPTION_NO_VALUE" | "PLUGIN_OPTION_TEXT" | "PLUGIN_OPTION_BOOLEAN"; params: { where: string } }
    | { code: "PLUGIN_OPTION_CHOICE"; params: { where: string; last: number } }
    | { code: "PLUGIN_OPTION_STEP"; params: { where: string; step: number } }
    | { code: "PLUGIN_OPTION_LIST" | "PLUGIN_OPTION_ROWS"; params: { where: string; max: number } }
    | { code: "PLUGIN_OPTION_ROW" | "PLUGIN_OPTION_CASTLE" | "PLUGIN_OPTION_ITEM"; params: { where: string } }
    | { code: "PLUGIN_ATTACK_CAP"; params: { count: number } }

export class PluginSettingsError extends Error {
    readonly problem: PluginSettingsProblem
    constructor(problem: PluginSettingsProblem) {
        super(problem.code)
        this.problem = problem
    }
}

type TextDef = Extract<PluginOptionDef, { type: "Text" }>

const isBounded = (def: TextDef) => def.min !== undefined || def.max !== undefined

function checkBounds(def: TextDef, value: string, where: string) {
    if (!isBounded(def) || value === "")
        return value
    const n = Number(value)
    if (!Number.isFinite(n) || n < (def.min ?? -Infinity) || n > (def.max ?? Infinity))
        throw new PluginSettingsError({ code: "PLUGIN_OPTION_RANGE", params: { where, min: def.min ?? "-∞", max: def.max ?? "∞" } })
    return value
}

/** Brings a saved value from before the bounds existed into range. */
function clampToBounds(def: TextDef, value: OptionValue): OptionValue {
    if (!isBounded(def) || value === "")
        return value
    const n = Number(value)
    if (!Number.isFinite(n))
        return def.default ?? ""
    return String(Math.min(Math.max(n, def.min ?? -Infinity), def.max ?? Infinity))
}

const MAX_LIST = 200
const MAX_ROWS = 200

const inRange = (n: unknown, min: number, max: number): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max

/** Whether `n` sits on the step grid that starts at `min`, allowing for float error. */
const onStep = (n: number, min: number, step: number | undefined) =>
    step === undefined || Math.abs((n - min) / step - Math.round((n - min) / step)) < 1e-9

function checkRow(columns: RowColumn[], row: unknown, where: string): RowValue {
    const parsed = RowValue.safeParse(row)
    if (!parsed.success || Object.keys(parsed.data).some(k => !columns.some(c => c.key === k)))
        throw new PluginSettingsError({ code: "PLUGIN_OPTION_ROW", params: { where } })
    for (const column of columns) {
        const cell = parsed.data[column.key]
        const at = `${where}.${column.key}`
        if (column.type === "castle" ? !CastleRef.safeParse(cell).success : column.type !== "number" && !Number.isInteger(cell))
            throw new PluginSettingsError({ code: column.type === "castle" ? "PLUGIN_OPTION_CASTLE" : "PLUGIN_OPTION_ITEM", params: { where: at } })
        if (column.type === "number" && !inRange(cell, column.min, column.max))
            throw new PluginSettingsError({ code: "PLUGIN_OPTION_RANGE", params: { where: at, min: column.min, max: column.max } })
    }
    return parsed.data
}

function normalizeValue(def: PluginOptionDef, value: OptionValue, where: string): OptionValue {
    switch (def.type) {
        case "":
        case "Label":
            throw new PluginSettingsError({ code: "PLUGIN_OPTION_NO_VALUE", params: { where } })
        case "Text":
            if (typeof value !== "string")
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_TEXT", params: { where } })
            return checkBounds(def, value, where)
        case "Channel":
            if (typeof value !== "string")
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_TEXT", params: { where } })
            return value
        case "Checkbox":
            if (typeof value !== "boolean")
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_BOOLEAN", params: { where } })
            return value
        case "Select": {
            const index = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
            if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= def.selection.length)
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_CHOICE", params: { where, last: def.selection.length - 1 } })
            return index
        }
        case "Number":
            if (!inRange(value, def.min, def.max))
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_RANGE", params: { where, min: def.min, max: def.max } })
            if (!onStep(value, def.min, def.step))
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_STEP", params: { where, step: def.step! } })
            return value
        case "OrderedList":
            if (!Array.isArray(value) || value.length > MAX_LIST || !(value as unknown[]).every(Number.isInteger) || new Set(value as unknown[]).size !== value.length)
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_LIST", params: { where, max: MAX_LIST } })
            return value
        case "Rows":
            if (!Array.isArray(value) || value.length > MAX_ROWS)
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_ROWS", params: { where, max: MAX_ROWS } })
            return value.map((row, i) => checkRow(def.columns, row, `${where}[${i}]`))
        case "CastlePicker":
            if (value !== null && !CastleRef.safeParse(value).success)
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_CASTLE", params: { where } })
            return value
    }
}

/** Brings a saved value from before the bounds existed, or of another type, into range. */
function clampNumber(def: Extract<PluginOptionDef, { type: "Number" }>, value: OptionValue): OptionValue | undefined {
    const n = typeof value === "string" && value !== "" ? Number(value) : value
    if (typeof n !== "number" || !Number.isFinite(n))
        return def.default
    return Math.min(Math.max(n, def.min), def.max)
}

/**
 * Checks settings a user submits against the catalog and returns them cleaned.
 * `attackLimit` is the owner's attack plugin cap (null for none).
 */
export function normalizePluginSettings(catalog: PluginCatalogEntry[], settings: PluginSettings, attackLimit: number | null = null): PluginSettings {
    const byKey = new Map(catalog.map(entry => [entry.key, entry]))
    const out: PluginSettings = {}
    for (const [pluginKey, setting] of Object.entries(settings)) {
        const entry = byKey.get(pluginKey)
        if (!entry || entry.hidden)
            throw new PluginSettingsError({ code: "PLUGIN_UNKNOWN", params: { plugin: pluginKey } })
        const defs = new Map(entry.options.flatMap(def => def.key ? [[def.key, def] as const] : []))
        const options: Record<string, OptionValue> = {}
        for (const [optionKey, value] of Object.entries(setting.options)) {
            const def = defs.get(optionKey)
            if (!def)
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_UNKNOWN", params: { plugin: pluginKey, option: optionKey } })
            options[optionKey] = normalizeValue(def, value, `${pluginKey}.${optionKey}`)
        }
        out[pluginKey] = { enabled: entry.force || setting.enabled, options }
    }
    if (attackLimit !== null && enabledAttackPlugins(catalog, out) > attackLimit)
        throw new PluginSettingsError({ code: "PLUGIN_ATTACK_CAP", params: { count: attackLimit } })
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
            if (holdsValue(def) && def.default !== undefined)
                plugin[def.key] = def.default
        Object.assign(plugin, saved?.options)
        for (const def of entry.options) {
            if (!holdsValue(def) || plugin[def.key] === undefined)
                continue
            if (def.type === "Text")
                plugin[def.key] = clampToBounds(def, plugin[def.key]!)
            else if (def.type === "Number") {
                const clamped = clampNumber(def, plugin[def.key]!)
                if (clamped === undefined)
                    delete plugin[def.key]
                else
                    plugin[def.key] = clamped
            }
        }
        config[entry.key] = plugin
    }
    return config
}
