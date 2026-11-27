/**
 * Keeps each castle's stores, units and order fresh for the read-back snapshot. They come with the castle list (`dcl`),
 * the read the game client makes when the player opens the castle overview. Other parts of the bot ask for it too, so
 * this slow chore asks only when no list has come for a while.
 */
const { xtHandler, events } = require("./ggeBot.js")
const { ask, chore } = require("./chores.js")
const { boxMullerRandom } = require("./pacing.js")

/** The chore never asks sooner than this after the last list, in milliseconds, and waits up to `READ_SPREAD_MS` longer. */
const READ_GAP_MS = 5 * 60_000
const READ_SPREAD_MS = 5 * 60_000
/** The first look comes this long after sign-in, in milliseconds. */
const FIRST_READ_MS = [60_000, 2 * 60_000]

function watchCastleList() {
    let readAt = -Infinity
    xtHandler.on("dcl", (_reply, result) => {
        if (Number(result) == 0)
            readAt = Date.now()
    })
    const nextRead = () => READ_GAP_MS + boxMullerRandom(0, READ_SPREAD_MS)
    events.once("load", () => chore("castleListRead", async () => {
        const sinceRead = Date.now() - readAt
        if (sinceRead < READ_GAP_MS)
            return nextRead() - sinceRead
        await ask("dcl", { CD: 1 })
        return nextRead()
    }, boxMullerRandom(...FIRST_READ_MS)))
}

module.exports = { watchCastleList }
