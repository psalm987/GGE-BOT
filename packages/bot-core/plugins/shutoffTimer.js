const { isMainThread, parentPort } = require('node:worker_threads')

if (isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "hours",
                default: "2"
            }
        ]
    }
    
    return
}

const ActionType = require("../actions.json")
const { botConfig, events } = require("../ggeBot.js")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

if (isNaN(Number(pluginOptions.hours)))
    return console.error("hoursOptionIsNotNumber")

const hours = Number(pluginOptions.hours)
/** setTimeout fires at once for a longer delay, so a larger value waits this long (about 596 hours). */
const TIMER_MAX = 2 ** 31 - 1

if (hours > 0)
    events.once("load", () => {
        setTimeout(() =>
            parentPort.postMessage([ActionType.KillBot]),
            Math.min(hours * 1000 * 60 * 60, TIMER_MAX))
    })