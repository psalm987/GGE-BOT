if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: [] }

const { events } = require("../ggeBot.js")
const err = require("../err.json")
const { count } = require("../metrics.js")
const { lognormalDelay } = require("../timing.js")
const { boxMullerRandom } = require("../pacing.js")
const { ask, chore } = require("../chores.js")

/**
 * What the client sent when the player took the 10-minute time skip from the
 * day-1 login bonus (2026-11-13 capture, line 45). `I` is the reward's item
 * key: MS3 is the 10-minute skip, as in skips.js. `ID` and `SP` are sent as
 * captured; no reply was recorded to say what they mean. The other two day-1
 * rewards were never picked, so their keys are unknown and there is no choice.
 */
const CLAIM = { ID: -1, I: "MS3", SP: null }

const DAY_MS = 24 * 60 * 60_000

/**
 * One claim, then a wait until some way into the next UTC day. Any reply ends
 * the attempt and so does silence: a claim is never repeated the same day. If
 * the game's day starts at another hour, the first claim after it may be
 * refused, and each later one still lands once in every game day.
 */
async function claim() {
    const { result } = await ask("clb", CLAIM)
    const outcome = result === undefined ? "no_reply" : result == 0 ? "claimed" : "refused"
    count("bot_daily_bonus_total", { result: outcome })
    if (outcome == "claimed")
        console.log("loginBonusClaimed")
    else if (outcome == "refused")
        console.warn("loginBonusRefused", err[result] ?? result)
    else
        console.warn("loginBonusNoReply")
    return DAY_MS - Date.now() % DAY_MS + boxMullerRandom(10 * 60_000, 2 * 60 * 60_000)
}

// The player in the capture claimed 226 s after `lli`, once the login popups were read.
events.once("load", () => chore("loginBonus", claim, lognormalDelay(45_000, 240_000)))
