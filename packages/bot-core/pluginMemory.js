const { parentPort, workerData } = require("node:worker_threads")
const path = require("node:path")
const ActionType = require("./actions.json")

/** PLUGIN_MEMORY_MAX_BYTES in @gge/contracts, which the runner holds a plugin's memory to, measured the same way. */
const MAX_BYTES = 16 * 1024

/**
 * The memory of the plugin in `filename`, which outlives the bot's runs on this account: what the runner handed this
 * run at its start, and each change sent back to it. `get(key)` is undefined for a key never kept. `set(key, value)`
 * keeps a JSON value, or forgets the key for null, and returns false without keeping anything when the plugin's memory
 * would pass the cap. A kept value is a copy, so set it again to keep a change to it.
 */
function pluginMemory(filename) {
    const plugin = path.basename(filename, ".js")
    let kept = { ...workerData?.pluginMemory?.[plugin] }
    return {
        get: key => kept[key],
        set(key, value) {
            const { [key]: _, ...rest } = kept
            const next = value === null ? rest : { ...rest, [key]: JSON.parse(JSON.stringify(value)) }
            if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES)
                return false
            kept = next
            parentPort.postMessage([ActionType.PluginMemory, { plugin, key, value: value === null ? null : next[key] }])
            return true
        },
    }
}

module.exports = { pluginMemory }
