const rowColumns = (item, batch) => [
    { key: "castle", type: "castle" },
    { key: item, type: item, orderable: true },
    { key: "stock", type: "number", min: 1, max: 2_000_000_000, default: 1000 },
    { key: "batch", type: "number", min: 1, max: batch, default: Math.min(100, batch) },
]

/** One order holds at most this many tools bought with coins or resources (docs/protocol/tools.md). */
const MAX_TOOLS_PER_ORDER = 80

const optionDefs = [
    { type: "Rows", key: "troopTargets", columns: rowColumns("troop", 100_000), default: [] },
    { type: "Rows", key: "toolStockTargets", columns: rowColumns("tool", MAX_TOOLS_PER_ORDER), default: [] },
    { type: "Number", key: "coinFloor", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 100_000 },
    { type: "Number", key: "resourceFloor", min: 0, max: 100_000_000, step: 1000, default: 0 },
    { type: "Checkbox", key: "dryRunOrders", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig, xtHandler } = require("../ggeBot.js")
const { setCastle, castles, resources } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const { UNITS_LIST, TOOLS_LIST, orderListOf, priceOf } = require("../orderable.js")
const stock = require("./stock.js")
const loadItem = require("../paths.js").loadItem

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusRecruitToolsStarting")

/** The client's default for `bup`'s SK field. */
const CLIENT_SK = 73

/**
 * What a `bup` refusal says about the row, by the game's code: 10 coins and 55 resources short, 63 no free slot,
 * 87 a building or unit level the account lacks, 88 and 240 more than the game takes in one order. Any other code,
 * 11 (rubies) among them, is a plain refusal.
 */
const REFUSALS = { 10: "noResources", 55: "noResources", 63: "queueFull", 87: "levelLocked", 88: "tooMany", 240: "tooMany" }
const BACKOFF_ROUND = 15 * 60_000, BACKOFF_MAX = 60 * 60_000

const units = new Map(loadItem("units").map(unit => [Number(unit.wodID), unit]))

const asRows = value => Array.isArray(value) ? value : []
const asNumber = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback

/**
 * The rows of both lists as `{ list, wodID, unit, ref, stock, batch }`. A row that isn't a whole castle, item and
 * number is left out. A row whose item can't be ordered from its list with coins or resources is kept with `unit`
 * and answers "notOrderable", so a ruby price a stored row slipped in never reaches the game.
 */
function targetRows() {
    const read = (list, key, item) => asRows(pluginOptions[key]).map(row => ({
        list, wodID: Number(row[item]), ref: row.castle, stock: Number(row.stock), batch: Number(row.batch),
    }))
    return [...read(UNITS_LIST, "troopTargets", "troop"), ...read(TOOLS_LIST, "toolStockTargets", "tool")]
        .filter(row => units.has(row.wodID) && row.stock > 0 && row.batch > 0 && Number.isInteger(row.ref?.kingdom) && Number.isInteger(row.ref?.id))
        .map(row => ({ ...row, unit: units.get(row.wodID), orderable: orderListOf(units.get(row.wodID)) === row.list }))
}

const castleOf = ref => castles.find(castle => castle.kingdomID == ref.kingdom && castle.id == ref.id)

/** The buildings the plugin orders from, by the `name` the items give a unit and its building, with the plain name a status shows. */
const PRODUCERS = { Barracks: "barracks", Workshop: "siege workshop", Dworkshop: "defence workshop" }
const buildingItems = new Map(loadItem("buildings").filter(building => building.name in PRODUCERS).map(building => [Number(building.wodID), building]))

/** The most soldiers `castle` can order at once: what one slot of its best barracks takes (`stackSize`), or Infinity while that isn't known. */
const soldiersPerOrder = castle => Math.max(0, ...(castle.buildings ?? []).map(building => buildingItems.get(building.wodID))
    .filter(item => item?.name == "Barracks").map(item => Number(item.stackSize) || 0)) || Infinity

/**
 * What the game's refusals taught about each row, by `rowKey`. `cap` halves the order after "too many", `locked` stops
 * a row the account can't make, and `retryAt` holds a refused row back 1, 2, 4… rounds, an hour at most. `outcome` is
 * the refusal the status shows meanwhile.
 */
const learned = new Map()
const rowKey = row => `${row.list}:${row.ref.kingdom}:${row.ref.id}:${row.wodID}`
const heldBack = state => Boolean(state?.locked || state?.retryAt > Date.now())

function noteRefusal(state, outcome, amount) {
    state.outcome = outcome
    if (outcome == "levelLocked")
        state.locked = true
    else if (outcome == "tooMany" && amount > 1)
        state.cap = Math.floor(amount / 2)
    else {
        state.refusals = (state.refusals ?? 0) + 1
        state.retryAt = Date.now() + Math.min(BACKOFF_MAX, BACKOFF_ROUND * 2 ** (state.refusals - 1))
    }
}

/**
 * Why `castle` can't make `unit`, or undefined when it can or when that can't be told. It can be told only when the
 * castle's buildings are known and the items name the producing building's levels: `noBuilding` when the castle has
 * none of that building, `buildingLevel` when its best one is below the level the unit needs.
 */
function cantMake(castle, unit) {
    const producer = PRODUCERS[unit.name]
    if (!producer || !castle.buildings?.length || buildingItems.size == 0)
        return undefined
    const levels = castle.buildings.map(building => buildingItems.get(building.wodID)).filter(item => item?.name == unit.name).map(item => Number(item.level))
    if (levels.length == 0)
        return { outcome: "noBuilding", building: producer }
    const needed = Number(unit.buildingLevel)
    if (needed > 0 && Math.max(...levels) < needed)
        return { outcome: "buildingLevel", building: producer, level: String(needed) }
    return undefined
}

/** The reasons already logged for a castle and unit, so a plan that can't be made says so once, not every check. */
const reportedCantMake = new Map()

/** Outcomes of one row, best first. */
const OUTCOMES = ["ordered", "met", "queueUnknown", "queueFull", "coinFloor", "noResources", "tooMany", "refused", "levelLocked", "notOrderable", "noBuilding", "buildingLevel", "noCastle", "noAnswer"]
/** The blockers in the order the status names them when nothing was ordered. */
const BLOCKERS = ["notOrderable", "noCastle", "noBuilding", "buildingLevel", "levelLocked", "noAnswer", "queueUnknown", "queueFull", "coinFloor", "noResources", "tooMany", "refused"]
const STATUS_KEY = {
    notOrderable: "statusRecruitToolsNotOrderable", noCastle: "statusRecruitToolsNoCastle", noAnswer: "statusRecruitToolsNoAnswer", queueUnknown: "statusRecruitToolsQueueUnknown",
    queueFull: "statusRecruitToolsQueueFull", coinFloor: "statusRecruitToolsCoinFloor", noResources: "statusRecruitToolsNoResources", refused: "statusRecruitToolsRefused",
    noBuilding: "statusRecruitToolsNoBuilding", buildingLevel: "statusRecruitToolsBuildingLevel",
    tooMany: "statusRecruitToolsTooMany", levelLocked: "statusRecruitToolsLevelLocked",
}

const fewMinutes = () => boxMullerRandom(60_000, 3 * 60_000)

/**
 * Whether the reply to an order shows the game took it: the production list now has it in production when nothing
 * was, or one empty slot fewer. A reply that shows neither is not trusted, since a filled slot was never captured.
 */
function took(before, reply, order) {
    if (!reply.spl)
        return false
    const after = stock.parseQueue(reply.spl)
    if (after.unknown)
        return false
    return before.idle ? !after.psIdle && Number(reply.spl.PS?.WID) == order.WID : after.emptySlots == before.empty - 1
}

async function cycle(active) {
    const rows = targetRows()
    if (rows.length == 0) {
        reportStatus("waiting", "statusRecruitToolsNoTargets")
        return 60 * 60_000
    }
    const dryRun = Boolean(pluginOptions.dryRunOrders)
    const coinFloor = asNumber(pluginOptions.coinFloor, 100_000), resourceFloor = asNumber(pluginOptions.resourceFloor, 0)

    await stock.refreshHome()
    const outcomes = rows.map(() => new Set())
    const details = []
    const dryOrdered = new Map(), drySpent = new Map()
    let orders = 0, items = 0, soonest

    const places = new Map()
    rows.forEach((row, i) => {
        const castle = row.orderable ? castleOf(row.ref) : undefined
        if (!row.orderable)
            return outcomes[i].add("notOrderable")
        if (!castle)
            return outcomes[i].add("noCastle")
        const key = `${castle.kingdomID}:${castle.id}`
        places.set(key, { castle, indexes: [...places.get(key)?.indexes ?? [], i] })
    })

    /** What `castle` has of a price's resource right now, after the orders a dry run only logged. */
    const available = (resource, castle) => (resource == "coins" ? resources.coins : Number(castle[resource])) - (drySpent.get(`${castle.id}:${resource}`) ?? 0)
    const spend = (resource, castle, amount) => {
        const key = `${castle.id}:${resource}`
        if (dryRun)
            drySpent.set(key, (drySpent.get(key) ?? 0) + amount)
        else if (resource != "coins")
            castle[resource] -= amount
    }
    /** How many of `unit` the castle can pay for above the floors, and which floor stops it when that is 0. */
    function affordable(unit, castle) {
        let count = Infinity, blocker
        for (const [resource, price] of priceOf(unit)) {
            const left = Math.floor(((Number.isFinite(available(resource, castle)) ? available(resource, castle) : 0) - (resource == "coins" ? coinFloor : resourceFloor)) / price)
            if (left < count) {
                count = Math.max(0, left)
                blocker = resource == "coins" ? "coinFloor" : "noResources"
            }
        }
        return { count, blocker }
    }

    for (const { castle, indexes } of places.values()) {
        if (!active())
            return
        await setCastle(castle, async () => {
            for (const list of [UNITS_LIST, TOOLS_LIST]) {
                const mine = indexes.filter(i => {
                    if (rows[i].list != list)
                        return false
                    const state = learned.get(rowKey(rows[i]))
                    if (heldBack(state)) {
                        outcomes[i].add(state.outcome)
                        return false
                    }
                    const verdict = cantMake(castle, rows[i].unit)
                    if (!verdict)
                        return true
                    outcomes[i].add(verdict.outcome)
                    details[i] = verdict
                    const key = `${castle.kingdomID}:${castle.id}:${rows[i].wodID}`
                    if (reportedCantMake.get(key) != verdict.outcome) {
                        reportedCantMake.set(key, verdict.outcome)
                        if (verdict.outcome == "noBuilding")
                            console.warn("recruitCantMake", rows[i].unit.type, "recruitHasNo", verdict.building)
                        else
                            console.warn("recruitCantMake", rows[i].unit.type, "recruitNeedsLevel", verdict.level, "recruitOfA", verdict.building)
                    }
                    return false
                })
                if (mine.length == 0)
                    continue
                const queue = await stock.readQueue(castle, list)
                if (!queue) {
                    mine.forEach(i => outcomes[i].add("noAnswer"))
                    continue
                }
                if (queue.unknown) {
                    console.warn("recruitToolsQueueUnknown", castle.kingdomID, castle.id, list)
                    mine.forEach(i => outcomes[i].add("queueUnknown"))
                    continue
                }
                if (queue.seconds !== undefined && queue.seconds > 0)
                    soonest = Math.min(soonest ?? Infinity, queue.seconds)
                const room = { idle: queue.psIdle, empty: queue.emptySlots }
                for (const i of mine) {
                    const row = rows[i]
                    const dryKey = `${castle.id}:${row.wodID}`
                    const state = learned.get(rowKey(row)) ?? {}
                    const perOrder = Math.min(state.cap ?? Infinity, list == TOOLS_LIST ? MAX_TOOLS_PER_ORDER : row.unit.name == "Barracks" ? soldiersPerOrder(castle) : Infinity)
                    for (;;) {
                        const deficit = row.stock - stock.toolStock(row.wodID, { castle: { kingdom: castle.kingdomID, id: castle.id } }).total - (dryOrdered.get(dryKey) ?? 0)
                        if (deficit <= 0) {
                            outcomes[i].add("met")
                            break
                        }
                        if (!room.idle && room.empty == 0) {
                            outcomes[i].add("queueFull")
                            break
                        }
                        const { count, blocker } = affordable(row.unit, castle)
                        const amount = Math.min(row.batch, deficit, perOrder, count)
                        if (!(amount > 0)) {
                            outcomes[i].add(blocker)
                            break
                        }
                        if (!active())
                            return
                        const order = { LID: list, WID: row.wodID, AMT: amount, PO: -1, PWR: 0, SK: CLIENT_SK, SID: castle.kingdomID, AID: castle.id }
                        if (dryRun) {
                            console.log("dryRunBup", JSON.stringify(order))
                            dryOrdered.set(dryKey, (dryOrdered.get(dryKey) ?? 0) + amount)
                            if (room.idle)
                                room.idle = false
                            else
                                room.empty--
                        } else {
                            const { reply, result } = await ask("bup", order)
                            if (result !== 0) {
                                console.warn("recruitToolsRefused", JSON.stringify(order), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
                                const outcome = REFUSALS[result] ?? "refused"
                                noteRefusal(state, outcome, amount)
                                learned.set(rowKey(row), state)
                                outcomes[i].add(outcome)
                                if (outcome == "levelLocked")
                                    console.warn("recruitToolsLevelLocked", String(row.unit.type))
                                if (outcome == "queueFull") {
                                    room.idle = false
                                    room.empty = 0
                                }
                                break
                            }
                            state.refusals = 0
                            state.retryAt = 0
                            if (!took(room, reply, order)) {
                                console.warn("recruitToolsQueueUnknown", castle.kingdomID, castle.id, list, JSON.stringify(reply.spl))
                                outcomes[i].add("queueUnknown")
                                room.idle = false
                                room.empty = 0
                                break
                            }
                            const after = stock.parseQueue(reply.spl)
                            room.idle = after.psIdle
                            room.empty = after.emptySlots
                            stock.noteQueued(castle, row.wodID, amount, list)
                            if (reply.gcu)
                                xtHandler.emit("gcu", reply.gcu)
                        }
                        for (const [resource, price] of priceOf(row.unit))
                            spend(resource, castle, price * amount)
                        orders++
                        items += amount
                        outcomes[i].add("ordered")
                        await pause(1500, 4000)
                    }
                }
            }
        })
        await pause(2000, 6000)
    }

    const finals = outcomes.map(set => OUTCOMES.find(outcome => set.has(outcome)) ?? "noAnswer")
    if (orders > 0)
        reportStatus("running", "statusRecruitToolsOrdered", { orders, items })
    else if (finals.every(outcome => outcome == "met"))
        reportStatus("waiting", "statusRecruitToolsTargetsMet")
    else {
        const blocker = BLOCKERS.find(b => finals.includes(b))
        const at = finals.indexOf(blocker)
        const { building, level } = details[at] ?? {}
        reportStatus("waiting", STATUS_KEY[blocker], { item: String(rows[at].unit.type), ...(building && { building }), ...(level && { level }) })
    }
    return (soonest !== undefined ? soonest * 1000 : 15 * 60_000) + fewMinutes()
}

events.once("load", () => chore("recruitTools", cycle, boxMullerRandom(3 * 60_000, 8 * 60_000)))
