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
