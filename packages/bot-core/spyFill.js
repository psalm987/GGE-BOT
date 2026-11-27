/**
 * Wave 1 planned from a spy report, as the game's own "Fill waves" does it (from Lazy Lord's source,
 * be/waveOneAutofill.js, MIT). One ranged troop fills every side, and each side gets just enough tools to cancel the
 * defence the report shows there. Nothing here talks to the game; docs/protocol/attacks.md lists the fields read.
 *
 * Per side, in the game's order: the wall, then the gate (front only), then the defenders' ranged defence. The moat is
 * left alone. For each, the best tool kind that cancels it alone, the highest bonus first and event and elite tools
 * first at the same bonus; when none can, the one kind that cancels the most. A tool that lowers two defences, such
 * as the fortified ram, counts for both.
 */
const { toolAllowedAt } = require("./attackTargets.js")

const SIDES = [["L", 0], ["M", 1], ["R", 2]]
const BONUS = { wall: "wallBonus", gate: "gateBonus", ranged: "defRangeBonus" }
const REDUCTION = { wall: "wallReduction", gate: "gateReduction" }
/** The target's bonuses on the attack screen (`B.AIE`), by effect id. */
const TARGET_EFFECT = { wall: 10000, gate: 10001, rangedDefence: 10004, defence: 10007 }
/** The defenders' ranged defence before the target's bonuses and spied tools, on every side. */
const RANGED_DEFENCE_BASE = 100
/** Tool groups by the items file's `name`: event tools first, then elite tools, at the same bonus. */
const GROUP_RANK = { Eventtool: 0, Event: 0, Elitetool: 1, Elite: 1, Premium: 2, Workshop: 3 }
/** Where the target's wall sits in its map entry (`gaa.AI`), the gate and moat after it: castles 6, Khan camps 10, Daimyo castles 9. */
const WALL_AT = { 35: 10, 37: 9 }
const CASTLE_WALL_AT = 6
/** `extraData` is the map entry from this index on. */
const EXTRA_DATA_FROM = 3

const number = value => Number(value) || 0
const groupRank = info => GROUP_RANK[info.name] ?? GROUP_RANK.Premium
const fitsSide = (info, side) => String(info.slotTypes ?? "").split(",").includes(side == "M" ? "1" : "2")
const targetValue = (targetEffects, id) =>
    number((Array.isArray(targetEffects) ? targetEffects : []).find(effect => Number(effect?.[0]) == id)?.[1]?.[0])

/** The target's own wall, gate and moat, from its map entry's `extraData`. */
function structureOf(areaType, extraData = []) {
    const at = (WALL_AT[Number(areaType)] ?? CASTLE_WALL_AT) - EXTRA_DATA_FROM
    return { wall: number(extraData[at]), gate: number(extraData[at + 1]), moat: number(extraData[at + 2]) }
}

/** The ranged troop wave 1 takes: the strongest one the castle has enough of for every side, else the strongest. */
function bestTroop(inventory, effects, needed) {
    const strength = info => number(info.rangeAttack) * (1 + number(effects.offensiveRangeBonus) / 100)
    return inventory
        .filter(unit => unit.amount > 0 && Number(unit.unitInfo.fightType) == 0 && unit.unitInfo.role == "ranged" &&
            !unit.unitInfo.beefSupply && strength(unit.unitInfo) > 0)
        .sort((a, b) => Number(b.amount >= needed) - Number(a.amount >= needed) || strength(b.unitInfo) - strength(a.unitInfo))[0]
}

/**
 * Plans wave 1 against a target from its spy report.
 *
 * `spy` is the attack screen's `S` (`[wodID, amount]` lists for the left, front, right and courtyard), `targetEffects`
 * its `B.AIE`, `structure` the target's own `{ wall, gate }` (structureOf), `effects` the commander's bonuses against
 * the target, `inventory` the castle's units, `room` the attack's `{ flankUnits, frontUnits, flankTools, frontTools }`,
 * `slots` wave 1's `{ flankTools, frontTools }` slot counts, `target` the `{ kingdom, areaType }` attacked, and
 * `unitInfo` looks a spied defence tool up by wodID. Nothing is taken out of `inventory`.
 *
 * Returns each side's `{ troop, tools, uncancelled }`: `troop` and each tool as `{ unit, amount }` (`troop` undefined
 * when there is none left), and what is left of each defence after the tools.
 */
function planSpyWave({ spy, targetEffects, structure, effects = {}, inventory, room, slots, target, unitInfo }) {
    const troop = bestTroop(inventory, effects, 2 * room.flankUnits + room.frontUnits)
    let troopsLeft = troop?.amount ?? 0
    const stock = inventory
        .filter(unit => unit.amount > 0 && unit.unitInfo.typ == "Attack" && toolAllowedAt(unit.unitInfo, target))
        .map(unit => ({ unit, left: unit.amount, waveLeft: number(unit.unitInfo.amountPerWave) || Infinity }))
    const rangedDefence = RANGED_DEFENCE_BASE + targetValue(targetEffects, TARGET_EFFECT.rangedDefence) + targetValue(targetEffects, TARGET_EFFECT.defence)

    const wave = {}
    for (const [side, index] of SIDES) {
        const spied = kind => (Array.isArray(spy?.[index]) ? spy[index] : [])
            .reduce((sum, [id, amount]) => sum + number(amount) * number(unitInfo(id)?.[BONUS[kind]]), 0)
        const protection = kind => number(structure?.[kind]) + targetValue(targetEffects, TARGET_EFFECT[kind]) + spied(kind) - number(effects[REDUCTION[kind]])
        const needs = side == "M"
            ? { wall: protection("wall"), gate: protection("gate"), ranged: rangedDefence + spied("ranged") }
            : { wall: protection("wall"), ranged: rangedDefence + spied("ranged") }

        let toolRoom = side == "M" ? room.frontTools : room.flankTools
        const kinds = side == "M" ? slots.frontTools : slots.flankTools
        const picked = new Map()
        for (const kind of Object.keys(needs)) {
            if (needs[kind] <= 0 || toolRoom <= 0)
                continue
            const bonus = entry => number(entry.unit.unitInfo[BONUS[kind]])
            const usable = entry => Math.min(entry.left, entry.waveLeft, toolRoom)
            const cancels = entry => usable(entry) * bonus(entry)
            const options = stock
                .filter(entry => bonus(entry) > 0 && fitsSide(entry.unit.unitInfo, side) && usable(entry) > 0 && (picked.has(entry) || picked.size < kinds))
                .sort((a, b) => bonus(b) - bonus(a) || groupRank(a.unit.unitInfo) - groupRank(b.unit.unitInfo))
            const entry = options.find(option => cancels(option) >= needs[kind]) ?? [...options].sort((a, b) => cancels(b) - cancels(a))[0]
            if (!entry)
                continue
            const amount = Math.min(Math.ceil(needs[kind] / bonus(entry)), usable(entry))
            entry.left -= amount
            entry.waveLeft -= amount
            toolRoom -= amount
            picked.set(entry, (picked.get(entry) ?? 0) + amount)
            for (const other of Object.keys(needs))
                needs[other] -= amount * number(entry.unit.unitInfo[BONUS[other]])
        }

        const troops = Math.min(side == "M" ? room.frontUnits : room.flankUnits, troopsLeft)
        troopsLeft -= troops
        wave[side] = {
            troop: troops > 0 ? { unit: troop, amount: troops } : undefined,
            tools: [...picked].map(([entry, amount]) => ({ unit: entry.unit, amount })),
            uncancelled: Object.fromEntries(Object.entries(needs).map(([kind, left]) => [kind, Math.max(0, Math.round(left * 10) / 10)])),
        }
    }
    return wave
}

/** Whether a side of the plan leaves the wall or the gate standing. Ranged defence left over is allowed. */
const wallOrGateLeft = wave => SIDES.some(([side]) => wave[side].uncancelled.wall > 0 || wave[side].uncancelled.gate > 0)

module.exports = { planSpyWave, structureOf, wallOrGateLeft }
