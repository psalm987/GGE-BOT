const { parentPort } = require("node:worker_threads")
const path = require("node:path")
const ActionType = require("./actions.json")

/** The last report sent for each plugin. The commander pool reports for a plugin too, so every reporter of a plugin shares it. */
const lastSent = new Map()

/**
 * The status reporter for the plugin in `filename`, for the status pill in its settings dialog:
 * `reportStatus(state, reasonKey, params)` with state "running", "waiting", "stopped" or "error", and reasonKey a
 * bot-locale key whose {{placeholders}} come from params. A report equal to the plugin's last one sends nothing.
 */
function statusReporter(filename) {
    const plugin = path.basename(filename, ".js")
    return (state, reasonKey = null, params = {}) => {
        const report = { plugin, state, reasonKey, params }
        const sent = JSON.stringify(report)
        if (sent === lastSent.get(plugin))
            return
        lastSent.set(plugin, sent)
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

const finished = new Set()
/**
 * The plugin in `filename` is done until its event comes round again: "done" with all it can do, or "eventOver". The
 * runner switches it off in the account's settings and tells the owner. Only a plugin its catalog marks `eventOnly` may
 * do this; the runner ignores others.
 */
function finishPlugin(filename, reason = "done") {
    const plugin = path.basename(filename, ".js")
    if (finished.has(plugin))
        return
    finished.add(plugin)
    parentPort.postMessage([ActionType.PluginFinished, { plugin, reason }])
}

module.exports = { statusReporter, notifyOwner, finishPlugin }
