// The player's consent to gge-tracker.com, an account setting, and the client the Fortress and Storm forts plugins ask
// for its timetables through. Only the runner reads the site (apps/runner/src/gge-tracker.ts), and only for an account
// whose first box is ticked; the player's name goes along only with the second. See docs/protocol/gge-tracker.md.
const { isMainThread, parentPort } = require("node:worker_threads")

if (isMainThread)
    return module.exports = {
        force: true,
        pluginOptions: [
            { type: "Checkbox", key: "useTimetables", default: false },
            { type: "Checkbox", key: "includePlayerName", default: false, showWhen: { key: "useTimetables", in: [1] } },
        ],
    }

const { GgeTracker: ACTION } = require("../actions.json")
const { botConfig } = require("../ggeBot.js")

const ANSWER_WAIT_MS = 30_000

/** Request id -> the plugin waiting for its answer. */
const waiting = new Map()
let nextId = 1

parentPort.on("message", ([type, reply]) => {
    if (type != ACTION)
        return
    waiting.get(reply?.id)?.(reply)
})

/**
 * Asks the runner for a timetable: `{ kind: "fortresses", kingdom }` or `{ kind: "stormForts" }`. Resolves with the
 * runner's GgeTrackerReply, or `{ ok: false, error }` when there is none. With the box off nothing is sent at all.
 */
function askTracker(request) {
    if (botConfig.plugins.ggeTracker?.useTimetables !== true)
        return Promise.resolve({ ok: false, error: "off" })
    const id = nextId++
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            waiting.delete(id)
            resolve({ ok: false, error: "noAnswer" })
        }, ANSWER_WAIT_MS)
        timer.unref?.()
        waiting.set(id, reply => {
            clearTimeout(timer)
            waiting.delete(id)
            resolve(reply)
        })
        parentPort.postMessage([ACTION, { id, ...request }])
    })
}

module.exports = { askTracker }
