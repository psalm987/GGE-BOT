import * as z from "zod"
import { ArmyMode, AutofillSource, SkipTypes, WavePlan } from "./army.ts"
import { MAX_COMMANDERS, PluginCheckDef } from "./plugin-checks.ts"

const key = z.string().min(1)
/** Shows the option only while the plugin's ArmyMode option is in this mode. */
const army = ArmyMode.optional()
/** Shows the option only while the Select option it names holds one of the listed choices. */
const showWhen = z.object({ key, in: z.array(z.number().int()).min(1) }).optional()

/** One of the player's castles, as a bot reports it: the castle's object id within its kingdom. */
export const CastleRef = z.object({ kingdom: z.number().int().min(0), id: z.number().int() })
export type CastleRef = z.infer<typeof CastleRef>
/** A castle ref with this id stands for the kingdom's main castle, whichever castle that is. Old kingdom rows read as it. */
export const MAIN_CASTLE = -1
/** The game's area types of a kingdom's main castle: the main castle, an external kingdom's castle and Berimond's. */
export const MAIN_CASTLE_AREA_TYPES: readonly number[] = [1, 12, 15]

/** The game items an OrderedList picks from. */
export const ItemCatalog = z.enum(["banners", "tools", "troops", "supportTools"])
export type ItemCatalog = z.infer<typeof ItemCatalog>

/** What a Number option counts, shown after its value. */
export const NumberUnit = z.enum(["seconds", "minutes", "hours", "percent", "attacks", "troops", "rubies", "coins", "clicks", "tools"])
export type NumberUnit = z.infer<typeof NumberUnit>

/** The game's kingdoms by id: Great Empire, Burning Sands, Everwinter Glacier, Fire Peaks, Storm Islands and Berimond. */
export const KINGDOM_IDS = [0, 1, 2, 3, 4, 10] as const

const Stored = z.union([z.string(), z.number(), z.boolean()])
/**
 * What a Select means for a record stored before it existed. `from` holds the options it replaced, each with the
 * default it had. The first case whose values all match the stored ones gives the choice, else `otherwise`. A Select
 * that took over an older option's own key names that key in `from`. Such a Select reads its choice again while an
 * option it replaced under another key is stored beside it, so its own stored value is one more input to the cases.
 * Stored records are read through this and never rewritten; packages/bot-core/legacyOptions.js reads the same shape
 * for the bot.
 */
export const LegacyChoice = z.object({
    from: z.record(key, Stored),
    cases: z.array(z.tuple([z.record(key, Stored), z.number().int().min(0)])),
    otherwise: z.number().int().min(0),
})
export type LegacyChoice = z.infer<typeof LegacyChoice>

/** A column of a Rows option: a castle, a kingdom, a game item, or a bounded number. */
export const RowColumn = z.discriminatedUnion("type", [
    /** `legacyKingdom` names the kingdom column this one replaced: a stored row that has only that reads as the kingdom's main castle. */
    z.object({ key, type: z.literal("castle"), legacyKingdom: key.optional() }),
    z.object({ key, type: z.literal("kingdom") }),
    /** `orderable` lists only the items a plugin may order with coins or resources, which `GameItem.orderList` marks. */
    z.object({ key, type: z.literal("tool"), orderable: z.literal(true).optional() }),
    z.object({ key, type: z.literal("troop"), orderable: z.literal(true).optional() }),
    z.object({ key, type: z.literal("number"), min: z.number(), max: z.number(), default: z.number().optional() }),
])
export type RowColumn = z.infer<typeof RowColumn>

/** One row of a Rows option, by column key: a castle, a kingdom id, an item's wodID, or a number. */
export const RowValue = z.record(z.string(), z.union([z.number(), CastleRef]))
export type RowValue = z.infer<typeof RowValue>

/**
 * A shared bucket of the commander map: every member plugin may send the bucket's commanders. `first` members are
 * served first when several members wait for the same commander.
 */
export const CommanderBucket = z.object({ key, members: z.array(key).min(1), first: z.array(key).optional() })
export type CommanderBucket = z.infer<typeof CommanderBucket>

/**
 * An account's commander map: the owner of each commander by number, so the first entry owns commander 1. An owner is
 * a plugin's key or a bucket's key, and "" owns nothing. A list with no owner in it is no map: every plugin then
 * keeps its own commander list. bot-core's commanderMap.js reads the same shape.
 */
export const CommanderMap = z.array(z.string().max(64)).max(MAX_COMMANDERS)
export type CommanderMap = z.infer<typeof CommanderMap>

/** The option types plugins declare (bot-core plugins' pluginOptions). Any option with a key may set `showWhen`. */
export const PluginOptionDef = z.discriminatedUnion("type", [
    /** Layout gap in the settings grid; holds no value. */
    z.looseObject({ type: z.literal(""), key: z.undefined().optional() }),
    z.looseObject({ type: z.literal("Label"), key, showWhen, army }),
    /** `min` and `max` make it a number field; an empty value means "use the default". */
    z.looseObject({ type: z.literal("Text"), key, default: z.string().optional(), min: z.number().optional(), max: z.number().optional(), showWhen, army }),
    z.looseObject({ type: z.literal("Checkbox"), key, default: z.boolean().optional(), showWhen, army }),
    /** `copyToAll` offers to copy the choice to the other plugins of the module's page: its other kingdoms, or its other events. */
    z.looseObject({ type: z.literal("Select"), key, selection: z.array(z.string()), default: z.union([z.string(), z.number()]).optional(), legacy: LegacyChoice.optional(), copyToAll: z.literal(true).optional(), showWhen, army }),
    z.looseObject({ type: z.literal("Channel"), key, default: z.string().optional(), showWhen }),
    /**
     * `display` "slider" draws a slider beside the number field. `legacy` "text" says the option was a Text once: a
     * stored string reads as its number, brought into the range, and an empty or unreadable one as nothing stored.
     */
    z.looseObject({ type: z.literal("Number"), key, min: z.number(), max: z.number(), step: z.number().positive().optional(), unit: NumberUnit.optional(), display: z.literal("slider").optional(), default: z.number().optional(), legacy: z.literal("text").optional(), showWhen, army }),
    /** Items from `catalog` in the order the plugin tries them, as wodIDs. */
    z.looseObject({ type: z.literal("OrderedList"), key, catalog: ItemCatalog, default: z.array(z.number().int()), showWhen, army }),
    z.looseObject({ type: z.literal("Rows"), key, columns: z.array(RowColumn).min(1), default: z.array(RowValue), showWhen, army }),
    /** One of the account's castles; null until the player picks one. `kingdom` lists only that kingdom's castles. */
    z.looseObject({ type: z.literal("CastlePicker"), key, kingdom: z.number().int().min(0).optional(), default: z.null().optional(), showWhen }),
    /** The time skips this plugin may spend; null follows the account's Skips settings. */
    z.looseObject({ type: z.literal("SkipTypes"), key, default: z.null().optional(), showWhen }),
    /** Autofill or Waves. `autofill` says which options make up the autofill, for its one-line summary. */
    z.looseObject({ type: z.literal("ArmyMode"), key, default: ArmyMode.optional(), autofill: AutofillSource, showWhen }),
    /**
     * The account's commander map, with the shared buckets a commander may go to besides a plugin. `keepsOwnList` names
     * the defence plugins that keep their own commander list while the map gives them nothing.
     */
    z.looseObject({ type: z.literal("CommanderMap"), key, default: CommanderMap, buckets: z.array(CommanderBucket), keepsOwnList: z.array(key).optional(), showWhen }),
    /** A wave plan; unset until the player writes one. */
    z.looseObject({ type: z.literal("Waves"), key, default: z.undefined().optional(), showWhen, army }),
])
export type PluginOptionDef = z.infer<typeof PluginOptionDef>
/** An option that holds a value: every type but the layout gap and the label. */
export type ValueOptionDef = Exclude<PluginOptionDef, { type: "" | "Label" }>
export const holdsValue = (def: PluginOptionDef): def is ValueOptionDef => def.type !== "" && def.type !== "Label"

/** What an attack plugin attacks: a kingdom and an area type of the game. */
export const AttackTarget = z.object({ kingdom: z.number().int(), areaType: z.number().int() })
export type AttackTarget = z.infer<typeof AttackTarget>

export const PluginCatalogEntry = z.object({
    key,
    force: z.boolean(),
    hidden: z.boolean(),
    options: z.array(PluginOptionDef),
    /** "attack" plugins count toward the attack plugin cap. */
    category: z.literal("attack").nullish(),
    /** Marks the plugin's commander list option. */
    checks: z.array(PluginCheckDef).optional(),
    /** Running it ends the account's beginner or peace protection. */
    breaksPeace: z.boolean().optional(),
    /** What the plugin attacks. A wave editor offers only the tools that may attack one of these; absent means every tool. */
    targets: z.array(AttackTarget).optional(),
})

/** How many attack plugins one account may run at once. Set by an admin: a global default and a per-user override. */
export const AttackPluginCap = z.enum(["4", "6", "none"])
export type AttackPluginCap = z.infer<typeof AttackPluginCap>

/** The number of attack plugins a cap allows; null means no limit. */
export const attackPluginLimit = (cap: AttackPluginCap): number | null => cap === "none" ? null : Number(cap)

/** The game lets an account send this many attacks in any 24 hours, so the account's own daily limit is never above it. */
export const GAME_DAILY_ATTACKS = 4000

export const TOO_MANY_ATTACK_PLUGINS = "TOO_MANY_ATTACK_PLUGINS"

/** Attack plugins a settings record turns on. Force plugins don't count: nobody can turn them off. */
export const enabledAttackPlugins = (catalog: PluginCatalogEntry[], settings: PluginSettings) =>
    catalog.filter(e => e.category === "attack" && !e.force && settings[e.key]?.enabled).length
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntry>

export const OptionValue = z.union([z.string(), z.number(), z.boolean(), z.null(), CastleRef, WavePlan, z.array(z.number().int()), z.array(RowValue), CommanderMap])
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
    | { code: "PLUGIN_OPTION_ROW" | "PLUGIN_OPTION_CASTLE" | "PLUGIN_OPTION_ITEM" | "PLUGIN_OPTION_ARMY"; params: { where: string } }
    | { code: "PLUGIN_ATTACK_CAP"; params: { count: number } }

export class PluginSettingsError extends Error {
    readonly problem: PluginSettingsProblem
    constructor(problem: PluginSettingsProblem) {
        super(problem.code)
        this.problem = problem
    }
}

/**
 * A plugin's stored options as its options are today: each Select with a `legacy` rule gets its choice from the
 * options it replaced, unless a choice is stored already, and the replaced options are left out. A Select that names
 * its own key in `from` reads its choice again while another option it replaced is stored. A Number that was a Text
 * reads its stored string as a number.
 */
export function readLegacy<T extends Record<string, OptionValue | undefined>>(defs: PluginOptionDef[], stored: T): T {
    const out: Record<string, OptionValue | undefined> = { ...stored }
    const current = new Set(defs.map(def => def.key))
    for (const def of defs) {
        if (def.type === "Rows" && Array.isArray(stored[def.key])) {
            const column = def.columns.find(c => c.type === "castle" && c.legacyKingdom)
            if (column?.type === "castle" && column.legacyKingdom) {
                const old = column.legacyKingdom
                out[def.key] = (stored[def.key] as RowValue[]).map(row => {
                    if (row[column.key] !== undefined || typeof row[old] !== "number")
                        return row
                    const { [old]: kingdom, ...rest } = row
                    return { ...rest, [column.key]: { kingdom: kingdom as number, id: MAIN_CASTLE } }
                })
            }
            continue
        }
        if (def.type === "Number" && def.legacy === "text" && typeof stored[def.key] === "string") {
            const text = (stored[def.key] as string).trim()
            if (text === "" || !Number.isFinite(Number(text)))
                delete out[def.key]
            else
                out[def.key] = Math.min(Math.max(Number(text), def.min), def.max)
            continue
        }
        if (def.type !== "Select" || !def.legacy)
            continue
        const { from, cases, otherwise } = def.legacy
        const old = (name: string) => stored[name] ?? from[name]
        const replaced = Object.keys(from).filter(name => stored[name] !== undefined)
        const chosen = typeof stored[def.key] === "number" && !(def.key in from && replaced.some(name => name !== def.key))
        if (!chosen && replaced.length > 0)
            out[def.key] = cases.find(([when]) => Object.entries(when).every(([name, value]) => old(name) === value))?.[1] ?? otherwise
        for (const name of Object.keys(from))
            if (!current.has(name))
                delete out[name]
    }
    return out as T
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
        const valid = column.type === "castle" ? CastleRef.safeParse(cell).success
            : column.type === "kingdom" ? (KINGDOM_IDS as readonly unknown[]).includes(cell)
            : column.type === "number" || Number.isInteger(cell)
        if (!valid)
            throw new PluginSettingsError({ code: column.type === "castle" ? "PLUGIN_OPTION_CASTLE" : "PLUGIN_OPTION_ITEM", params: { where: at } })
        if (column.type === "number" && !inRange(cell, column.min, column.max))
            throw new PluginSettingsError({ code: "PLUGIN_OPTION_RANGE", params: { where: at, min: column.min, max: column.max } })
    }
    return parsed.data
}

function parsedArmy<T extends OptionValue>(schema: z.ZodType<T>, value: OptionValue, where: string): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success)
        throw new PluginSettingsError({ code: "PLUGIN_OPTION_ARMY", params: { where } })
    return parsed.data
}

function normalizeValue(catalog: PluginCatalogEntry[], def: PluginOptionDef, value: OptionValue, where: string): OptionValue {
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
        case "SkipTypes":
            return parsedArmy(SkipTypes, value, where)
        case "ArmyMode":
            return parsedArmy(ArmyMode, value, where)
        case "Waves":
            return parsedArmy(WavePlan, value, where)
        case "CommanderMap":
            return checkCommanderMap(catalog, def.buckets, value, where)
    }
}

/** A plugin that sends commanders: its catalog entry marks its commander list. */
export const sendsCommanders = (entry: PluginCatalogEntry) => (entry.checks ?? []).some(check => check.type === "commanders")

/** The map as it is stored: every owner a bucket or a plugin that sends commanders, and no unowned commanders at its end. */
function checkCommanderMap(catalog: PluginCatalogEntry[], buckets: CommanderBucket[], value: OptionValue, where: string): CommanderMap {
    const parsed = CommanderMap.safeParse(value)
    if (!parsed.success)
        throw new PluginSettingsError({ code: "PLUGIN_OPTION_LIST", params: { where, max: MAX_COMMANDERS } })
    const owners = new Set([...buckets.map(bucket => bucket.key), ...catalog.filter(sendsCommanders).map(entry => entry.key)])
    const stranger = parsed.data.find(owner => owner !== "" && !owners.has(owner))
    if (stranger !== undefined)
        throw new PluginSettingsError({ code: "PLUGIN_UNKNOWN", params: { plugin: stranger } })
    return parsed.data.slice(0, parsed.data.findLastIndex(owner => owner !== "") + 1)
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
        for (const [optionKey, value] of Object.entries(readLegacy(entry.options, setting.options))) {
            const def = defs.get(optionKey)
            if (!def)
                throw new PluginSettingsError({ code: "PLUGIN_OPTION_UNKNOWN", params: { plugin: pluginKey, option: optionKey } })
            options[optionKey] = normalizeValue(catalog, def, value, `${pluginKey}.${optionKey}`)
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
        Object.assign(plugin, readLegacy(entry.options, saved?.options ?? {}))
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
