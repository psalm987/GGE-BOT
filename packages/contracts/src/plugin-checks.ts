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
 * - `commanders`: the commander list in option `option` picks at least one commander.
 * - `dailyAttacks`: how much of the daily attack limit is left.
 */
export const PluginCheckDef = z.discriminatedUnion("type", [
    z.object({ type: z.literal("commanders"), option: z.string().min(1) }),
    z.object({ type: z.literal("dailyAttacks") }),
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
}

/** No account has more commanders than this, so a longer range picks no more. */
const MAX_COMMANDER_POSITION = 500

/** The commander positions a list like "1-5, 9" picks, the way bot-core's commander pool reads it. */
export function commanderPositions(list: string): Set<number> {
    const positions = new Set<number>()
    for (const part of list.split(",")) {
        const [start, end = start] = part.split("-").map(Number)
        if (!Number.isInteger(start) || !Number.isInteger(end))
            continue
        for (let p = start!; p <= Math.min(end!, MAX_COMMANDER_POSITION); p++)
            positions.add(p)
    }
    return positions
}

const result = (level: CheckLevel, key: string, params: CheckResult["params"] = {}): CheckResult => ({ level, key, params })

/** The warning margin: under this share of the daily limit left, the check warns. */
const LOW_HEADROOM = 0.1

const RUN_CHECK: { [T in PluginCheckDef["type"]]: (def: Extract<PluginCheckDef, { type: T }>, input: CheckInput) => CheckResult } = {
    commanders(def, { options }) {
        const list = String(options[def.option] ?? "").trim()
        if (list === "")
            return result("warn", "commandersAll")
        const count = commanderPositions(list).size
        return count === 0
            ? result("warn", "commandersNone", { list })
            : result("ok", "commandersSome", { count })
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
