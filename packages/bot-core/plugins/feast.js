/**
 * The food feasts a player can choose, by the game's feastID (items `feasts`). Ruby feasts cost rubies, so they are
 * never offered. A choice's cost and level range are read from the items at run time.
 */
const FEAST_CHOICES = [
    { id: 0, label: "Country feast" },
    { id: 1, label: "Knights' feast" },
    { id: 2, label: "King's feast" },
    { id: 3, label: "Aristocratic banquet" },
    { id: 5, label: "Hearty country feast" },
    { id: 6, label: "Hearty knights' feast" },
    { id: 7, label: "Hearty king's feast" },
    { id: 8, label: "Hearty aristocratic banquet" },
]
const AUTO = "Automatic: the biggest food feast your level allows"

const optionDefs = [
    {
        type: "Select", key: "feastType", selection: [AUTO, ...FEAST_CHOICES.map(choice => choice.label)], default: 0,
        // The food one feast uses, which only type 8 ever matched, is now the feast's own cost. Automatic is type 8 at level 70 and up.
        legacy: { from: { feastFoodReduction: "150000" }, cases: [], otherwise: 0 },
    },
    { type: "Rows", key: "feastCastles", default: [], columns: [{ key: "castle", type: "castle" }] },
    {
        type: "Text",
        key: "minimumFood",
        default: "150000"
    },
    {
        type: "Text",
        key: "minimumFoodRate",
        default: "0"
    },
]

if (require('node:worker_threads').isMainThread) {
    module.exports = { pluginOptions: optionDefs }
    return
}

const { ClientCommands, KingdomID, AreaType, castles } = require("../protocols.js")
const { events, botConfig, playerInfo } = require("../ggeBot.js")
const { pause } = require("../pacing.js")
const { readLegacy, MAIN_CASTLE } = require("../legacyOptions.js")
const err = require("../err.json")
const feastItems = require("../paths.js").loadItem("feasts")
const pluginOptions = readLegacy(optionDefs, botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {})
const minimumFood = pluginOptions.minimumFood ? Number(pluginOptions.minimumFood): 150000
const minimumFoodRate = pluginOptions.minimumFoodRate ? Number(pluginOptions.minimumFoodRate) : 0
const LEVEL_TOO_HIGH_OR_LOW = 12

const MAIN_TYPES = [AreaType.mainCastle, AreaType.externalKingdom, AreaType.beriCastle]

const foodFeasts = feastItems
    .filter(feast => Number(feast.costFood) > 0)
    .map(feast => ({ id: Number(feast.feastID), cost: Number(feast.costFood), minLevel: Number(feast.minLevel), maxLevel: Number(feast.maxLevel) }))

/**
 * The feast to hold at `level`, or why there is none: "wrongLevel" with the chosen feast's level range, or
 * "unknownType" when the items do not list it. Automatic is the dearest food feast the level allows.
 */
function feastFor(level) {
    const choice = FEAST_CHOICES[Number(pluginOptions.feastType) - 1]
    if (!choice) {
        const best = foodFeasts.filter(feast => feast.minLevel <= level && level <= feast.maxLevel).sort((a, b) => b.cost - a.cost)[0]
        return best ? { feast: best } : { reason: "unknownType" }
    }
    const feast = foodFeasts.find(feast => feast.id == choice.id)
    if (!feast)
        return { reason: "unknownType" }
    if (level < feast.minLevel || level > feast.maxLevel)
        return { reason: "wrongLevel", range: `${feast.minLevel}-${feast.maxLevel}` }
    return { feast }
}

/** Whether the castle is one the player listed, or any castle while none is listed. */
function listed(castle) {
    const rows = Array.isArray(pluginOptions.feastCastles) ? pluginOptions.feastCastles.filter(row => Number.isInteger(row?.castle?.kingdom)) : []
    if (rows.length == 0)
        return true
    return rows.some(({ castle: ref }) => ref.kingdom == castle.kingdomID &&
        (ref.id == MAIN_CASTLE ? MAIN_TYPES.includes(castle.areaInfo?.type) : ref.id == castle.id))
}

let feasting = false

const tryToFeast = async () => {
    if (feasting)
        return
    feasting = true
    let feasts = 0, spent = 0
    const reasons = new Set()
    try {
        const { feast, reason, range } = feastFor(Number(playerInfo.level))
        if (!feast) {
            if (reason == "wrongLevel")
                console.warn("feastTypeWrongLevel", range)
            else
                console.warn("feastTypeUnknown")
            return
        }
        for (const castle of castles) {
            if(castle.kingdomID == KingdomID.stormIslands)
                continue
            if (castle.kingdomID == KingdomID.berimond)
                continue
            if (!listed(castle))
                continue
            let foodRate = castle.getProductionData.deltaFood - castle.getProductionData.FoodConsumptionRate *
                castle.getProductionData.foodConsumptionReductionPercentage
            if (foodRate < Math.max(0, minimumFoodRate)) {
                reasons.add("lowIncome")
                continue
            }

            if(castle.kingdomID == KingdomID.greatEmpire && castle.areaInfo.type == AreaType.mainCastle && castle.getProductionData.maxAmountFood < castle.food)
                continue

            while (minimumFood < (castle.food - feast.cost) && feast.cost <= castle.food) {
                if (feasts > 0)
                    await pause(2000, 6000)
                const reply = await ClientCommands.startFeast(feast.id, castle.id, castle.kingdomID)
                if (reply.result != 0) {
                    if (reply.result == LEVEL_TOO_HIGH_OR_LOW)
                        console.warn("feastTypeWrongLevel", `${feast.minLevel}-${feast.maxLevel}`)
                    else
                        console.warn("feastRefused", err[reply.result] ?? reply.result)
                    reasons.add("refused")
                    break
                }
                feasts++
                spent += feast.cost
                castle.food -= feast.cost
            }
            if (!(minimumFood < castle.food - feast.cost && feast.cost <= castle.food) && !reasons.has("refused"))
                reasons.add("food")
        }
    } finally {
        feasting = false
    }

    if (feasts > 0)
        console.log("consumed", spent)
    else if (reasons.has("food"))
        console.log("notEnoughFoodToFeast")
    else if (reasons.has("lowIncome"))
        console.log("feastLowIncome")
}

events.once("load", () => {
    setInterval(() => tryToFeast().catch(e => console.warn("feast", e)), 1000 * 60 * 8)
    tryToFeast().catch(e => console.warn("feast", e))
})
