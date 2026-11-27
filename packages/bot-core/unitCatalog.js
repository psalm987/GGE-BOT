/**
 * Troops and tools from the game's `units.json`, sorted into the groups a player recruits them in, and filtered by where
 * the game lets them go and fight. Pure: every function takes the unit rows it reads.
 */
const { parseAllowedToAttack, allowsTarget } = require("./attackTargets.js")

/**
 * @typedef {"attackTroops" | "defenceTroops" | "eventTroops" | "attackTools" | "defenceTools"} RecruitGroup
 * @typedef {"wall" | "gate" | "ranged"} ToolRole
 * @typedef {"front" | "flank"} Slot
 * @typedef {{ type: string, recruitGroup: RecruitGroup, role?: "melee" | "ranged", levels: number[] }} CatalogEntry
 * @typedef {CatalogEntry & { roles: ToolRole[], slots: Slot[] }} ToolEntry
 * @typedef {{ kingdom: number, areaType: number }} Place
 */

const isTroop = unit => unit?.role == "melee" || unit?.role == "ranged"

/** A unit a castle can recruit: it takes time and costs something. Units only the game's enemies field do neither. */
const isRecruitable = unit => Number(unit.recruitmentTime) > 0 &&
    Object.keys(unit).some(key => /^cost/.test(key) && Number(unit[key]) > 0)

/** @returns {RecruitGroup} */
const recruitGroupOf = unit => isTroop(unit) ?
    unit.name == "Eventunit" ? "eventTroops" : unit.fightType == 1 ? "defenceTroops" : "attackTroops" :
    unit.fightType == 1 ? "defenceTools" : "attackTools"

/** Event troops players own but can't recruit, which the Blade Coast camp still takes. */
const EXTRA_EVENT_TROOPS = new Set(["SamuraiAttackerMelee", "SamuraiAttackerRange", "SamuraiDefenderMelee", "SamuraiDefenderRange",
    "Rankrewardmelee", "Rankrewardrange", "EliteRankrewardmelee", "EliteRankrewardrange"])

/** Whether the unit may travel to `place`, read from its `allowedToTravel` "space+area" list. No list means anywhere. */
const canTravelTo = (unit, place) => allowsTarget(parseAllowedToAttack(unit.allowedToTravel), place)
/** Whether the unit may fight at `place`, read from its `allowedToAttack` list. */
const canAttackAt = (unit, place) => allowsTarget(parseAllowedToAttack(unit.allowedToAttack), place)
/** Tools marked `canBeUsedToAttackNPC: 0` only work against players. */
const usableAgainstNpc = unit => String(unit.canBeUsedToAttackNPC ?? "1") != "0"

const SLOT_TYPES = /** @type {const} */ ({ 1: "front", 2: "flank" })
/** @returns {Slot[]} */
const slotsOf = unit => [...new Set(String(unit.slotTypes ?? "").split(",").map(n => SLOT_TYPES[Number(n)]).filter(Boolean))]

const TOOL_ROLE_BONUS = /** @type {const} */ ({ wall: "wallBonus", gate: "gateBonus", ranged: "defRangeBonus" })
/** What a tool lowers on the defender: its wall, its gate or its ranged defence. @returns {ToolRole[]} */
const toolRolesOf = unit => Object.keys(TOOL_ROLE_BONUS).filter(role => Number(unit[TOOL_ROLE_BONUS[role]]) > 0)

/** The Blade Coast camp (travel) and its islands (attack), on the first coast map. */
const BLADE_COAST = Object.freeze({ camp: { kingdom: 22, areaType: 8 }, island: { kingdom: 22, areaType: 7 } })
const fitsBladeCoast = unit => canTravelTo(unit, BLADE_COAST.camp) && canAttackAt(unit, BLADE_COAST.island)

const levelOf = unit => Number(unit.level ?? 0) || 0

/** One entry per unit type, with every level among `units`. */
function groupByType(units, describe) {
    const byType = new Map()
    for (const unit of units) {
        const entry = byType.get(unit.type) ?? { ...describe(unit), levels: new Set() }
        entry.levels.add(levelOf(unit))
        byType.set(unit.type, entry)
    }
    return [...byType.values()].map(entry => ({ ...entry, levels: [...entry.levels].sort((a, b) => a - b) }))
        .sort((a, b) => a.recruitGroup.localeCompare(b.recruitGroup) || a.type.localeCompare(b.type))
}

/** @returns {CatalogEntry} */
const describe = unit => ({ type: unit.type, recruitGroup: recruitGroupOf(unit), ...(isTroop(unit) ? { role: unit.role } : {}) })

/** What castles can recruit, by type and recruit group. @returns {CatalogEntry[]} */
const recruitCatalog = units => groupByType(units.filter(isRecruitable), describe)

const ATTACK_TOOL_BUILDINGS = new Set(["Workshop", "Elitetool", "Eventtool"])
const isAttackTool = unit => !unit.role && ATTACK_TOOL_BUILDINGS.has(unit.name) && unit.fightType != 1

/**
 * The troops and tools a player can send to the Blade Coast camp and fight the islands with. Troops are the recruitable
 * ones plus the extra event troops. Tools are attack tools the islands accept, with a front or flank slot and a wall,
 * gate or ranged role.
 * @returns {{ troops: CatalogEntry[], tools: ToolEntry[] }}
 */
function bladeCoastCatalog(units) {
    const fits = units.filter(fitsBladeCoast)
    const troops = groupByType(fits.filter(u => isTroop(u) && (isRecruitable(u) || EXTRA_EVENT_TROOPS.has(u.type))),
        u => EXTRA_EVENT_TROOPS.has(u.type) ? { ...describe(u), recruitGroup: "eventTroops" } : describe(u))
    const tools = groupByType(fits.filter(u => isAttackTool(u) && usableAgainstNpc(u) && slotsOf(u).length && toolRolesOf(u).length),
        u => ({ ...describe(u), roles: toolRolesOf(u), slots: slotsOf(u) }))
    return { troops, tools }
}

/**
 * A unit type's name as the game's English language file `lang` has it: the key it is under, tried the ways the game
 * spells them (the runner's game items do the same), and its text. A type the file lacks keeps its own name.
 */
function unitName(type, lang) {
    const nameKey = [`${type}_name`, `${type[0].toLowerCase()}${type.slice(1)}_name`, `${type.toLowerCase()}_name`].find(key => key in lang) ?? `${type}_name`
    return { nameKey, name: lang[nameKey] ?? type }
}

/** The BladeCoastSetup option (@gge/contracts) under `key`, offering what bladeCoastCatalog finds among `units`. */
function bladeCoastSetupOption(key, units, lang = {}) {
    const { troops, tools } = bladeCoastCatalog(units)
    const named = ({ type, recruitGroup, levels }) => ({ type, ...unitName(type, lang), recruitGroup, levels })
    return { type: "BladeCoastSetup", key, troops: troops.map(named), tools: tools.map(tool => ({ ...named(tool), roles: tool.roles })) }
}

/** The wodIDs a "<type>" or "<type>#<level>" choice stands for that may go to the Blade Coast. */
function bladeCoastWods(units, choice) {
    const [type, level] = String(choice ?? "").split("#")
    return units.filter(u => u.type == type && fitsBladeCoast(u) && (level === undefined || levelOf(u) == Number(level)))
        .map(u => Number(u.wodID))
}

module.exports = {
    isTroop,
    isRecruitable,
    recruitGroupOf,
    EXTRA_EVENT_TROOPS,
    canTravelTo,
    canAttackAt,
    usableAgainstNpc,
    slotsOf,
    toolRolesOf,
    BLADE_COAST,
    fitsBladeCoast,
    recruitCatalog,
    bladeCoastCatalog,
    bladeCoastSetupOption,
    bladeCoastWods,
}
