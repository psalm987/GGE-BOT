const { xtHandler } = require("./ggeBot.js")
const { boxMullerRandom, sleep } = require("./pacing.js")

/**
 * When the account last started an army: an attack, a station, a troop transfer or market carts. Two army starts close
 * together can get the connection closed, so each plugin that starts one keeps 5 to 10 seconds after the last. The
 * attacks are read from their replies, as the attack plugins keep no shared clock. A crm with D 1 is carts on their
 * way home, which the account didn't start.
 */
let lastArmyAt = 0
for (const cmd of ["cra", "cat", "cds", "kut", "crm"])
    xtHandler.on(cmd, (obj, result) => Number(result) == 0 && Number(obj?.A?.M?.D) != 1 && (lastArmyAt = Date.now()))

/** Waits until 5 to 10 seconds have passed since the last army start, and counts the caller's start from now. */
async function armyGap() {
    const wait = boxMullerRandom(5000, 10_000) - (Date.now() - lastArmyAt)
    if (wait > 0)
        await sleep(wait)
    lastArmyAt = Date.now()
}

module.exports = { armyGap }
