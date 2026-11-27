/**
 * What the bot last read from the game, shaped for the screens that show it back to the player: each castle's stores,
 * units and order, the marches on the map, the main castle's defence and the
 * Khan rage bar.
 * Pure, so it runs outside the worker.
 * The shape is `ReadBack` in packages/contracts/src/read-back.ts, which also caps its size.
 */

const STOCK_KEYS = ["wood", "stone", "food", "coal", "oil", "glass", "iron", "honey", "mead", "aqua"]
const MAX_CASTLES = 40
const MAX_MOVEMENTS = 50
const MAX_NAME = 64
const MAX_DEFENCE_SLOTS = 8
const MAX_DEFENCE_TOOLS = 24
const MAX_UNIT_KINDS = 24

const { defendersIn } = require("./khan.js")

/**
 * `M.T` of a march that fights, as the game client's MapmovementFactory sorts them (Lazy Lord's travelOverview.js): 0 an
 * attack, 11 NPC, 17 alien, 18 Berimond, 19 alliance city, 20 the Khan's taunt and 21 an attack on his camp, 23-25
 * collector, 27 and 28 Daimyo, 29 alliance battle ground, 30 and 31 temporary-server charges, 33 alliance tower, 34 Wolf
 * King taunt. Support (1, 26, 32), spies, carts and the like don't fight.
 */
const ATTACK_TYPES = new Set([0, 11, 17, 18, 19, 20, 21, 23, 24, 25, 27, 28, 29, 30, 31, 33, 34])
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

/** How many of each kind, the largest stocks first. `units` are `{ unitInfo, amount }` as protocols.js reads them. */
function unitCounts(units, cap) {
    const byKind = new Map()
    for (const { unitInfo, amount } of units)
        if (unitInfo && amount > 0)
            byKind.set(Number(unitInfo.wodID), (byKind.get(Number(unitInfo.wodID)) ?? 0) + whole(amount))
    return [...byKind].map(([wodID, amount]) => ({ wodID, amount })).sort((a, b) => b.amount - a.amount).slice(0, cap)
}

const isDefender = unitInfo => Boolean(unitInfo.role) && unitInfo.fightType == 1
/** The group of `ReadBackCastle.units` a unit falls in, as the game's military overview sorts soldiers and tools. */
const groupOf = unitInfo => unitInfo.role ? (isDefender(unitInfo) ? "defenders" : "attackers") : unitInfo.typ == "Defence" ? "defenceTools" : "attackTools"
const UNIT_GROUPS = ["defenders", "attackers", "defenceTools", "attackTools"]

function unitsOf(castle) {
    const groups = Object.fromEntries(UNIT_GROUPS.map(group => [group, []]))
    for (const unit of [...castle.unitInventory ?? [], ...castle.strongHoldInventory ?? []])
        if (unit.unitInfo)
            groups[groupOf(unit.unitInfo)].push(unit)
    return Object.fromEntries(UNIT_GROUPS.map(group => [group, unitCounts(groups[group], MAX_UNIT_KINDS)]))
}

const figure = value => Number.isFinite(value) ? Math.max(0, value) : null
const level = value => Number.isFinite(value) ? whole(value) : null

/**
 * Public order and the productivity it gives, as the game client's LawAndOrderConst counts them: decoration less riot
 * and sickness, and production grows (or shrinks) with its square root. Research and castellan bonuses aren't known.
 */
function orderOf(production) {
    if (!Number.isFinite(production.decorationPoints))
        return { publicOrder: null, productivity: null }
    const order = production.decorationPoints - ((production.decorationPointsReduction || 0) + (production.sickness || 0))
    const factor = order < 0 ? 1 / (Math.sqrt(-order) / 50 + 1) : Math.sqrt(order) / 50 + 1
    return { publicOrder: Math.round(order), productivity: Math.round(100 * factor) }
}

function castleOf(castle, now) {
    const stock = stockOf(castle)
    if (!stock)
        return []
    const production = castle.getProductionData
    return {
        kingdom: castle.kingdomID, id: castle.id, readAt: Number.isFinite(castle.unitsSyncedAt) ? castle.unitsSyncedAt : now, stock,
        units: unitsOf(castle), ...orderOf(production), guards: level(production.guardCount), population: level(production.population),
    }
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

/** A march home comes from elsewhere; one between the account's own castles moves goods on a cart or troops. */
function kindOf(movement, playerID) {
    const home = movement.owner.ownerID == playerID && movement.targetOwner.ownerID == playerID
    if (home && movement.sourceOwner?.ownerID != playerID)
        return "return"
    if (movement.type == STATION_TYPE)
        return "station"
    if (ATTACK_TYPES.has(movement.type))
        return "attack"
    if (Object.values(movement.resources ?? {}).some(amount => amount > 0))
        return "market"
    return home ? "transfer" : "other"
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
        stationedUntil: movement.endsAt > movement.arrivesAt ? Math.round(movement.endsAt) : null,
    }
}

/** The tools in a list of slots `[[wodID, amount]]`; an empty slot, which the game writes as `[-1, 0]`, is null. */
const slotsOf = slots => Array.from(slots ?? []).slice(0, MAX_DEFENCE_SLOTS)
    .map(([wodID, amount]) => wodID == -1 || !(amount > 0) ? null : { wodID: Number(wodID), amount: whole(amount) })

/**
 * The defence of `castle` from `read`, the last `dfc` reply as defenceRead.js keeps it. The reply's area info `A`
 * holds the wall, gate and moat levels at 6, 7 and 9, as the client's `parseAreaInfo` reads them, and the reply names
 * the defence figures `dfw.D`, `GD` and `dfm.D`. The courtyard's room is `UYL` less the alliance's `AUYL`, and its tool
 * slots are `dfk.S`. The soldiers and tools all come from the reply's own storage, so they agree with each other.
 */
function defenceOf(read, castle) {
    if (!read || !castle)
        return undefined
    const { layout: { A = [], dfw, dfm = {}, dfk = {}, GD }, readAt, stock, extraFlankSlot } = read
    const side = key => ({ share: Math.min(100, whole(dfw[key]?.UP)), slots: slotsOf(dfw[key]?.S) })
    const room = whole(dfk.UYL - dfk.AUYL)
    return {
        kingdom: castle.kingdomID, id: castle.id, readAt,
        wall: {
            level: level(A[6]), defence: figure(dfw.D), troops: whole(dfw.U), room: whole(dfw.US), extraFlankSlot: Boolean(extraFlankSlot),
            sides: { left: side("L"), front: side("M"), right: side("R") },
        },
        gate: { level: level(A[7]), defence: figure(GD) },
        moat: { level: level(A[9]), defence: figure(dfm.D), sides: { left: slotsOf(dfm.LS), front: slotsOf(dfm.MS), right: slotsOf(dfm.RS) } },
        courtyard: { troops: Math.min(room, whole(dfk.U)), room, allianceRoom: whole(dfk.AUYL), slots: slotsOf(dfk.S) },
        defenders: defendersIn(stock),
        defenderUnits: unitCounts(stock.filter(({ unitInfo }) => unitInfo && isDefender(unitInfo)), MAX_UNIT_KINDS),
        tools: unitCounts(stock.filter(({ unitInfo }) => unitInfo && !unitInfo.role && unitInfo.typ == "Defence"), MAX_DEFENCE_TOOLS),
    }
}

const positive = value => value > 0 && Number.isFinite(Number(value)) ? Math.round(value) : null

/**
 * The figures of the camp the account fights, from the game's `eventAutoScalingCamps` rows. The difficulties of one
 * level share its rage cap and critical chance but differ in the rage a hit earns, so that needs the camp's own row,
 * found by the camp id the map shows.
 */
function campFigures(campLevel, needed, rows, campsOnMap) {
    const ofLevel = rows.filter(row => Number(row.camplevel) == campLevel && Number(row.playerRageCap) == needed)
    const chances = new Set(ofLevel.map(row => Number(row.chanceForCriticalRageGeneration) || 0))
    const own = ofLevel.find(row => campsOnMap.includes(Number(row.eventAutoScalingCampID)))
    return { baseRage: positive(Number(own?.generatedRagePerAttack)), critChance: chances.size == 1 ? Math.min(100, [...chances][0]) : null }
}

/** The Khan plugin's rage bar as khanRage.js hands it over, with a figure the plugin doesn't know yet as null. */
function rageOf(state, { khanCamps, khanCampsOnMap, defence }) {
    if (!state)
        return undefined
    const needed = positive(state.needed), campLevel = level(state.campLevel)
    return {
        rage: whole(state.rage), needed, campLevel,
        lastGain: positive(state.lastGain), lastGainAt: Number.isFinite(state.lastGainAt) ? Math.round(state.lastGainAt) : null,
        eventRunning: Boolean(state.eventRunning), hold: state.hold ?? null,
        ...campFigures(campLevel, needed, khanCamps, khanCampsOnMap),
        rageTools: defence ? unitCounts(defence.stock.filter(({ unitInfo }) => Number(unitInfo?.ragePointBonus) > 0), MAX_DEFENCE_TOOLS) : null,
    }
}

/**
 * @param {Object} read
 * @param {Array} read.castles the castles as protocols.js keeps them
 * @param {Array} read.movements the marches as protocols.js keeps them
 * @param {Number} read.playerID
 * @param {Object} [read.mainCastle] the castle `read.defence` is of
 * @param {Object} [read.defence] the last defence read, from defenceRead.js
 * @param {Object} [read.khanRage] the rage bar, from khanRage.js
 * @param {Array} [read.khanCamps] the game's `eventAutoScalingCamps` rows
 * @param {Number[]} [read.khanCampsOnMap] the ids of the Khan camps on the bot's map
 * @param {Number} [read.now] epoch milliseconds
 */
function buildReadBack({ castles, movements, playerID, mainCastle, defence, khanRage, khanCamps = [], khanCampsOnMap = [], now = Date.now() }) {
    // A stationed army stays on the list until its stay is over, as the game's own overview keeps it.
    const underway = movements.filter(movement => Number.isFinite(movement.arrivesAt) && Math.max(movement.arrivesAt, movement.endsAt || 0) > now)
        .map(movement => marchOf(movement, playerID))
        .sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || a.arrivesAt - b.arrivesAt)
    const sections = { defence: defenceOf(defence, mainCastle), khanRage: rageOf(khanRage, { khanCamps, khanCampsOnMap, defence }) }
    return {
        at: now,
        castles: castles.flatMap(castle => castleOf(castle, now)).slice(0, MAX_CASTLES),
        movements: underway.slice(0, MAX_MOVEMENTS),
        movementCount: underway.length,
        ...Object.fromEntries(Object.entries(sections).filter(([, section]) => section)),
    }
}

module.exports = { buildReadBack, MAX_CASTLES, MAX_MOVEMENTS, MAX_DEFENCE_SLOTS, MAX_DEFENCE_TOOLS, MAX_UNIT_KINDS }
