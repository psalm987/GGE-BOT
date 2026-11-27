const optionDefs = [
    {
        type: "Rows", key: "healCastles", default: [],
        columns: [{ key: "castle", type: "castle" }, { key: "healAmount", type: "number", min: 1, max: 1_000_000, default: 500 }],
    },
    { type: "Number", key: "healInterval", min: 5, max: 60, step: 5, unit: "minutes", default: 10 },
    { type: "Number", key: "coinFloor", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 100_000 },
    { type: "Number", key: "spendCap", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 100_000 },
    { type: "Checkbox", key: "dryRunOrders", default: false },
    { type: "Checkbox", key: "askAllianceHelp", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig } = require("../ggeBot.js")
const { setCastle, forgetCurrentCastle, castleQueue, castles, resources } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const { refusalMemory } = require("../refusals.js")
const { askAllianceHelp, HELP_HEAL } = require("../allianceHelp.js")
const stock = require("./stock.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusHealTroopsStarting")

const HOSPITAL_LIST = 2
const FREE_SLOT = -1
/** A hospital that showed no free slot stays full until its shortest batch ends, plus this much for the clocks' difference. */
const FULL_MARGIN_MS = 10_000
/** Help is asked only for a batch with more than this left: the game refuses help for one that is done. */
const HELP_TIME_LEFT_MS = 60_000

/** What an `hru` refusal says, by the game's code. 53 (NOT_IN_OWNED_CASTLE) is retried after joining again instead. */
const REFUSALS = { 10: "noCoins", 63: "hospitalFull", 88: "tooMany" }
const NOT_IN_CASTLE = 53

const asNumber = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback
const intervalMs = () => asNumber(pluginOptions.healInterval, 10) * 60_000

/** Units the game heals for coins only. One it would heal for rubies is never healed. */
const healsForCoins = unit => Number(unit?.healingCostC1) > 0 && !(Number(unit?.healingCostC2) > 0)

/** The saved castles as `{ ref, amount }`. A row that isn't a whole castle and a positive amount is left out. */
const targetRows = () => (Array.isArray(pluginOptions.healCastles) ? pluginOptions.healCastles : [])
    .map(row => ({ ref: row?.castle, amount: Number(row?.healAmount) }))
    .filter(row => Number.isInteger(row.ref?.kingdom) && Number.isInteger(row.ref?.id) && row.amount > 0)

const castleKey = castle => `${castle.kingdomID}:${castle.id}`
const castleOf = ref => castles.find(castle => castle.kingdomID == ref.kingdom && castle.id == ref.id)

/** The castle's wounded that heal for coins, the biggest stack first. */
const woundedOf = castle => (castle.hospitalInventory ?? [])
    .filter(unit => unit.amount > 0 && healsForCoins(unit.unitInfo))
    .sort((a, b) => b.amount - a.amount)

/**
 * The hospital's slots (`PIDL`) as the bot last saw them, `{ slots, at }`: from the castle's join (`spl2`) or from the
 * bot's own heals, whichever is newer. A slot is `[-1, …]` free, `[-2, …]` locked, or
 * `[unit, amount, secondsLeft, speed, helpSecondsTaken, batchID, …]` while it heals.
 */
const healReplies = new Map()
function hospitalOf(castle) {
    const joined = castleQueue(castle.kingdomID, castle.id, HOSPITAL_LIST)
    const seen = [healReplies.get(castleKey(castle)), joined && { slots: joined.spl?.PIDL, at: joined.at }]
        .filter(entry => Array.isArray(entry?.slots))
    return seen.sort((a, b) => b.at - a.at)[0]
}

/** Until when the hospital is full: 0 when it shows a free slot or isn't known, else when its shortest batch ends. */
function fullUntil(castle) {
    const hospital = hospitalOf(castle)
    const slots = (hospital?.slots ?? []).filter(Array.isArray)
    if (!hospital || slots.some(slot => Number(slot[0]) == FREE_SLOT))
        return 0
    const healing = slots.filter(slot => Number(slot[0]) > 0).map(slot => Number(slot[2]) || 0)
    return healing.length ? hospital.at + Math.min(...healing) * 1000 + FULL_MARGIN_MS : 0
}

/** The first batch the alliance can still help: healing, no help taken yet, and more than a minute to go. */
function batchToHelp(castle) {
    const hospital = hospitalOf(castle)
    return (hospital?.slots ?? []).find(slot => Array.isArray(slot) && Number(slot[0]) > 0 && !(Number(slot[4]) > 0) && Number(slot[5]) > 0 &&
        hospital.at + (Number(slot[2]) || 0) * 1000 > Date.now() + HELP_TIME_LEFT_MS)
}

/** Backoff by castle, a round apart at first. */
const learned = refusalMemory({ round: intervalMs() })
/** The coins each castle waits for after NOT_ENOUGH_CURRENCY1: the price of the heal the game refused. */
const coinsNeeded = new Map()
/** Looks in a row that showed a castle with no hospital, by castle. */
const noHospitalLooks = new Map()

/** What stopped the heals, in the order the status names them when nothing was healed. */
const BLOCKERS = ["noCastle", "noHospital", "noAnswer", "refused", "tooMany", "noCoins", "coinFloor", "spendCap", "hospitalFull"]
const STATUS_KEY = {
    nothingWounded: "statusHealTroopsNothingWounded", hospitalFull: "statusHealTroopsHospitalFull", coinFloor: "statusHealTroopsCoinFloor",
    spendCap: "statusHealTroopsSpendCap", noCoins: "statusHealTroopsNoCoins", tooMany: "statusHealTroopsTooMany", refused: "statusHealTroopsRefused",
    noAnswer: "statusHealTroopsNoAnswer", noHospital: "statusHealTroopsNoHospital", noCastle: "statusHealTroopsNoCastle",
}

/**
 * One run's heals. `budget` is the coins the spend cap still allows. `afford(unit)` is how many of `unit` the coins
 * pay for above the floor and within the budget, and which of the two stops it.
 */
function runState() {
    const coinFloor = asNumber(pluginOptions.coinFloor, 100_000)
    const run = { budget: asNumber(pluginOptions.spendCap, 100_000), heals: 0, troops: 0, drySpent: 0 }
    run.afford = unit => {
        const price = Number(unit.healingCostC1)
        const byFloor = Math.floor((resources.coins - run.drySpent - coinFloor) / price)
        const byBudget = Math.floor(run.budget / price)
        return { count: Math.max(0, Math.min(byFloor, byBudget)), blocker: byFloor <= byBudget ? "coinFloor" : "spendCap" }
    }
    return run
}

/**
 * Heals in `castle` from inside it, up to `amount` troops, a stack at a time while the hospital has a free slot.
 * Resolves to `{ outcome }`, or `{ retry: true }` after NOT_IN_OWNED_CASTLE.
 */
async function healInside(castle, amount, run, active) {
    const key = castleKey(castle)
    if (Date.now() < fullUntil(castle))
        return { outcome: "hospitalFull" }
    const opened = await ask("hfl", { KID: castle.kingdomID, AID: castle.id, HRF: -1 })
    if (opened.result === NOT_IN_CASTLE)
        return { retry: true }
    if (opened.result !== 0)
        return { outcome: opened.result === undefined ? "noAnswer" : "refused" }
    let left = amount, outcome
    for (const unit of woundedOf(castle)) {
        if (left <= 0 || Date.now() < fullUntil(castle) || !active())
            break
        const { count, blocker } = run.afford(unit.unitInfo)
        const heal = Math.min(left, unit.amount, learned.cap(key), count)
        if (!(heal > 0)) {
            outcome ??= blocker
            break
        }
        const { reply, result } = await ask("hru", { U: Number(unit.unitInfo.wodID), A: heal })
        if (result === NOT_IN_CASTLE)
            return outcome ? { outcome } : { retry: true }
        if (result !== 0) {
            const refusal = result === undefined ? "noAnswer" : REFUSALS[result] ?? "refused"
            if (refusal == "noCoins")
                coinsNeeded.set(key, Number(unit.unitInfo.healingCostC1) * heal)
            else
                learned.refused(key, refusal, heal)
            if (refusal == "tooMany")
                console.warn("healTooMany", String(unit.unitInfo.type), heal)
            else if (refusal != "hospitalFull" && refusal != "noCoins")
                console.warn("healRefused", String(unit.unitInfo.type), heal, castle.kingdomID, castle.id, result === undefined ? "TIMED_OUT" : err[result] ?? result)
            return { outcome: outcome ?? refusal }
        }
        learned.accepted(key)
        if (Array.isArray(reply.spl?.PIDL))
            healReplies.set(key, { slots: reply.spl.PIDL, at: Date.now() })
        // protocols.js refreshes the stock itself when the reply carries `gui`.
        if (!reply.gui)
            unit.amount -= heal
        run.budget -= Number(unit.unitInfo.healingCostC1) * heal
        run.heals++
        run.troops += heal
        left -= heal
        outcome = "healed"
        await pause(1500, 4000)
    }
    return { outcome: outcome ?? "nothingWounded" }
}

/** What happened in the castle of `row` this run. */
async function healCastle(row, run, active) {
    const castle = castleOf(row.ref)
    if (!castle)
        return "noCastle"
    const key = castleKey(castle)
    if (castle.hasHospital === false) {
        const looks = (noHospitalLooks.get(key) ?? 0) + 1
        noHospitalLooks.set(key, looks)
        if (looks == 2)
            console.warn("healNoHospital", castle.kingdomID, castle.id)
        return "noHospital"
    }
    noHospitalLooks.delete(key)
    const holding = learned.holding(key)
    if (holding)
        return holding
    if (coinsNeeded.has(key)) {
        if (!(resources.coins >= coinsNeeded.get(key)))
            return "noCoins"
        coinsNeeded.delete(key)
    }
    const wounded = woundedOf(castle)
    if (wounded.length == 0)
        return "nothingWounded"
    if (Date.now() < fullUntil(castle))
        return "hospitalFull"
    const { count, blocker } = run.afford(wounded[0].unitInfo)
    if (count == 0)
        return blocker

    if (pluginOptions.dryRunOrders) {
        let left = row.amount
        for (const unit of wounded) {
            const heal = Math.min(left, unit.amount, run.afford(unit.unitInfo).count)
            if (!(heal > 0))
                break
            console.log("dryRunHru", castle.kingdomID, castle.id, JSON.stringify({ U: Number(unit.unitInfo.wodID), A: heal }))
            run.drySpent += Number(unit.unitInfo.healingCostC1) * heal
            run.budget -= Number(unit.unitInfo.healingCostC1) * heal
            run.heals++
            run.troops += heal
            left -= heal
        }
        return "healed"
    }

    let result
    for (let tries = 0; tries < 2; tries++) {
        try {
            result = await setCastle(castle, () => healInside(castle, row.amount, run, active))
        } catch {
            result = { outcome: "noAnswer" }
        }
        if (!result.retry)
            break
        forgetCurrentCastle()
    }
    if (result.retry) {
        learned.refused(key, "refused", 0)
        console.warn("healRefused", "", "", castle.kingdomID, castle.id, err[NOT_IN_CASTLE])
        return "refused"
    }
    return result.outcome
}

async function cycle(active) {
    const rows = targetRows()
    if (rows.length == 0) {
        reportStatus("waiting", "statusHealTroopsNoTargets")
        return 60 * 60_000
    }
    await stock.refreshHome()
    const run = runState()
    const outcomes = []
    for (const row of rows) {
        if (!active())
            return
        outcomes.push(await healCastle(row, run, active))
        const castle = castleOf(row.ref)
        const batch = castle && pluginOptions.askAllianceHelp && batchToHelp(castle)
        if (batch && active())
            await askAllianceHelp(castle, { type: HELP_HEAL, id: Number(batch[5]), ticket: Number(batch[5]), dryRun: Boolean(pluginOptions.dryRunOrders) })
    }

    if (run.heals > 0)
        reportStatus("running", "statusHealTroopsHealed", { heals: run.heals, troops: run.troops })
    else if (outcomes.every(outcome => outcome == "nothingWounded"))
        reportStatus("waiting", "statusHealTroopsNothingWounded")
    else
        reportStatus("waiting", STATUS_KEY[BLOCKERS.find(b => outcomes.includes(b))])
    return intervalMs() + boxMullerRandom(0, 60_000)
}

events.once("load", () => chore("healTroops", cycle, boxMullerRandom(2 * 60_000, 6 * 60_000)))
