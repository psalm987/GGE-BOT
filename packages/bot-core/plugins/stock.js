if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { castles, movements, castleQueue } = require("../protocols.js")
const { playerInfo, xtHandler } = require("../ggeBot.js")
const { ask } = require("../chores.js")

const { UNITS_LIST, TOOLS_LIST } = require("../orderable.js")
const LISTS = [UNITS_LIST, TOOLS_LIST]
/** A queue read stays in the count this long. Its orders turn into stock at home, which a castle refresh also counts. */
const QUEUE_TTL_MS = 30 * 60_000

const castleKey = castle => `${castle.kingdomID}:${castle.id}`
const queueKey = (castle, list) => `${list}:${castleKey(castle)}`

/** @type {Map<String, {readAt: Number, orders: Map<Number, Number>}>} */
const queues = new Map()

/**
 * When each list last changed: the bot queued an order, or the game sent an `spl` for it. A join's copy of a list from
 * before that is stale. Any castle's change counts, since the bot joins again on its way back to another castle.
 * @type {Map<Number, Number>}
 */
const changedAt = new Map()
// An `spl` that names no list may be either list.
xtHandler.on("spl", reply => {
    for (const list of reply?.LID === undefined ? LISTS : [Number(reply.LID)])
        changedAt.set(list, Date.now())
})

/**
 * An order the queue lists, as `{ wodID, amount }`, or undefined when its shape is unknown. The order in production
 * (`PS`) was captured: `{ WID, TUA }` with the seconds left in `RCT`. A filled queue slot was never captured, so a
 * slot's order is read from its `P` or from the slot itself, as a `[wodID, amount]` pair or with the names `PS` uses
 * (WID, TUA) or `bup` sends (WID, AMT).
 */
function orderOf(slot) {
    const order = slot?.P ?? slot
    const wodID = Array.isArray(order) ? order[0] : order?.WID
    const amount = Array.isArray(order) ? order[1] : order?.TUA ?? order?.AMT
    return Number.isFinite(Number(wodID)) && Number.isFinite(Number(amount)) ? { wodID: Number(wodID), amount: Number(amount) } : undefined
}

/** Whether a slot shows nothing but its lock state: only `SI`, and in it only `RUT` and `VIP`. */
const isBareSlot = slot => Object.keys(slot).every(key => key == "SI") && Object.keys(slot.SI ?? {}).every(key => key == "RUT" || key == "VIP")

/**
 * What an `spl` reply says about a queue: the orders waiting or in production, the slots that are free to fill
 * (the rule the old barracks plugin used: no order in it and not locked, `SI.RUT` 0), and the seconds left on the
 * order in production. `PS`, the order in production, counts when it parses. The queue is `unknown` when the reply
 * has no `QS` or an occupied slot's order can't be read, since what it holds can't be counted then.
 *
 * `psIdle` is true when nothing is in production, which the game shows as an empty `PS`. `emptySlots` counts the
 * slots that are shown free and nothing else: a bare `SI` with `RUT` not 0, which is how a free slot was captured.
 * A slot with anything more in it is not counted, so a shape nobody has seen never reads as room.
 */
function parseQueue(reply) {
    const orders = new Map()
    const add = order => orders.set(order.wodID, (orders.get(order.wodID) ?? 0) + order.amount)
    let freeSlots = 0, emptySlots = 0
    let unknown = !Array.isArray(reply.QS)
    for (const slot of Array.isArray(reply.QS) ? reply.QS : []) {
        if (slot?.P) {
            const order = orderOf(slot)
            if (order)
                add(order)
            else
                unknown = true
        } else if (slot && slot.SI?.RUT !== 0) {
            freeSlots++
            if (isBareSlot(slot))
                emptySlots++
            else if (orderOf(slot))
                add(orderOf(slot))
            else
                unknown = true
        }
    }
    const busy = reply.PS && typeof reply.PS == "object" && Object.keys(reply.PS).length > 0
    const producing = busy ? orderOf({ P: reply.PS }) : undefined
    if (producing)
        add(producing)
    else if (busy)
        unknown = true
    return { orders, freeSlots, emptySlots, psIdle: !busy, unknown, seconds: Number.isFinite(Number(reply.TCT)) ? Number(reply.TCT) : undefined }
}

/** The list as the game sends it for the castle the bot is in, or undefined when it doesn't answer. */
async function askQueue(list) {
    const { reply, result } = await ask("spl", { LID: list })
    // The game also pushes an `spl` when a list finishes an order, and `ask` takes the first one it sees.
    return result !== 0 || reply.LID !== undefined && Number(reply.LID) != list ? undefined : reply
}

/**
 * Reads `castle`'s production queue for `list` (the tools' by default). The queue belongs to the castle the bot is in,
 * so call this from inside setCastle. The castle's join carries its lists, as Lazy Lord reads them, so the bot asks
 * with `spl` only when the join didn't carry this one or the list changed since. Resolves to
 * `{ freeSlots, emptySlots, psIdle, seconds, unknown }`, or undefined when the game doesn't answer.
 */
async function readQueue(castle, list = TOOLS_LIST) {
    const joined = castleQueue(castle.kingdomID, castle.id, list)
    const fresh = joined && joined.at > (changedAt.get(list) ?? -Infinity)
    const reply = fresh ? joined.spl : await askQueue(list)
    if (!reply)
        return
    const { orders, freeSlots, emptySlots, psIdle, seconds, unknown } = parseQueue(reply)
    if (unknown)
        console.warn("stockQueueUnknown", castleKey(castle), JSON.stringify(reply))
    queues.set(queueKey(castle, list), { readAt: fresh ? joined.at : Date.now(), orders })
    return { freeSlots, emptySlots, psIdle, seconds, unknown }
}

/** Counts an order the bot just queued, until the next read of that queue replaces it. */
function noteQueued(castle, wodID, amount, list = TOOLS_LIST) {
    changedAt.set(list, Date.now())
    const entry = queues.get(queueKey(castle, list)) ?? { readAt: Date.now(), orders: new Map() }
    entry.orders.set(wodID, (entry.orders.get(wodID) ?? 0) + amount)
    queues.set(queueKey(castle, list), entry)
}

/** Fetches the castle list, which carries every castle's units and tools, so the home count is current. */
async function refreshHome() {
    await ask("dcl", { CD: 1 })
}

const inScope = (kingdomID, castleID, { kingdom, castle } = {}) =>
    (kingdom === undefined || kingdom == kingdomID) && (castle === undefined || castle.kingdom == kingdomID && castle.id == castleID)

const isOurs = movement => movement.owner?.ownerID == playerInfo.playerID

/** The castle a movement of ours belongs to: where it comes home to, or where it left from. */
const homeOf = movement => (movement.targetOwner?.ownerID == movement.owner?.ownerID ? movement.targetAttack : movement.sourceAttack)?.extraData?.[0]

/**
 * How many of tool or troop `wodID` the account holds: `home` in castles, `queued` in the workshops and `travelling` with its
 * marches. `scope` narrows it to a `kingdom` or to one `castle` ({ kingdom, id }).
 */
function toolStock(wodID, scope = {}) {
    let home = 0, queued = 0, travelling = 0
    for (const castle of castles) {
        if (!inScope(castle.kingdomID, castle.id, scope))
            continue
        for (const unit of castle.unitInventory ?? [])
            if (unit.unitInfo?.wodID == wodID)
                home += unit.amount
        for (const list of LISTS) {
            const queue = queues.get(queueKey(castle, list))
            if (queue && Date.now() - queue.readAt < QUEUE_TTL_MS)
                queued += queue.orders.get(wodID) ?? 0
        }
    }
    for (const movement of movements) {
        if (!isOurs(movement) || !inScope(movement.kingdomID, homeOf(movement), scope))
            continue
        for (const unit of [movement.left, movement.middle, movement.right, movement.courtyard, movement.station].flat())
            if (unit?.unitInfo?.wodID == wodID)
                travelling += unit.amount
    }
    return { home, queued, travelling, total: home + queued + travelling }
}

module.exports = { toolStock, readQueue, noteQueued, refreshHome, parseQueue, UNITS_LIST, TOOLS_LIST, QUEUE_TTL_MS }
