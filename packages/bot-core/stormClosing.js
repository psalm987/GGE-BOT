/**
 * When the Storm Islands event ends, and whether an attack sent now would land before that. The end comes from the
 * `RS` (seconds left) of the Storm event in the `sei` list, counted from when the list arrived.
 */

/** The `EID` of the Storm Islands event in the `sei` list: the client titles it `event_title_102`, as Khan is 72 and Berimond 85. */
const STORM_EVENT_ID = 102

/**
 * Watches `sei` for the event `eventID`. `activeEvent` reads the list the bot already holds, which seeds the end time
 * for a plugin that starts after the list arrived. An event that was never listed has no end time, and a listed one
 * keeps its last end time after it drops off the list.
 */
function stormWatch(eventID, { xtHandler, activeEvent = () => undefined, now = Date.now } = {}) {
    let endsAt = Infinity
    /** Seconds a march takes for one map tile, the slowest one seen, or 0 before any march has been sent. */
    let secondsPerTile = 0
    const note = event => {
        if (event && Number(event.RS) > 0)
            endsAt = now() + Number(event.RS) * 1000
    }
    const noteList = (list, result) => {
        if (eventID != null && Number(result) == 0)
            note(list?.E?.find(event => event.EID == eventID))
    }
    if (eventID != null) {
        note(activeEvent(eventID))
        xtHandler.on("sei", noteList)
        xtHandler.on("fjf", (obj, result) => noteList(obj?.sei, result))
    }
    return {
        endsAt: () => endsAt,
        /** Records a march that took `seconds` over `distance` tiles. */
        learn(seconds, distance) {
            if (distance > 0 && seconds > 0)
                secondsPerTile = Math.max(secondsPerTile, seconds / distance)
        },
        /** Whether an attack sent over `distance` tiles lands before the event ends. */
        lands: distance => now() + distance * secondsPerTile * 1000 < endsAt,
    }
}

module.exports = { STORM_EVENT_ID, stormWatch }
