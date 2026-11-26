/**
 * Which of the game's events are running, for plugins that work only during one. Worker thread only.
 * It reads the event list protocols.js keeps from `sei`, and that list's eventStart and eventStop.
 * After Lazy Lord's be/eventGate.js.
 */
const { events } = require("./ggeBot.js")
const { activeEvent } = require("./protocols.js")

/** Calls `fn(eventInfo)` on each `name` for event `eventID`. Returns a function that stops it. */
function onEvent(name, eventID, fn) {
    const listener = eventInfo => {
        if (Number(eventInfo?.EID) == Number(eventID))
            fn(eventInfo)
    }
    events.on(name, listener)
    return () => events.off(name, listener)
}

/** Whether event `eventID` is running. */
const isActive = eventID => activeEvent(eventID) !== undefined

/** Resolves with the event's info once event `eventID` runs: at once while it runs. */
const whenActive = eventID => new Promise(resolve => {
    if (isActive(eventID))
        return resolve(activeEvent(eventID))
    const off = onEvent("eventStart", eventID, eventInfo => {
        off()
        resolve(eventInfo)
    })
})

module.exports = {
    isActive,
    whenActive,
    /** Calls `fn(eventInfo)` each time event `eventID` starts. Returns a function that stops it. */
    onStart: (eventID, fn) => onEvent("eventStart", eventID, fn),
    /** Calls `fn(eventInfo)` each time event `eventID` stops. `eventInfo.byEndTime` is true when its end time passed. */
    onStop: (eventID, fn) => onEvent("eventStop", eventID, fn),
}
