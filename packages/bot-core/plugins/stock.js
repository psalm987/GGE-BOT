if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { castles, movements } = require("../protocols.js")
const { playerInfo } = require("../ggeBot.js")
const { ask } = require("../chores.js")

/** The production queue shared by both workshops of a castle. */
const TOOLS_LIST = 1
/** A queue read stays in the count this long. Its orders turn into stock at home, which a castle refresh also counts. */
const QUEUE_TTL_MS = 30 * 60_000

const castleKey = castle => `${castle.kingdomID}:${castle.id}`

/** @type {Map<String, {readAt: Number, orders: Map<Number, Number>}>} */
const queues = new Map()

/**
 * An order the queue lists, as `{ wodID, amount }`, or undefined when its shape is unknown. Not captured from the
 * game yet: it takes the names `bup` sends (WID, AMT) or a `[wodID, amount]` pair.
 */
function orderOf(slot) {
    const order = slot?.P
    const wodID = Array.isArray(order) ? order[0] : order?.WID
    const amount = Array.isArray(order) ? order[1] : order?.AMT
    return Number.isFinite(Number(wodID)) && Number.isFinite(Number(amount)) ? { wodID: Number(wodID), amount: Number(amount) } : undefined
}

/**
 * What an `spl` reply says about a queue: the orders waiting or in production, the slots that are free to fill
 * (the rule the old barracks plugin used: no order in it and not locked, `SI.RUT` 0), and the seconds left on the
 * order in production. `PS`, the order in production, counts when it parses. The queue is `unknown` when the reply
 * has no `QS` or an occupied slot's order can't be read, since what it holds can't be counted then.
 */
function parseQueue(reply) {
    const orders = new Map()
    const add = order => orders.set(order.wodID, (orders.get(order.wodID) ?? 0) + order.amount)
    let freeSlots = 0
    let unknown = !Array.isArray(reply.QS)
    for (const slot of Array.isArray(reply.QS) ? reply.QS : []) {
        if (slot?.P) {
            const order = orderOf(slot)
            if (order)
                add(order)
            else
                unknown = true
        } else if (slot && slot.SI?.RUT !== 0)
            freeSlots++
    }
    const producing = reply.PS && typeof reply.PS == "object" ? orderOf({ P: reply.PS }) : undefined
    if (producing)
        add(producing)
    return { orders, freeSlots, unknown, seconds: Number.isFinite(Number(reply.TCT)) ? Number(reply.TCT) : undefined }
}

/**
 * Reads `castle`'s tool queue. The queue belongs to the castle the bot is in, so call this from inside setCastle.
 * Resolves to `{ freeSlots, seconds, unknown }`, or undefined when the game doesn't answer.
 */
async function readQueue(castle) {
    const { reply, result } = await ask("spl", { LID: TOOLS_LIST })
    if (result !== 0)
        return
    const { orders, freeSlots, seconds, unknown } = parseQueue(reply)
    if (unknown)
        console.warn("stockQueueUnknown", castleKey(castle), JSON.stringify(reply))
    queues.set(castleKey(castle), { readAt: Date.now(), orders })
    return { freeSlots, seconds, unknown }
}

/** Counts an order the bot just queued, until the next read of that queue replaces it. */
function noteQueued(castle, wodID, amount) {
    const entry = queues.get(castleKey(castle)) ?? { readAt: Date.now(), orders: new Map() }
    entry.orders.set(wodID, (entry.orders.get(wodID) ?? 0) + amount)
    queues.set(castleKey(castle), entry)
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
 * How many of tool `wodID` the account holds: `home` in castles, `queued` in the workshops and `travelling` with its
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
        const queue = queues.get(castleKey(castle))
        if (queue && Date.now() - queue.readAt < QUEUE_TTL_MS)
            queued += queue.orders.get(wodID) ?? 0
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

module.exports = { toolStock, readQueue, noteQueued, refreshHome, parseQueue, TOOLS_LIST, QUEUE_TTL_MS }
