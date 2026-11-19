/**
 * What the robber baron ("kingdom tower") plugins know about towers, apart from the game connection: a tower's level,
 * which towers a filter takes, and which castle the attacks leave from.
 */

/** The level a kingdom's towers stop at, by kingdom id: Great Empire, Burning Sands, Everwinter Glacier, Fire Peaks. */
const TOP_LEVELS = [81, 61, 51, 71]
/** The level of a kingdom's towers before their first defeat. */
const BASE_LEVELS = [1, 35, 20, 45]
const TOWER_FILTERS = ["all", "maxed", "notMaxed"]

/** A tower's level from how often it has been beaten, which is all the map says about it. */
const towerLevel = (victories, kingdomID) => Math.floor(1.9 * Math.pow(victories, .555)) + (BASE_LEVELS[kingdomID] ?? 0)

const FILTERS = {
    all: () => true,
    maxed: (level, top) => level >= top,
    notMaxed: (level, top) => level < top,
}
/** Whether a tower filter takes a tower of this level, in a kingdom whose towers stop at `top`. */
const matchesFilter = (filter, level, top) => FILTERS[filter](level, top)

/** How far apart two map tiles are, the way a search radius measures it: the longer of the two axes. */
const tilesApart = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
/** How far a march between two tiles travels. */
const marchDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The castle a kingdom's attacks leave from: the one the player picked (`ref`, a castle id of this kingdom), else the
 * kingdom's main castle, which is the first castle of one of `mainTypes`. `fellBack` says a picked castle is gone.
 * `castle` is undefined when the account holds no castle in the kingdom.
 */
function pickSourceCastle(castles, kingdomID, ref, mainTypes) {
    const own = castles.filter(castle => castle.kingdomID == kingdomID && castle.areaInfo)
    const picked = ref ? own.find(castle => castle.id == ref.id) : undefined
    return { castle: picked ?? own.find(castle => mainTypes.includes(castle.areaInfo.type)), fellBack: Boolean(ref) && !picked }
}

module.exports = { TOP_LEVELS, BASE_LEVELS, TOWER_FILTERS, towerLevel, matchesFilter, tilesApart, marchDistance, pickSourceCastle }
