const optionDefs = [
    { type: "Checkbox", key: "wheelClassic", default: false },
    { type: "Checkbox", key: "wheelAffluence", default: true },
    { type: "Number", key: "wheelKeepTickets", min: 0, max: 1_000_000, step: 1, default: 0 },
    { type: "Number", key: "wheelMaxPerDay", min: 0, max: 5000, step: 1, default: 0 },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const { parentPort } = require("node:worker_threads")
const { events, xtHandler, botConfig, status } = require("../ggeBot.js")
const ActionType = require("../actions.json")
const err = require("../err.json")
const { resources } = require("../protocols.js")
const { count } = require("../metrics.js")
const { lognormalDelay } = require("../timing.js")
const { boxMullerRandom, sleep } = require("../pacing.js")
const { ask, chore } = require("../chores.js")
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)

/**
 * The two wheels (docs/protocol/wheel.md). `lws {LWET}` spins one: LWET 1 is the Wheel of Unimaginable Affluence, which
 * the 2026-11-21 capture spun, and LWET 0 is the classic Wheel of Fortune, which the client's code sends but no capture
 * shows. `event` is the id the wheel has in the event list, `ticket` the key of its tickets in `resources` and `cost`
 * what a normal spin takes from them (the client's LuckyWheelConst; a Pro mode spin costs ten times as much).
 */
const WHEELS = [
    { name: "classic", option: "wheelClassic", lwet: 0, event: 15, ticket: "luckyWheelTicket", cost: 30 },
    { name: "affluence", option: "wheelAffluence", lwet: 1, event: 89, ticket: "saleDaysLuckyWheelTicket", cost: 1 },
]

const DAY_MS = 24 * 60 * 60_000
/** The client greys the spin button out under 10 seconds left. The list this reads can be minutes old, so keep well clear. */
const END_MARGIN_MS = 60_000
const MAX_SPINS_PER_RUN = 100
/** What a run reports when its wheels stopped for different reasons: the first of these that applies. */
const STOP_ORDER = ["refused", "proMode", "noTickets", "noWheel"]

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const number = (key, fallback) => pluginOptions[key] !== "" && pluginOptions[key] != null && Number.isFinite(Number(pluginOptions[key])) ? Math.max(0, Math.floor(Number(pluginOptions[key]))) : fallback
const keep = number("wheelKeepTickets", 0)
const maxPerDay = number("wheelMaxPerDay", 0)
/** A wheel the player never set follows its default: the classic wheel stays off until a spin of it is captured. */
const wanted = WHEELS.filter(wheel => pluginOptions[wheel.option] ?? optionDefs.find(def => def.key == wheel.option).default)

reportStatus("waiting", "statusWheelSpinStarting")

/** What the latest event list says of each wheel event: when it ends and whether Pro mode is on. Gone from the list means not running. */
let listed = new Map()

function noteEvents(list) {
    if (!Array.isArray(list?.E))
        return
    const now = Date.now()
    listed = new Map(list.E.filter(e => WHEELS.some(wheel => wheel.event == e.EID)).map(e => [Number(e.EID), {
        endsAt: Number.isFinite(Number(e.RS)) ? now + Number(e.RS) * 1000 : Infinity,
        pro: Boolean(e.PMA),
    }]))
}
xtHandler.on("sei", (list, result) => result == 0 && noteEvents(list))
xtHandler.on("fjf", (obj, result) => result == 0 && noteEvents(obj?.sei))

const today = () => Math.floor(Date.now() / DAY_MS)
/**
 * The spins of this UTC day, kept in the bot's status as `wheelSpins` ({ day, count }). The runner hands the last report's
 * value to the next run and ggeBot.js seeds the status with it, so a restart doesn't hand the daily limit back.
 */
const spinsToday = () => {
    const { day, count } = status.wheelSpins ?? {}
    return day === today() && Number.isInteger(count) && count > 0 ? count : 0
}
const spinsLeft = () => maxPerDay > 0 ? maxPerDay - spinsToday() : Infinity

/** Why a wheel can't be spun right now, or undefined when it can. */
function blocker(wheel) {
    const event = listed.get(wheel.event)
    if (!event || event.endsAt - Date.now() < END_MARGIN_MS)
        return "noWheel"
    if (event.pro)
        return "proMode"
    const tickets = resources[wheel.ticket]
    if (!Number.isFinite(tickets))
        return "noTickets"
    return tickets - wheel.cost < keep ? "noTickets" : undefined
}

const prizeText = prize => (Array.isArray(prize) ? prize : []).map(item =>
    Array.isArray(item) ? (item.length == 2 ? `${item[0]} x${item[1]}` : item.join(" ")) : String(item)).join(", ")

/** One spin. Resolves to "spun", or to what stopped the wheel: "refused" (any error or silence) or "proMode". */
async function spin(wheel) {
    const { reply, result } = await ask("lws", { LWET: wheel.lwet })
    const outcome = result === undefined ? "no_reply" : result == 0 ? "spun" : "refused"
    count("bot_wheel_spin_total", { wheel: wheel.name, result: outcome })
    if (outcome == "no_reply") {
        console.warn("wheelSpinNoReply")
        return "refused"
    }
    if (outcome == "refused") {
        console.warn("wheelSpinRefused", err[result] ?? result)
        return "refused"
    }
    status.wheelSpins = { day: today(), count: spinsToday() + 1 }
    parentPort?.postMessage([ActionType.StatusUser, status])
    console.log("wheelSpinPrize", prizeText(reply.R))
    if (reply.PMA) {
        listed.set(wheel.event, { ...listed.get(wheel.event), pro: true })
        return "proMode"
    }
    return "spun"
}

async function cycle(active) {
    if (wanted.length == 0) {
        reportStatus("waiting", "statusWheelSpinBothOff")
        return DAY_MS
    }
    let spun = 0
    const stops = new Set()
    for (const wheel of wanted) {
        while (active() && spun < MAX_SPINS_PER_RUN) {
            if (spinsLeft() <= 0) {
                reportStatus("waiting", "statusWheelSpinDayLimit", { limit: maxPerDay })
                return DAY_MS - Date.now() % DAY_MS + boxMullerRandom(10 * 60_000, 2 * 60 * 60_000)
            }
            const blocked = blocker(wheel)
            if (blocked) {
                stops.add(blocked)
                break
            }
            const outcome = await spin(wheel)
            if (outcome == "refused") {
                stops.add(outcome)
                break
            }
            spun++
            if (outcome == "proMode") {
                stops.add(outcome)
                break
            }
            await sleep(lognormalDelay(4000, 15_000))
        }
    }
    if (!active())
        return
    const stopped = STOP_ORDER.find(stop => stops.has(stop))
    if (spun > 0)
        reportStatus("running", "statusWheelSpinSpun", { spins: spinsToday() })
    else if (stopped == "proMode")
        reportStatus("waiting", "statusWheelSpinProMode")
    else if (stopped == "refused")
        reportStatus("waiting", "statusWheelSpinRefused")
    else if (stopped == "noTickets")
        reportStatus("waiting", "statusWheelSpinNoTickets", { keep })
    else
        reportStatus("waiting", "statusWheelSpinNoWheel")
    if (spun >= MAX_SPINS_PER_RUN)
        return boxMullerRandom(20 * 60_000, 40 * 60_000)
    return stopped == "refused" ? boxMullerRandom(60 * 60_000, 90 * 60_000) : boxMullerRandom(15 * 60_000, 25 * 60_000)
}

events.once("load", () => chore("wheelSpin", cycle, boxMullerRandom(3 * 60_000, 10 * 60_000)))
