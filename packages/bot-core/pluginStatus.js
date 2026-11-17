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

/**
 * Asks the runner to tell the account's owner, in the bell and by email if they chose it: a BotNotice from
 * @gge/contracts. `key` names the one event, so the same key twice notifies once.
 */
function notifyOwner(kind, data, key) {
    parentPort.postMessage([ActionType.Notify, { kind, data, key }])
}

module.exports = { statusReporter, notifyOwner }
