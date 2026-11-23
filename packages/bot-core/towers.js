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

/** A castle as the log and the status name it: its name in the game, else its position. */
const castleName = castle => String(castle.areaInfo.extraData?.[7] || `${castle.areaInfo.x}:${castle.areaInfo.y}`)

/**
 * Amounts counted over the last `span` milliseconds: attacks sent, or tools put into them. A plugin asks how much the
 * window holds and when it will have room again.
 */
class RollingWindow {
    constructor(span) {
        this.span = span
        /** [time, amount] in the order they were added. */
        this.entries = []
    }
    add(at, amount = 1) {
        if (amount > 0)
            this.entries.push([at, amount])
    }
    total(now) {
        while (this.entries.length && this.entries[0][0] <= now - this.span)
            this.entries.shift()
        return this.entries.reduce((sum, [, amount]) => sum + amount, 0)
    }
    /** The earliest time at which `need` more fit under `cap`: `now` when they fit already, Infinity when they never will. */
    roomAt(now, cap, need = 1) {
        let total = this.total(now)
        if (total + need <= cap)
            return now
        for (const [at, amount] of this.entries) {
            total -= amount
            if (total + need <= cap)
                return at + this.span
        }
        return Infinity
    }
}

const DAY = 24 * 60 * 60_000
const HOUR = 60 * 60_000
/** The game lets an account send this many attacks in any 24 hours, whatever its own limit says. */
const GAME_DAILY_ATTACKS = 4000

/** The tools an attack frame carries in its waves. Support tools ride along with the army and are not counted. */
const toolsIn = attackInfo => attackInfo.A.reduce((total, wave) =>
    total + ["L", "M", "R"].reduce((side, key) => side + wave[key].T.reduce((n, [item, amount]) => n + (item == -1 ? 0 : amount), 0), 0), 0)

/**
 * The horse for one target under the By distance choice: the coin horse up to `threshold` tiles away and a feather
 * beyond. A feather the player has none of falls back to the coin horse, and `fellBack` says so.
 */
function horseByDistance(distance, threshold, feathers) {
    if (distance <= threshold)
        return { horse: "coin", fellBack: false }
    return feathers > 0 ? { horse: "feather", fellBack: false } : { horse: "coin", fellBack: true }
}

module.exports = {
    RollingWindow, DAY, HOUR, GAME_DAILY_ATTACKS, toolsIn, horseByDistance, TOP_LEVELS, BASE_LEVELS, TOWER_FILTERS, towerLevel, matchesFilter, tilesApart, marchDistance, pickSourceCastle, castleName }
