/**
 * The difficulty of an event, chosen once. The Nomad, Samurai and Khan plugins share the event 72 and all run in one
 * thread, so the first plugin to see the event start sends `sede` and the others take its answer.
 */
const { sendXT, waitForResult, events } = require("./ggeBot.js")

const eventsDifficulties = require("./paths.js").loadItem("eventAutoScalingDifficulties")
const err = require("./err.json")
const { HIGHEST_DIFFICULTY } = require("./eventCamps.js")

/** What renting a tier costs in rubies: a locked tier has a rent price, an unlocked one costs nothing. */
const rentCost = row => row.isLocked == "1" ? Number(row.rentC2Cost) : 0

/** The `sede` of each event that started and has not stopped, as a promise of what `settleDifficulty` resolves to. */
const settled = new Map()

async function sendDifficulty(EID, EDID) {
    await sendXT("sede", JSON.stringify({ EID, EDID, C2U: 0 }))
    const [, result] = await waitForResult("sede", 1000 * 10)
    return result == 0 ? { EDID } : { refused: err[result] ?? result }
}

/**
 * The difficulty in force for an event that started on `EDID`. While it is -1 the game has none yet, and the
 * `eventDifficulty` choice `choice` is set as the player would: `{ EDID }` once the game accepts it, `{ refused }`
 * with the game's error otherwise. Once one plugin has asked, every plugin gets that answer, whatever its own choice.
 * The "Highest unlocked" choice sets the event's top tier that costs no rubies to rent, and is refused when there is none.
 * A choice with no difficulty row (Classic) leaves the event on -1, and so does an event that already has a difficulty.
 */
function settleDifficulty(EID, EDID, choice) {
    if (EDID != -1)
        return Promise.resolve({ EDID })
    if (settled.has(EID))
        return settled.get(EID)
    if (Number(choice) == HIGHEST_DIFFICULTY)
        return remember(EID, () => {
            const tiers = eventsDifficulties.filter(e => e.eventID == EID).sort((a, b) => a.difficultyTypeID - b.difficultyTypeID)
            const free = tiers.findLast(row => rentCost(row) == 0)
            return free ? sendDifficulty(EID, Number(free.difficultyID)) : Promise.resolve({ refused: "NO_UNLOCKED_DIFFICULTY" })
        })
    // Classic has no difficulty row, so the event stays on EDID -1 and its classic camps.
    const difficulty = eventsDifficulties.find(e => choice == e.difficultyTypeID && e.eventID == EID)
    if (!difficulty)
        return Promise.resolve({ EDID })
    return remember(EID, () => sendDifficulty(EID, Number(difficulty.difficultyID)))
}

/** Holds the answer of `send` for the event until it stops, and forgets it when it throws. */
function remember(EID, send) {
    settled.set(EID, send().catch(error => {
        settled.delete(EID)
        throw error
    }))
    return settled.get(EID)
}

events.on("eventStop", ({ EID }) => settled.delete(EID))

module.exports = { settleDifficulty, rentCost }
