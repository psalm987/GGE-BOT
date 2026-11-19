import * as z from "zod"
import type { OptionValue } from "./plugins.ts"

/** What a plugin says it is doing, with a bot-namespace sentence key and its values. */
export const PluginRunState = z.enum(["running", "waiting", "stopped", "error"])
export type PluginRunState = z.infer<typeof PluginRunState>

export const PluginState = z.object({
    state: PluginRunState,
    reasonKey: z.string().max(100).nullable(),
    params: z.record(z.string(), z.union([z.string().max(200), z.number()])),
})
export type PluginState = z.infer<typeof PluginState>

/** The latest state of each plugin that reported one during the current run, by plugin key. */
export const PluginStates = z.record(z.string(), PluginState)
export type PluginStates = z.infer<typeof PluginStates>

/** A castle the bot found on the account, for castle pickers. `type` is the game's area type. */
export const AccountCastle = z.object({
    kingdom: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    type: z.number().int(),
})
export type AccountCastle = z.infer<typeof AccountCastle>

/**
 * A Setup check a plugin declares. The settings dialog runs it against the values on screen and what the bot last reported.
 * - `commanders`: the commander list in option `option` picks at least one commander, and none past the account's last.
 * - `commandersShared`: whether the list shares commanders with the same option of the other `plugins` that are on.
 * - `dailyAttacks`: how much of the daily attack limit is left.
 * - `rows`: the Rows options in `options` hold at least one row between them.
 */
export const PluginCheckDef = z.discriminatedUnion("type", [
    z.object({ type: z.literal("commanders"), option: z.string().min(1) }),
    z.object({ type: z.literal("commandersShared"), option: z.string().min(1), plugins: z.array(z.string().min(1)).min(2) }),
    z.object({ type: z.literal("dailyAttacks") }),
    z.object({ type: z.literal("rows"), options: z.array(z.string().min(1)).min(1) }),
])
export type PluginCheckDef = z.infer<typeof PluginCheckDef>

/** `info` is a check that can't be decided yet, usually because the bot isn't running. */
export type CheckLevel = "ok" | "warn" | "info"
/** `key` is a client-namespace key under "plugins.check.". */
export type CheckResult = { level: CheckLevel; key: string; params: Record<string, string | number> }

export type CheckInput = {
    /** This plugin's values as they are on screen, defaults included. */
    options: Record<string, OptionValue | undefined>
    /** Every plugin's values, by plugin key, for checks that read another plugin's settings. */
    plugins: Record<string, Record<string, OptionValue | undefined> | undefined>
    /** What the running bot last reported; empty while it isn't running. */
    pluginStates: PluginStates
    /** The plugin the checks belong to, for a check that compares it with others. */
    plugin?: string
    /** Which plugins are on, by plugin key, as the switches on screen stand. A plugin that is left out counts as on. */
    enabled?: Record<string, boolean | undefined>
    /** How many commanders the bot last counted on the account; null or left out until it has run. */
    commanders?: number | null
}

/** No account has more commanders than this, so a longer range picks no more. */
const MAX_COMMANDER_POSITION = 500

/** The game gives an account at most this many commanders. */
export const MAX_COMMANDERS = 50

/**
 * A commander list like "1-5, 9" or "1;2;3", the way bot-core's commander pool reads it: positions and ranges of
 * positions, set apart by commas or semicolons. `named` holds each position written out and each range's first, which
 * are the ones a player means exactly: a range may run past the last commander ("1-99" is every commander).
 */
export function readCommanderList(list: string): { positions: Set<number>; named: number[] } {
    const positions = new Set<number>()
    const named: number[] = []
    for (const part of list.split(/[,;]/)) {
        if (part.trim() === "")
            continue
        const [start, end = start] = part.split("-").map(Number)
        if (!Number.isInteger(start) || !Number.isInteger(end))
            continue
        if (start! <= end!)
            named.push(start!)
        for (let p = start!; p <= Math.min(end!, MAX_COMMANDER_POSITION); p++)
            positions.add(p)
    }
    return { positions, named }
}
export const commanderPositions = (list: string): Set<number> => readCommanderList(list).positions

/** The commanders an account can send: what the bot counted, never above the game's limit. Null until the bot has counted. */
const commanderLimit = (commanders: number | null | undefined) => commanders === null || commanders === undefined ? null : Math.min(commanders, MAX_COMMANDERS)

/** The positions a list sends on an account with `max` commanders. An empty list sends every commander. */
function sendable(list: string, max: number | null): Set<number> {
    const last = max ?? MAX_COMMANDERS
    if (list.trim() === "")
        return new Set(Array.from({ length: last }, (_, i) => i + 1))
    return new Set([...readCommanderList(list).positions].filter(p => p >= 1 && p <= last))
}

/**
 * How the commander lists of several plugins use an account's commanders: how many they send between them, how many
 * the account has (null until the bot has counted) and how many are left over.
 */
export function commanderUsage(lists: string[], commanders: number | null | undefined) {
    const max = commanderLimit(commanders)
    const configured = new Set(lists.flatMap(list => [...sendable(list, max)])).size
    return { configured, max, remaining: max === null ? null : max - configured }
}

const result = (level: CheckLevel, key: string, params: CheckResult["params"] = {}): CheckResult => ({ level, key, params })

/** The warning margin: under this share of the daily limit left, the check warns. */
const LOW_HEADROOM = 0.1

const RUN_CHECK: { [T in PluginCheckDef["type"]]: (def: Extract<PluginCheckDef, { type: T }>, input: CheckInput) => CheckResult } = {
    commanders(def, { options, commanders }) {
        const list = String(options[def.option] ?? "").trim()
        if (list === "")
            return result("warn", "commandersAll")
        const { positions, named } = readCommanderList(list)
        if (positions.size === 0)
            return result("warn", "commandersNone", { list })
        const max = commanderLimit(commanders)
        if (max === null)
            return result("ok", "commandersSome", { count: positions.size })
        const over = named.find(position => position > max)
        if (over !== undefined)
            return result("warn", "commandersOver", { position: over, total: max })
        const count = sendable(list, max).size
        return result("ok", "commandersOf", { count, max, remaining: max - count })
    },
    commandersShared(def, { options, plugins, plugin, enabled, commanders }) {
        const max = commanderLimit(commanders)
        const mine = sendable(String(options[def.option] ?? ""), max)
        const others = def.plugins.filter(key => key !== plugin && enabled?.[key] !== false && plugins[key])
        const shared = new Set(others.flatMap(key => [...sendable(String(plugins[key]![def.option] ?? ""), max)].filter(p => mine.has(p))))
        return shared.size === 0 ? result("ok", "commandersApart") : result("warn", "commandersShared", { count: shared.size })
    },
    rows(def, { options }) {
        const count = def.options.reduce((total, key) => total + (Array.isArray(options[key]) ? options[key].length : 0), 0)
        return count === 0 ? result("warn", "rowsNone") : result("ok", "rowsSome", { count })
    },
    dailyAttacks(_, { plugins, pluginStates }) {
        const reported = pluginStates.attack?.params
        const used = Number(reported?.used), limit = Number(reported?.limit)
        if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
            const configured = Number(plugins.attack?.attackLimit)
            return Number.isFinite(configured) && configured > 0
                ? result("info", "dailyAttacksLimit", { limit: configured })
                : result("info", "dailyAttacksUnknown")
        }
        if (used >= limit)
            return result("warn", "dailyAttacksReached", { used, limit })
        return result(limit - used < limit * LOW_HEADROOM ? "warn" : "ok", "dailyAttacksUsed", { used, limit })
    },
}

export const runChecks = (checks: PluginCheckDef[], input: CheckInput): CheckResult[] =>
    checks.map(def => (RUN_CHECK[def.type] as (def: PluginCheckDef, input: CheckInput) => CheckResult)(def, input))
