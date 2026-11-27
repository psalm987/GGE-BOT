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

/** A worker's PluginFinished message: the plugin is done until its event comes round again. */
export const PluginFinished = z.object({ plugin: name })
export type PluginFinished = z.infer<typeof PluginFinished>
