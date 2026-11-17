const { parentPort } = require("node:worker_threads")
const path = require("node:path")
const ActionType = require("./actions.json")

/**
 * The status reporter for the plugin in `filename`, for the status pill in its settings dialog:
 * `reportStatus(state, reasonKey, params)` with state "running", "waiting", "stopped" or "error", and reasonKey a
 * bot-locale key whose {{placeholders}} come from params. A report equal to the last one sends nothing.
 */
function statusReporter(filename) {
    const plugin = path.basename(filename, ".js")
    let last
    return (state, reasonKey = null, params = {}) => {
        const report = { plugin, state, reasonKey, params }
        const sent = JSON.stringify(report)
        if (sent === last)
            return
        last = sent
        parentPort.postMessage([ActionType.PluginStatus, report])
    }
}

module.exports = { statusReporter }
