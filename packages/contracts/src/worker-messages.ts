import * as z from "zod"

/** The most one plugin's memory on one account may hold, as JSON text. A write that would pass it is refused. */
export const PLUGIN_MEMORY_MAX_BYTES = 16 * 1024

const name = z.string().min(1).max(64)

/**
 * A worker's PluginMemory message: one plugin keeps `value` under `key` across the account's runs. A null value forgets
 * the key.
 */
export const PluginMemoryWrite = z.object({ plugin: name, key: name, value: z.json() })
export type PluginMemoryWrite = z.infer<typeof PluginMemoryWrite>

/** What each plugin keeps on one account, by plugin key and then by key. A starting bot is handed it. */
export const PluginMemory = z.record(name, z.record(name, z.json()))
export type PluginMemory = z.infer<typeof PluginMemory>

/** Why a plugin is done: it did everything it can this event, or its event isn't running. */
export const PluginFinishReason = z.enum(["done", "eventOver"])
export type PluginFinishReason = z.infer<typeof PluginFinishReason>

/**
 * A worker's PluginFinished message: the plugin is done until its event comes round again, so the runner switches it
 * off in the account's settings. Only a plugin its catalog marks `eventOnly` may send it.
 */
export const PluginFinished = z.object({ plugin: name, reason: PluginFinishReason.default("done") })
export type PluginFinished = z.infer<typeof PluginFinished>

/**
 * A worker's GameRefusal message: the game refused a request the bot sent in the last two minutes. `plugin` is the
 * script that sent it, `error` the game's error name from err.json (or its number when err.json lacks it), and `at` when
 * the refusal came, epoch milliseconds.
 */
export const GameRefusal = z.object({ plugin: name, command: z.string().min(1).max(32), error: z.string().min(1).max(64), at: z.number().int() })
export type GameRefusal = z.infer<typeof GameRefusal>

/**
 * The account setting that holds the player's consent to gge-tracker.com: the plugin key and its two checkboxes, both off
 * by default. `timetables` lets the runner read the site's timetables for the account's game server; `playerName` also
 * sends the player's name, so the fortress times include the player's own cooldowns.
 */
export const GGE_TRACKER_CONSENT = { plugin: "ggeTracker", timetables: "useTimetables", playerName: "includePlayerName" } as const

/** The kingdoms with fortresses: Burning Sands, Everwinter Glacier and Fire Peaks. */
export const FORTRESS_KINGDOMS = [1, 2, 3] as const

/**
 * A worker's GgeTracker message: a plugin asks the runner for a gge-tracker.com timetable. The runner answers with a
 * GgeTrackerReply of the same `id`, and fetches nothing unless the account opted in.
 */
export const GgeTrackerRequest = z.discriminatedUnion("kind", [
    z.object({ id: z.number().int(), kind: z.literal("fortresses"), kingdom: z.union(FORTRESS_KINGDOMS.map(k => z.literal(k))) }),
    z.object({ id: z.number().int(), kind: z.literal("stormForts") }),
])
export type GgeTrackerRequest = z.infer<typeof GgeTrackerRequest>

/** A fortress as the timetable gives it. `availableAt` is when it can be attacked next, epoch milliseconds. */
export type TrackerFortress = { x: number; y: number; availableAt: number }
/** A Storm fort as the timetable gives it: `isleID` is its type, the game's extraData[2]. Times are epoch milliseconds. */
export type TrackerStormFort = { x: number; y: number; isleID: number; victories: number; visible: boolean; availableAt: number; updatedAt: number }

/**
 * Why the runner has no timetable for a request: `off` the account has not opted in, `noServer` the site has no such
 * data for the account's game server, `unavailable` the site could not be read, `badRequest` the request was malformed.
 */
export type GgeTrackerError = "off" | "noServer" | "unavailable" | "badRequest"

/** The runner's answer to a GgeTrackerRequest. `withName` says the fortress times include the player's own cooldowns. */
export type GgeTrackerReply = { id: number } & (
    | { ok: true; kind: "fortresses"; server: string; fetchedAt: number; withName: boolean; fortresses: TrackerFortress[] }
    | { ok: true; kind: "stormForts"; server: string; fetchedAt: number; forts: TrackerStormFort[] }
    | { ok: false; error: GgeTrackerError }
)
