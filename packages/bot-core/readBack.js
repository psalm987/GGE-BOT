/**
 * What the bot last read from the game, shaped for the screens that show it back to the player: each castle's stores,
 * the marches on the map, what the account gained since sign-in, the main castle's defence and the Khan rage bar.
 * Pure, so it runs outside the worker.
 * The shape is `ReadBack` in packages/contracts/src/read-back.ts, which also caps its size.
 */

const STOCK_KEYS = ["wood", "stone", "food", "coal", "oil", "glass", "iron", "honey", "mead", "aqua"]
const MAX_CASTLES = 40
const MAX_MOVEMENTS = 50
const MAX_NAME = 64
const MAX_DEFENCE_SLOTS = 8
const MAX_DEFENCE_TOOLS = 24

const { defendersIn } = require("./khan.js")

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

/** The tools in a list of slots `[[wodID, amount]]`; an empty slot, which the game writes as `[-1, 0]`, is null. */
const slotsOf = slots => Array.from(slots ?? []).slice(0, MAX_DEFENCE_SLOTS)
    .map(([wodID, amount]) => wodID == -1 || !(amount > 0) ? null : { wodID: Number(wodID), amount: whole(amount) })

const figure = value => Number.isFinite(value) ? Math.max(0, value) : null
const level = value => Number.isFinite(value) ? whole(value) : null

/**
 * The defence of `castle` from `read`, the last `dfc` reply as defenceRead.js keeps it. The reply's area info `A`
 * holds the wall, gate and moat levels at 6, 7 and 9, as the client's `parseAreaInfo` reads them, and the reply names
 * the defence figures `dfw.D`, `GD` and `dfm.D`. The courtyard's room is `UYL` less the alliance's `AUYL`.
 */
function defenceOf(read, castle) {
    if (!read || !castle)
        return undefined
    const { layout: { A = [], dfw, dfm = {}, dfk = {}, GD }, readAt, stock } = read
    const side = key => ({ share: Math.min(100, whole(dfw[key]?.UP)), slots: slotsOf(dfw[key]?.S) })
    const room = whole(dfk.UYL - dfk.AUYL)
    return {
        kingdom: castle.kingdomID, id: castle.id, readAt,
        wall: { level: level(A[6]), defence: figure(dfw.D), troops: whole(dfw.U), room: whole(dfw.US), sides: { left: side("L"), front: side("M"), right: side("R") } },
        gate: { level: level(A[7]), defence: figure(GD) },
        moat: { level: level(A[9]), defence: figure(dfm.D), sides: { left: slotsOf(dfm.LS), front: slotsOf(dfm.MS), right: slotsOf(dfm.RS) } },
        courtyard: { troops: Math.min(room, whole(dfk.U)), room, allianceRoom: whole(dfk.AUYL) },
        defenders: defendersIn(castle.unitInventory),
        tools: stock.filter(({ amount, unitInfo }) => amount > 0 && unitInfo && !unitInfo.role && unitInfo.typ == "Defence")
            .sort((a, b) => b.amount - a.amount).slice(0, MAX_DEFENCE_TOOLS)
            .map(({ amount, unitInfo }) => ({ wodID: Number(unitInfo.wodID), amount: whole(amount) })),
    }
}

const positive = value => value > 0 && Number.isFinite(Number(value)) ? Math.round(value) : null

/** The Khan plugin's rage bar as khanRage.js hands it over, with a figure the plugin doesn't know yet as null. */
const rageOf = state => state && {
    rage: whole(state.rage), needed: positive(state.needed), campLevel: level(state.campLevel),
    lastGain: positive(state.lastGain), lastGainAt: Number.isFinite(state.lastGainAt) ? Math.round(state.lastGainAt) : null,
    eventRunning: Boolean(state.eventRunning), hold: state.hold ?? null,
}

/**
 * @param {Object} read
 * @param {Array} read.castles the castles as protocols.js keeps them
 * @param {Array} read.movements the marches as protocols.js keeps them
 * @param {Number} read.playerID
 * @param {{startedAt: Number, coins: Number|null, rubies: Number|null}} read.session
 * @param {Object} [read.mainCastle] the castle `read.defence` is of
 * @param {Object} [read.defence] the last defence read, from defenceRead.js
 * @param {Object} [read.khanRage] the rage bar, from khanRage.js
 * @param {Number} [read.now] epoch milliseconds
 */
function buildReadBack({ castles, movements, playerID, session, mainCastle, defence, khanRage, now = Date.now() }) {
    // A stationed army stays in the game's list after it arrives, and it is no longer a march.
    const underway = movements.filter(movement => Number.isFinite(movement.arrivesAt) && movement.arrivesAt > now)
        .map(movement => marchOf(movement, playerID))
        .sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.arrivesAt - b.arrivesAt)
    const sections = { defence: defenceOf(defence, mainCastle), khanRage: rageOf(khanRage) }
    return {
        at: now,
        castles: castles.flatMap(castle => {
            const stock = stockOf(castle)
            return stock ? { kingdom: castle.kingdomID, id: castle.id, readAt: Number.isFinite(castle.unitsSyncedAt) ? castle.unitsSyncedAt : now, stock } : []
        }).slice(0, MAX_CASTLES),
        movements: underway.slice(0, MAX_MOVEMENTS),
        movementCount: underway.length,
        session: { startedAt: Math.round(session.startedAt), coins: gained(session.coins), rubies: gained(session.rubies) },
        ...Object.fromEntries(Object.entries(sections).filter(([, section]) => section)),
    }
}

const gained = value => Number.isFinite(value) ? Math.round(value) : null

module.exports = { buildReadBack, MAX_CASTLES, MAX_MOVEMENTS, MAX_DEFENCE_SLOTS, MAX_DEFENCE_TOOLS }
