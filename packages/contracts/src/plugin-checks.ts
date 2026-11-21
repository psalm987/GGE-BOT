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

/**
 * Marks the option that holds a plugin's commander list, and `vip` the Number option that holds its VIP commander cap. A
 * module page draws them as one commander picker for all its plugins.
 */
export const PluginCheckDef = z.object({ type: z.literal("commanders"), option: z.string().min(1), vip: z.string().min(1).optional() })
export type PluginCheckDef = z.infer<typeof PluginCheckDef>

/** No account has more commanders than this, so a longer range picks no more. */
const MAX_COMMANDER_POSITION = 500

/** The game gives an account at most this many commanders, and the picker has a tile for each. */
export const MAX_COMMANDERS = 50

/**
 * The positions a commander list like "1-5, 9" or "36;2;5" names, in its order and each once, the way bot-core's
 * commander pool reads it: positions and ranges of positions, set apart by commas or semicolons. A part that is
 * neither, or a range written backwards, names nothing.
 */
export function commanderPositions(list: string): Set<number> {
    const positions = new Set<number>()
    for (const part of list.split(/[,;]/)) {
        if (part.trim() === "")
            continue
        const [start, end = start] = part.split("-").map(Number)
        if (!Number.isInteger(start) || !Number.isInteger(end))
            continue
        for (let p = start!; p <= Math.min(end!, MAX_COMMANDER_POSITION); p++)
            positions.add(p)
    }
    return positions
}

/** The picker's tiles a stored commander list picks, in the order the bot sends them. "1-99" is every tile, 1 to 50. */
export const commanderPicks = (list: string): number[] => [...commanderPositions(list)].filter(p => p >= 1 && p <= MAX_COMMANDERS)

/**
 * The commander list that stores picked tiles in their order, as semicolon-separated positions ("36;2;5"). A run of
 * three or more positions in a row is written as its range, so every tile in order is "1-50", the default.
 */
export function writeCommanderPicks(picks: readonly number[]): string {
    const parts: string[] = []
    for (let i = 0; i < picks.length;) {
        let end = i
        while (end + 1 < picks.length && picks[end + 1] === picks[end]! + 1)
            end++
        if (end - i >= 2) {
            parts.push(`${picks[i]}-${picks[end]}`)
            i = end + 1
        } else
            parts.push(String(picks[i++]))
    }
    return parts.join(";")
}
