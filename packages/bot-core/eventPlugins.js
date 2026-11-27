/**
 * Event-only plugins (the catalog's `eventOnly`, which the runner passes beside each plugin's options) are done while
 * their event isn't running: once the game's event list is in without it, and when it stops. Each says so with
 * PluginFinished, and the runner switches it off in the account's settings. After Lazy Lord's be/main.js:1413.
 */
const { botConfig, events, xtHandler } = require("./ggeBot.js")
const eventGate = require("./eventGate.js")
const { finishPlugin } = require("./pluginStatus.js")

const eventPlugins = Object.values(botConfig.plugins ?? {}).filter(plugin => plugin?.state && Number.isInteger(plugin.eventOnly))

function watch() {
    for (const { filename, eventOnly } of eventPlugins) {
        const done = () => finishPlugin(filename, "eventOver")
        if (!eventGate.isActive(eventOnly))
            done()
        eventGate.onStop(eventOnly, done)
    }
}

let listed = false
xtHandler.on("sei", (_, result) => {
    if (result == 0)
        listed = true
})
// protocols.js takes a list in only after "load", in later ticks, so the check waits a tick for it.
if (eventPlugins.length)
    events.once("load", () => listed ? setTimeout(watch) : xtHandler.once("sei", () => setTimeout(watch)))
