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
    ({ type: "Select", key: "unitOrder", selection: UNIT_ORDER_CHOICES, default: UNIT_ORDERS.indexOf(unitOrder), advanced: true, army: "autofill" })
const supplyOption = () => ({ type: "Select", key: "supply", selection: SUPPLY_CHOICES, default: 0, advanced: true, army: "autofill" })
const horseOption = horse => ({ type: "Select", key: "horse", selection: HORSE_CHOICES, default: horse })

/** The autofill options the robber baron plugins add to their own. */
const baronAutofillOptions = () => [unitOrderOption(), supplyOption()]
/** The fortress plugins' options after the commander list. The feather is what they always rode. */
const fortressAutofillOptions = () => [horseOption(2), unitOrderOption("fastest"), supplyOption()]

module.exports = {
    ARMY_MODES, UNIT_ORDERS, TROOP_SUPPLIES, HORSES,
    orderUnits, eats, choice, parseAutofill,
    unitOrderOption, baronAutofillOptions, fortressAutofillOptions,
}
