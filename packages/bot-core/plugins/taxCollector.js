if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: [] }

const { events } = require("../ggeBot.js")
const err = require("../err.json")
const { count } = require("../metrics.js")
const { lognormalDelay } = require("../timing.js")
const { boxMullerRandom, sleep } = require("../pacing.js")
const { ask, chore } = require("../chores.js")

/**
 * Sent as captured on 2026-11-13 (line 78). 29 matches nothing on screen (146
 * coins collected, population 45, level 70) and no `txi` reply was recorded
 * to derive it from, so it stays a constant until a second capture explains it.
 */
const COLLECT = { TR: 29 }

/**
 * The first row of the tax collector's list: 10 minutes, free (capture line
 * 92). TT 0 is probably the row and TX 3 a constant, but one sample can't
 * tell which field picks the run, so no other length is offered. None of
 * these requests names a castle: the tax collector belongs to the account.
 */
const RUN = { minutes: 10, send: { TT: 0, TX: 3 } }

const RUN_MS = RUN.minutes * 60_000
const MAX_WAIT_MS = 60 * 60_000
const MAX_REMAINING_SECONDS = 48 * 60 * 60

const fewMinutes = () => boxMullerRandom(60_000, 5 * 60_000)
const thinking = () => sleep(lognormalDelay(3000, 12_000))

/**
 * Seconds until the tax collector is back, or undefined when the reply holds
 * none. No `txi` reply was captured, so this looks for the names the game
 * gives a remaining time elsewhere (RT and RS, see protocols.js), in the reply
 * or one object down.
 */
function remainingSeconds(reply) {
    const nested = Object.values(reply).filter(value => value && typeof value == "object" && !Array.isArray(value))
    for (const holder of [reply, ...nested])
        for (const key of ["RT", "RS"])
            if (Number.isFinite(holder[key]) && holder[key] >= 0 && holder[key] <= MAX_REMAINING_SECONDS)
                return holder[key]
}

let failures = 0
let lastRemaining
let countdownTrusted = true

/** The game said no or said nothing: try again later, and later still each time it repeats. */
function backOff(cmd, result) {
    console.warn("taxCollectorRefused", cmd, " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
    return Math.min(MAX_WAIT_MS, (RUN_MS + fewMinutes()) * 2 ** failures++)
}

async function cycle(active) {
    const info = await ask("txi", {})
    if (info.result !== 0)
        return backOff("txi", info.result)

    const remaining = countdownTrusted ? remainingSeconds(info.reply) : undefined
    if (remaining > 0) {
        // A real countdown is lower each time it is read. A number that isn't is some other field.
        if (lastRemaining === undefined || remaining < lastRemaining) {
            lastRemaining = remaining
            failures = 0
            return remaining * 1000 + fewMinutes()
        }
        countdownTrusted = false
    }
    lastRemaining = undefined

    await thinking()
    if (!active())
        return
    // A collector who was never sent out refuses this, which is no reason not to send him.
    const collected = await ask("txc", COLLECT)
    count("bot_tax_collect_total", { result: collected.result === undefined ? "no_reply" : collected.result == 0 ? "collected" : "refused" })

    await thinking()
    if (!active())
        return
    const sent = await ask("txs", RUN.send)
    if (sent.result !== 0)
        return backOff("txs", sent.result)
    failures = 0
    if (collected.result == 0)
        console.log("taxesCollected")
    return RUN_MS + fewMinutes()
}

events.once("load", () => chore("taxCollector", cycle, boxMullerRandom(2 * 60_000, 6 * 60_000)))
