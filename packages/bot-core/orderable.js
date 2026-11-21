/**
 * Which troops and tools a plugin may order with coins or castle resources, from the game's units file. Pure, so the
 * runner can read it too when it publishes the item catalog.
 */

/** The production list of the barracks and the one both workshops share (docs/protocol/recruit-tools.md). */
const UNITS_LIST = 0
const TOOLS_LIST = 1

/** The coin price field. Coins belong to the account, and come out of `resources.coins`. */
const COIN_COST = "costC1"
/** What a unit costs in the castle's own stock, by items-file field. Wood, stone and the rest come out of the castle. */
const CASTLE_COSTS = { costWood: "wood", costStone: "stone", costFood: "food", costCoal: "coal", costOil: "oil", costGlass: "glass", costIron: "iron", costHoney: "honey", costMead: "mead", costAqua: "aqua" }

const costFields = unit => Object.keys(unit).filter(field => field.startsWith("cost") && Number(unit[field]) > 0)

/**
 * The list an item is ordered from, or null when it can't be ordered with coins or resources: nothing it costs may be
 * rubies, a Sceat component, a token or an event good, and it must have a price at all. Troops of the barracks go in
 * list 0 and the workshops' tools in list 1.
 *
 * The items file's `kIDs` lists a kingdom for the ladder and the ram that did not hold: the capture ordered a ladder
 * in the Great Empire, which `kIDs` leaves out. So no item is held back by kingdom.
 */
function orderListOf(unit) {
    if (!unit)
        return null
    const costs = costFields(unit)
    if (costs.length == 0 || costs.some(field => field != COIN_COST && !(field in CASTLE_COSTS)))
        return null
    if (unit.name == "Barracks" && (unit.role == "melee" || unit.role == "ranged"))
        return UNITS_LIST
    if ((unit.name == "Workshop" || unit.name == "Dworkshop") && (unit.typ == "Attack" || unit.typ == "Defence"))
        return TOOLS_LIST
    return null
}

/** What one `unit` costs, as `[resource, amount]` where resource is "coins" or a castle resource's name. */
const priceOf = unit => costFields(unit).map(field => [field == COIN_COST ? "coins" : CASTLE_COSTS[field], Number(unit[field])])

module.exports = { UNITS_LIST, TOOLS_LIST, CASTLE_COSTS, orderListOf, priceOf }
