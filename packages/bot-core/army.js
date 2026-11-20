/**
 * The army settings attack plugins share: how autofill picks troops, and the option definitions for them.
 * The shapes are @gge/contracts' army.ts, parsed here in plain JavaScript because the bot loads no schema library;
 * test/army-contract.test.mjs holds the two to the same answers. Nothing here talks to the game.
 */
const ARMY_MODES = ["autofill", "waves"]
const UNIT_ORDERS = ["castle", "fastest", "strongest", "weakest"]
const TROOP_SUPPLIES = ["all", "food", "mead"]
/** `getAttackInfo`'s horse options, by the choice of a `horse` Select. */
const HORSES = [{}, { useCoin: true }, { useFeather: true }]

const UNIT_ORDER_CHOICES = ["Castle order", "Fastest first", "Strongest first", "Weakest first"]
const SUPPLY_CHOICES = ["All", "Food only", "Mead only"]
const HORSE_CHOICES = ["No horse", "Coin horse", "Feather"]

const speed = info => Number(info.speed) || 0
const strength = info => Math.max(Number(info.meleeAttack) || 0, Number(info.rangeAttack) || 0)
const COMPARE = {
    fastest: (a, b) => speed(b.unitInfo) - speed(a.unitInfo),
    strongest: (a, b) => strength(b.unitInfo) - strength(a.unitInfo),
    weakest: (a, b) => strength(a.unitInfo) - strength(b.unitInfo),
}
const EATS = { all: () => true, food: info => Boolean(info.foodSupply), mead: info => Boolean(info.meadSupply) }

/** Sorts `units` in place for a unit order and returns them. "castle" keeps the order the castle lists them in. */
const orderUnits = (units, unitOrder) => COMPARE[unitOrder] ? units.sort(COMPARE[unitOrder]) : units
/** Whether autofill may take a troop under a troop supply. */
const eats = (supply, info) => EATS[supply](info)

/** A Select's stored value is the index of its choice; anything else gets the fallback. */
const choice = (list, value, fallback) => list[typeof value == "string" && value !== "" ? Number(value) : value] ?? fallback

/** The parts of autofill every shared builder reads from a plugin's stored options. */
const parseAutofill = (options, { unitOrder = "castle" } = {}) => ({
    unitOrder: choice(UNIT_ORDERS, options.unitOrder, unitOrder),
    supply: choice(TROOP_SUPPLIES, options.supply, "all"),
})

const unitOrderOption = (unitOrder = "castle") =>
    ({ type: "Select", key: "unitOrder", selection: UNIT_ORDER_CHOICES, default: UNIT_ORDERS.indexOf(unitOrder), army: "autofill" })
const supplyOption = () => ({ type: "Select", key: "supply", selection: SUPPLY_CHOICES, default: 0, army: "autofill" })
const horseOption = horse => ({ type: "Select", key: "horse", selection: HORSE_CHOICES, default: horse })

const MAX_WAVES = 4
const SUPPORT_TOOL_SLOTS = 3
const COURTYARD_SLOTS = 8
const SERVER_PRESETS = 30
const MAX_SLOT_AMOUNT = 100_000
const WAVE_SLOTS = { left: { tools: 2, units: 2 }, front: { tools: 3, units: 6 }, right: { tools: 2, units: 2 } }
/** A wave plan's sides and the `cra` wave keys they fill. */
const SIDES = [["left", "L"], ["front", "M"], ["right", "R"]]

/**
 * An army setting the bot can't act on. `reasonKey` is a status reason the plugin reports before it stops, so the
 * player reads why nothing is sent.
 */
class ArmyProblem extends Error {
    constructor(reasonKey, params = {}) {
        super(reasonKey)
        this.reasonKey = reasonKey
        this.params = params
    }
}

const isObject = value => typeof value == "object" && value !== null && !Array.isArray(value)
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const isSlot = slot => slot === null || (isObject(slot) && isInt(slot.item, 1, Infinity) && isInt(slot.amount, 1, MAX_SLOT_AMOUNT))
const isSlots = (slots, length) => Array.isArray(slots) && slots.length == length && slots.every(isSlot)
const isFlank = (flank, { tools, units }) => isObject(flank) && isSlots(flank.tools, tools) && isSlots(flank.units, units)
const isWave = wave => isObject(wave) && (
    wave.kind == "preset" ? isInt(wave.preset, 0, SERVER_PRESETS)
        : wave.kind == "custom" && SIDES.every(([side]) => isFlank(wave[side], WAVE_SLOTS[side])))
/** Whether `plan` is a written-out wave plan, as @gge/contracts' ManualPlan defines one. */
const isManualPlan = plan => isObject(plan) && plan.kind == "manual" &&
    Array.isArray(plan.waves) && plan.waves.length == MAX_WAVES && plan.waves.every(isWave) &&
    Array.isArray(plan.ast) && plan.ast.length == SUPPORT_TOOL_SLOTS && plan.ast.every(item => item === null || isInt(item, 1, Infinity)) &&
    isSlots(plan.rw, COURTYARD_SLOTS)

const filled = slots => slots.filter(Boolean)
const planSlots = plan => [...plan.waves.flatMap(wave => wave.kind == "custom" ? SIDES.flatMap(([side]) => wave[side].units) : []), ...plan.rw]

/**
 * A plugin's army, read from its stored options: `{ mode: "autofill" }`, or `{ mode: "waves", waves }` with a plan
 * the bot can send. Throws an ArmyProblem for anything else, so a plan that can't be sent as written is never
 * swapped for autofill behind the player's back.
 */
function parseArmy(options) {
    const mode = options.armyMode ?? "autofill"
    if (!ARMY_MODES.includes(mode))
        throw new ArmyProblem("statusArmyModeUnknown")
    if (mode == "autofill")
        return { mode }
    const plan = options.waves
    if (plan === undefined || plan === null)
        throw new ArmyProblem("statusArmyNoPlan")
    // The runner swaps a virtual preset for its plan, so one that is still here was deleted.
    if (isObject(plan) && plan.kind == "virtual")
        throw new ArmyProblem("statusArmyPresetDeleted")
    if (!isManualPlan(plan))
        throw new ArmyProblem("statusArmyPlanUnreadable")
    // The game's reply that lists a player's presets hasn't been captured, so the bot can't tell what one holds.
    const preset = plan.waves.find(wave => wave.kind == "preset" && wave.preset > 0)
    if (preset)
        throw new ArmyProblem("statusArmyServerPreset", { preset: preset.preset })
    if (filled(planSlots(plan)).length == 0)
        throw new ArmyProblem("statusArmyPlanEmpty")
    return { mode, waves: plan }
}

/**
 * The plugin's army, or null once the reason it can't be sent has been logged and reported as the plugin's status.
 * A caller that gets null starts nothing.
 */
function readArmy(options, reportStatus) {
    try {
        return parseArmy(options)
    } catch (problem) {
        if (!(problem instanceof ArmyProblem))
            throw problem
        console.error("armyCantBeSent")
        reportStatus("error", problem.reasonKey, problem.params)
        return null
    }
}

const isSoldier = info => Boolean(info.role) && info.fightType == 0
const fitsSide = (info, key) => info.slotTypes?.split(",").includes(key == "M" ? "1" : "2") ?? true

/**
 * Fills the empty `cra` that `getAttackInfo` built from a wave plan, taking what it sends out of `inventory`.
 * Wave 4 of the plan repeats for every wave after it. A slot never gets more than its side has room for:
 * `room` is `{ flankUnits, frontUnits, flankTools, frontTools, courtyard }` for this target and commander, and a
 * slot the target's level hasn't opened is left out. Support tools the castle lacks are left out too.
 *
 * Throws "NO_MORE_TROOPS", taking nothing, while the castle holds less than a slot needs.
 */
function fillFromPlan(attackInfo, plan, inventory, room) {
    const left = new Map(inventory.map(unit => [unit, unit.amount]))
    const find = (item, soldier) => inventory.find(unit => unit.unitInfo.wodID == item && isSoldier(unit.unitInfo) == soldier)
    const picks = []
    const short = []
    function pick(slot, planned, space, soldier, fits = () => true) {
        const amount = planned ? Math.min(planned.amount, space) : 0
        if (amount <= 0)
            return 0
        const unit = find(planned.item, soldier)
        if (unit && !fits(unit.unitInfo)) {
            console.warn("armyToolWrongSide", planned.item)
            return 0
        }
        if (!unit || left.get(unit) < amount) {
            short.push(planned.item)
            return 0
        }
        left.set(unit, left.get(unit) - amount)
        picks.push([slot, unit, amount])
        return amount
    }

    attackInfo.A.forEach((wave, i) => {
        const planned = plan.waves[Math.min(i, MAX_WAVES - 1)]
        if (planned.kind != "custom")
            return
        for (const [side, key] of SIDES) {
            let tools = key == "M" ? room.frontTools : room.flankTools
            let units = key == "M" ? room.frontUnits : room.flankUnits
            wave[key].T.forEach((slot, j) => tools -= pick(slot, planned[side].tools[j], tools, false, info => fitsSide(info, key)))
            wave[key].U.forEach((slot, j) => units -= pick(slot, planned[side].units[j], units, true))
        }
    })
    let courtyard = room.courtyard
    attackInfo.RW.forEach((slot, j) => courtyard -= pick(slot, plan.rw[j], courtyard, true))

    const soldiers = picks.filter(([, unit]) => isSoldier(unit.unitInfo)).length
    if (short.length || soldiers == 0) {
        console.warn("armyPlanShort", [...new Set(short)].join(", "))
        throw "NO_MORE_TROOPS"
    }

    for (const [slot, unit, amount] of picks) {
        slot[0] = unit.unitInfo.wodID
        slot[1] = amount
        unit.amount -= amount
    }
    const supportTools = filled(plan.ast).map(item => find(item, false)).filter(unit => unit && unit.amount > 0).slice(0, SUPPORT_TOOL_SLOTS)
    supportTools.forEach((unit, i) => {
        attackInfo.AST[i] = unit.unitInfo.wodID
        unit.amount--
    })
    return attackInfo
}

/**
 * The army options of a plugin: the Autofill or Waves switch and the wave plan. `source` says which of the plugin's
 * options make up its autofill (@gge/contracts' AutofillSource).
 */
const armyOptions = source => [
    { type: "ArmyMode", key: "armyMode", default: "autofill", autofill: source },
    { type: "Waves", key: "waves", army: "waves" },
]

/** The fortress plugins' options after the commander list. The feather is what they always rode. */
const fortressOptions = waves => [
    horseOption(2),
    ...armyOptions({ sides: { left: true, courtyard: true }, waves, tools: [], unitOrder: "unitOrder", supply: "supply" }),
    unitOrderOption("fastest"),
    supplyOption(),
]

module.exports = {
    ARMY_MODES, UNIT_ORDERS, TROOP_SUPPLIES, HORSES, ArmyProblem,
    orderUnits, eats, choice, parseAutofill, parseArmy, readArmy, isManualPlan, fillFromPlan,
    unitOrderOption, supplyOption, armyOptions, fortressOptions,
}
