/**
 * What the bot last read from the game, shaped for the screens that show it back to the player: each castle's stores,
 * the marches on the map and what the account gained since sign-in. Pure, so it runs outside the worker.
 * The shape is `ReadBack` in packages/contracts/src/read-back.ts, which also caps its size.
 */

const STOCK_KEYS = ["wood", "stone", "food", "coal", "oil", "glass", "iron", "honey", "mead", "aqua"]
const MAX_CASTLES = 40
const MAX_MOVEMENTS = 50
const MAX_NAME = 64

/** `M.T` of a march that fights: a player's attack and its event variants, the Khan's taunt (20) and an attack on his camp (21). */
const ATTACK_TYPES = [0, 20, 21, 24, 25, 29, 31]
/** `MOVEMENTTYPE_DEFENCE`: troops sent to stand in a castle (docs/protocol/stationing.md). */
const STATION_TYPE = 1

const capitalize = key => key[0].toUpperCase() + key.slice(1)
const whole = value => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0

/** What the castle eats of a good each hour, which the game lists apart from what it makes. */
function eatenPerHour(production, key) {
    const rate = production[`${capitalize(key)}ConsumptionRate`]
    if (!Number.isFinite(rate))
        return 0
    const factor = production[`${key}ConsumptionReductionPercentage`]
    return rate * (Number.isFinite(factor) ? factor : 1)
}

function stockOf(castle) {
    const production = castle.getProductionData
    if (!production)
        return undefined
    const stock = {}
    for (const key of STOCK_KEYS) {
        const made = production[`delta${capitalize(key)}`]
        const entry = {
            amount: whole(castle[key]),
            max: whole(production[`maxAmount${capitalize(key)}`]),
            perHour: Math.round((Number.isFinite(made) ? made : 0) - eatenPerHour(production, key)),
        }
        if (entry.amount || entry.perHour)
            stock[key] = entry
    }
    return stock
}

const placeOf = area => ({
    type: area.type, x: area.x, y: area.y,
    name: typeof area.extraData?.[7] == "string" && area.extraData[7] ? area.extraData[7].slice(0, MAX_NAME) : null,
})

/** Soldiers in the march, leaving out tools; null when the game shows no army for it. */
function troopsOf(movement) {
    const units = [movement.left, movement.middle, movement.right, movement.courtyard, movement.station].flat()
    if (!movement.canSeeArmy && !movement.station?.length)
        return null
    return units.reduce((total, unit) => unit.unitInfo?.role ? total + unit.amount : total, 0)
}

function kindOf(movement, playerID) {
    if (movement.type == STATION_TYPE)
        return "station"
    if (movement.owner.ownerID == playerID && movement.targetOwner.ownerID == playerID)
        return "return"
    return ATTACK_TYPES.includes(movement.type) ? "attack" : "other"
}

function sideOf(movement, kind, playerID) {
    if (movement.owner.ownerID == playerID)
        return "own"
    if (movement.targetOwner.ownerID != playerID)
        return "other"
    return kind == "attack" ? "incoming" : "support"
}

/** A player wants to see what is coming at them first, then what they sent; other players' marches fill what room is left. */
const SIDE_ORDER = { incoming: 0, support: 1, own: 2, other: 3 }

function marchOf(movement, playerID) {
    const kind = kindOf(movement, playerID)
    const side = sideOf(movement, kind, playerID)
    return {
        id: movement.id, side, kind, kingdom: movement.kingdomID,
        from: placeOf(movement.sourceAttack), to: placeOf(movement.targetAttack),
        sender: side != "own" && typeof movement.owner.name == "string" && movement.owner.name ? movement.owner.name.slice(0, MAX_NAME) : null,
        troops: troopsOf(movement),
        totalSeconds: whole(movement.totalTime / 1000),
        arrivesAt: Math.round(movement.arrivesAt),
    }
}

/**
 * @param {Object} read
 * @param {Array} read.castles the castles as protocols.js keeps them
 * @param {Array} read.movements the marches as protocols.js keeps them
 * @param {Number} read.playerID
 * @param {{startedAt: Number, coins: Number|null, rubies: Number|null}} read.session
 * @param {Number} [read.now] epoch milliseconds
 */
function buildReadBack({ castles, movements, playerID, session, now = Date.now() }) {
    // A stationed army stays in the game's list after it arrives, and it is no longer a march.
    const underway = movements.filter(movement => Number.isFinite(movement.arrivesAt) && movement.arrivesAt > now)
        .map(movement => marchOf(movement, playerID))
        .sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.arrivesAt - b.arrivesAt)
    return {
        at: now,
        castles: castles.flatMap(castle => {
            const stock = stockOf(castle)
            return stock ? { kingdom: castle.kingdomID, id: castle.id, readAt: Number.isFinite(castle.unitsSyncedAt) ? castle.unitsSyncedAt : now, stock } : []
        }).slice(0, MAX_CASTLES),
        movements: underway.slice(0, MAX_MOVEMENTS),
        movementCount: underway.length,
        session: { startedAt: Math.round(session.startedAt), coins: gained(session.coins), rubies: gained(session.rubies) },
    }
}

const gained = value => Number.isFinite(value) ? Math.round(value) : null

module.exports = { buildReadBack, MAX_CASTLES, MAX_MOVEMENTS }
