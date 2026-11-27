const ruleColumns = item => [
    { key: "toKingdom", type: "kingdom" },
    { key: "fromKingdom", type: "kingdom" },
    { key: item, type: item },
    { key: "below", type: "number", min: 1, max: 10_000_000, default: 100 },
    { key: "upTo", type: "number", min: 1, max: 10_000_000, default: 500 },
    { key: "senderKeep", type: "number", min: 0, max: 10_000_000, default: 0 },
]

const optionDefs = [
    { type: "Rows", key: "troopRules", columns: ruleColumns("troop"), default: [] },
    { type: "Rows", key: "toolRules", columns: ruleColumns("tool"), default: [] },
    { type: "Checkbox", key: "useTimeSkips", default: false },
    { type: "Checkbox", key: "dryRunTransfers", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig, xtHandler } = require("../ggeBot.js")
const { ClientCommands, KingdomID, KingdomSkipType, AreaType, castles } = require("../protocols.js")
const { chore } = require("../chores.js")
const { boxMullerRandom, pause, sleep } = require("../pacing.js")
const { spendSkip, skipRefused, MinuteSkipType } = require("./skips.js")
const stock = require("./stock.js")
const loadItem = require("../paths.js").loadItem

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusTroopTransferStarting")

const units = new Map(loadItem("units").map(unit => [Number(unit.wodID), unit]))

/** Kingdoms that send and take transfers. Berimond resupplies through its own event. */
const KINGDOMS = new Set([KingdomID.greatEmpire, KingdomID.burningSands, KingdomID.everWinterGlacier, KingdomID.firePeaks, KingdomID.stormIslands])

/** The castle a kingdom transfer leaves from or lands in: the main castle in the Great Empire, the kingdom's castle elsewhere. */
const kingdomCastle = kingdomID => castles.find(castle => castle.kingdomID == kingdomID &&
    castle.areaInfo?.type == (kingdomID == KingdomID.greatEmpire ? AreaType.mainCastle : AreaType.externalKingdom))

/**
 * When each transfer timer was seen. `troopTransfer.remainingTime` is the seconds left when the game sent it and is
 * never counted down, so a timer seen ten minutes ago has ten minutes less left.
 */
const seenAt = new WeakMap()
const stampTimers = () => castles.forEach(castle => castle.troopTransfer && !seenAt.has(castle.troopTransfer) && seenAt.set(castle.troopTransfer, Date.now()))
for (const cmd of ["kpi", "fjf", "kgt", "msk", "kut"])
    xtHandler.on(cmd, stampTimers)
stampTimers()

function transferLeftMs(castle) {
    const transfer = castle.troopTransfer
    if (!(transfer?.remainingTime > 0))
        return 0
    if (!seenAt.has(transfer))
        seenAt.set(transfer, Date.now())
    return Math.max(0, transfer.remainingTime * 1000 - (Date.now() - seenAt.get(transfer)))
}

/**
 * When the account last started an army: an attack, a station or a transfer. Two army starts close together can get
 * the connection closed, so a transfer keeps 5 to 10 seconds after the last one. The attacks are read from their
 * replies, as the attack plugins keep no shared clock.
 */
let lastArmyAt = 0
for (const cmd of ["cra", "cat", "cds", "kut"])
    xtHandler.on(cmd, (_, result) => Number(result) == 0 && (lastArmyAt = Date.now()))
async function armyGap() {
    const wait = boxMullerRandom(5000, 10_000) - (Date.now() - lastArmyAt)
    if (wait > 0)
        await sleep(wait)
    lastArmyAt = Date.now()
}

const asRows = value => Array.isArray(value) ? value : []

/** Every rule row as `{ to, from, wodID, below, upTo, keep }`, troops first. */
function ruleLines() {
    const read = (key, item) => asRows(pluginOptions[key]).map(row => ({
        to: Number(row.toKingdom), from: Number(row.fromKingdom), wodID: Number(row[item]),
        below: Number(row.below), upTo: Number(row.upTo), keep: Math.max(0, Number(row.senderKeep) || 0),
    }))
    return [...read("troopRules", "troop"), ...read("toolRules", "tool")]
}

/**
 * The rules grouped by the kingdom they fill: `{ plans: [{ to, from, lines }], problems }`. The game takes one
 * transfer into a kingdom at a time, so the first rule for a kingdom names its sender and a rule naming another one
 * is left out. A rule into or out of Berimond, between one kingdom and itself, or whose top-up is under its floor, is left out too.
 */
function planRules(lines) {
    const plans = new Map()
    const problems = new Set()
    for (const line of lines) {
        const valid = KINGDOMS.has(line.to) && KINGDOMS.has(line.from) && line.to != line.from && units.has(line.wodID) &&
            line.below >= 1 && line.upTo >= line.below
        if (!valid) {
            problems.add("badRule")
            continue
        }
        if (!plans.has(line.to))
            plans.set(line.to, { to: line.to, from: line.from, lines: [] })
        const plan = plans.get(line.to)
        if (plan.from != line.from) {
            problems.add("twoSenders")
            continue
        }
        plan.lines.push(line)
    }
    return { plans: [...plans.values()], problems }
}

const amountIn = (castle, wodID) => castle.unitInventory?.find(unit => unit.unitInfo?.wodID == wodID)?.amount ?? 0
const inFlight = (castle, wodID) => (castle.troopTransfer?.units ?? []).filter(unit => unit.unitInfo?.wodID == wodID).reduce((sum, unit) => sum + unit.amount, 0)

/** The units the target holds, counting its own marches out and home, its orders, and a transfer already on its way to it. */
const heldBy = (castle, wodID) => stock.toolStock(wodID, { castle: { kingdom: castle.kingdomID, id: castle.id } }).total + inFlight(castle, wodID)

/** Skips the transfer on its way into `target`. A reply without a new timer leaves the old one, so the skip is counted down on it. */
async function skipTransfer(target, active) {
    while (transferLeftMs(target) > 0 && active()) {
        const before = target.troopTransfer
        const skip = spendSkip(transferLeftMs(target) / 1000)
        if (skip == undefined)
            return
        await pause(1000, 3000)
        const result = await ClientCommands.skipResourceTransfer(skip, target.kingdomID, KingdomSkipType.sendTroops).catch(() => undefined)
        if (result != 0) {
            if (skipRefused(skip, result))
                continue
            return
        }
        if (target.troopTransfer === before)
            before.remainingTime -= MinuteSkipType[skip] * 60
    }
}

/** The order the status names a blocker in when nothing was sent. */
const BLOCKERS = ["noCastle", "refused", "busy", "short"]
const STATUS_KEY = { noCastle: "statusTroopTransferNoCastle", refused: "statusTroopTransferRefused", busy: "statusTroopTransferBusy", short: "statusTroopTransferShort" }

const fewMinutes = () => boxMullerRandom(60_000, 3 * 60_000)

/** Rule problems already logged, so each is said once a session. */
const logged = new Set()

async function cycle(active) {
    const { plans, problems } = planRules(ruleLines())
    for (const problem of problems)
        if (!logged.has(problem)) {
            logged.add(problem)
            console.warn(problem == "twoSenders" ? "troopTransferTwoSenders" : "troopTransferBadRule")
        }
    if (plans.length == 0) {
        reportStatus("waiting", problems.has("badRule") ? "statusTroopTransferBadRule" : "statusTroopTransferNoRules")
        return 60 * 60_000
    }
    const dryRun = Boolean(pluginOptions.dryRunTransfers)
    await stock.refreshHome()

    const outcomes = []
    const promised = new Map()
    let transfers = 0, sentUnits = 0, soonest, shortItem
    for (const plan of plans) {
        const target = kingdomCastle(plan.to), source = kingdomCastle(plan.from)
        if (!target?.unitInventory || !source?.unitInventory) {
            outcomes.push("noCastle")
            continue
        }
        const sending = []
        let short = false
        for (const line of plan.lines) {
            const has = heldBy(target, line.wodID)
            if (has >= line.below)
                continue
            const needed = line.upTo - has
            const key = `${plan.from}:${line.wodID}`
            if (amountIn(source, line.wodID) - line.keep - (promised.get(key) ?? 0) < needed) {
                short = true
                shortItem ??= String(units.get(line.wodID).type)
                continue
            }
            sending.push([line.wodID, needed])
        }
        if (sending.length == 0) {
            outcomes.push(short ? "short" : "met")
            continue
        }
        if (transferLeftMs(target) > 0 && pluginOptions.useTimeSkips && !dryRun)
            await skipTransfer(target, active)
        if (transferLeftMs(target) > 0) {
            soonest = Math.min(soonest ?? Infinity, transferLeftMs(target))
            outcomes.push("busy")
            continue
        }
        if (!active())
            return
        const request = { SCID: source.id, SKID: source.kingdomID, TKID: target.kingdomID, CID: -1, A: sending }
        if (dryRun)
            console.log("dryRunKut", JSON.stringify(request))
        else {
            await armyGap()
            if (!active())
                return
            const result = await ClientCommands.kingdomTroopTransfer(source.id, source.kingdomID, target.kingdomID, sending).catch(error => error)
            if (result !== 0) {
                console.warn("troopTransferRefused", JSON.stringify(request), " ", err[result] ?? result)
                outcomes.push("refused")
                continue
            }
            console.log("troopTransferSent", JSON.stringify(request))
        }
        for (const [wodID, amount] of sending) {
            const key = `${plan.from}:${wodID}`
            promised.set(key, (promised.get(key) ?? 0) + amount)
            sentUnits += amount
        }
        transfers++
        outcomes.push("sent")
    }

    if (transfers > 0)
        reportStatus("running", "statusTroopTransferSent", { transfers, units: sentUnits })
    else if (outcomes.every(outcome => outcome == "met"))
        reportStatus("waiting", "statusTroopTransferTargetsMet")
    else {
        const blocker = BLOCKERS.find(b => outcomes.includes(b))
        reportStatus("waiting", STATUS_KEY[blocker], blocker == "short" ? { item: shortItem } : {})
    }
    const next = boxMullerRandom(28 * 60_000, 32 * 60_000)
    return soonest !== undefined ? Math.min(next, soonest + fewMinutes()) : next
}

events.once("load", () => chore("troopTransfer", cycle, boxMullerRandom(2 * 60_000, 5 * 60_000)))
