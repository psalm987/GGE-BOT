/**
 * The Khan plugin's settings, parsed: which waves carry rage tools or tablet chests, the taunt rules and the defence
 * tools it keeps in stock. Nothing here talks to the game.
 */
const { choice } = require("./army.js")
const { stockOptions, spendOptions } = require("./stockOptions.js")

/** A wave count of the `rageWaves` and `boosterWaves` Selects, by choice. The last choice is every wave that is left. */
const WAVE_COUNTS = [0, 1, 2, 3, 4, 5, Infinity]
const WAVE_COUNT_CHOICES = ["None", "1 wave", "2 waves", "3 waves", "4 waves", "5 waves", "Every later wave"]
const EVERY = WAVE_COUNTS.length - 1

/**
 * The wave options of the Khan plugin. `rageWaves` replaced the text option `wavesTillChests`, which counted the first
 * wave too: a stored "4" meant three rage waves. Anything it couldn't read as a number sent rage tools in every wave.
 */
const khanWaveOptions = () => [
    {
        type: "Select", key: "rageWaves", selection: WAVE_COUNT_CHOICES, default: 3, army: "autofill",
        legacy: { from: { wavesTillChests: "4" }, cases: [["", 0], ["0", 0], ["1", 0], ["2", 1], ["3", 2], ["4", 3], ["5", 4], ["6", 5]].map(([text, waves]) => [{ wavesTillChests: text }, waves]), otherwise: EVERY },
    },
    { type: "Select", key: "boosterWaves", selection: WAVE_COUNT_CHOICES, default: EVERY, army: "autofill" },
    { type: "OrderedList", key: "rageTools", catalog: "tools", default: [], army: "autofill" },
    { type: "OrderedList", key: "tabletChests", catalog: "tools", default: [], army: "autofill" },
]

/** The defence tools the plugin can keep in stock, as [option key, wodID]: flaming arrows, hurling rocks, gate reinforcement and sharpened stakes. */
const DEFENCE_TOOLS = [["stockFlamingArrows", 629], ["stockHurlingRocks", 637], ["stockGateReinforcement", 626], ["stockSharpenedStakes", 634]]
/** The taunt and stock options. Every stock starts at 0, which buys nothing. */
const khanChainOptions = () => [
    { type: "Checkbox", key: "tabletsOnly", default: false },
    { type: "Number", key: "pauseAtTaunts", min: 0, max: 500, unit: "attacks", default: 0 },
    { type: "Label", key: "defenceStock" },
    { type: "Checkbox", key: "keepDefence", default: false },
    ...stockOptions(DEFENCE_TOOLS),
    ...spendOptions(),
]

const idList = value => Array.isArray(value) ? value.filter(Number.isInteger) : []

/** The plugin's wave and taunt settings, from options already read through `readLegacy`. */
const parseKhan = options => ({
    rageWaves: choice(WAVE_COUNTS, options.rageWaves, 3),
    boosterWaves: choice(WAVE_COUNTS, options.boosterWaves, Infinity),
    rageTools: idList(options.rageTools),
    tabletChests: idList(options.tabletChests),
    tabletsOnly: Boolean(options.tabletsOnly),
    pauseAtTaunts: Math.max(0, Number(options.pauseAtTaunts) || 0),
    keepDefence: Boolean(options.keepDefence),
})

/** What wave `index` carries besides troops, for a wave after the first: rage waves come first, then booster waves. */
const waveKind = ({ rageWaves, boosterWaves }, index) =>
    index <= rageWaves ? "rage" : index <= rageWaves + boosterWaves ? "booster" : "troops"

/** The alliance Khan camp's owner, `BASIC_ALLIANCE_NOMAD_CAMP_PLAYER_ID` in the client. */
const KHAN_OWNER = -801

/** Whether a march is a Khan attack on the player: it isn't the player's own and comes from a Khan camp. */
const isTaunt = (march, playerID, campType) =>
    march.targetOwner?.ownerID == playerID && march.owner?.ownerID != playerID &&
    (march.sourceAttack?.type == campType || march.owner?.ownerID == KHAN_OWNER)

/** How many Khan attacks are on their way to the player. */
const incomingTaunts = (movements, playerID, campType) => movements.filter(march => isTaunt(march, playerID, campType)).length

/** Why a full rage bar is not spent on a taunt, in the order the reasons are checked, each with the state that sets it. */
const TAUNT_HOLDS = [
    ["off", state => state.tabletsOnly || state.dryRun],
    ["stopped", state => state.quit],
    ["defenceLost", state => state.defenceLost],
    ["defenceShort", state => state.defenceShort],
]

/** The first reason taunts are held, or undefined when the bar may be spent. */
const tauntHold = state => TAUNT_HOLDS.find(([, held]) => held(state))?.[0]

module.exports = { tauntHold,  khanWaveOptions, khanChainOptions, parseKhan, waveKind, isTaunt, incomingTaunts, DEFENCE_TOOLS }
