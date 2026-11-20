import * as z from "zod"

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

/** Marks the option that holds a plugin's commander list, so the settings page can show the account's commander roster beside it. */
export const PluginCheckDef = z.object({ type: z.literal("commanders"), option: z.string().min(1) })
export type PluginCheckDef = z.infer<typeof PluginCheckDef>

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
