if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            { type: "Number", key: "foodRefillBelowHours", min: 1, max: 24, step: 0.1, unit: "hours", default: 2.1 },
            {
                type: "Rows",
                key: "foodSources",
                columns: [
                    { key: "castle", type: "castle" },
                    { key: "keep", type: "number", min: 0, max: 100_000_000, default: 0 },
                ],
                default: []
            },
            { type: "Checkbox", key: "foodUseSkips", default: true },
            { type: "Checkbox", key: "foodDryRun", default: false },
        ]
    }

const { KingdomID, AreaType, castles } = require("../protocols.js")
const { botConfig } = require("../ggeBot.js")
const stormTransfer = require("../stormTransfer.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const refillBelowHours = Number(pluginOptions.foodRefillBelowHours) || 2.1
const useSkips = pluginOptions.foodUseSkips ?? true
const dryRun = Boolean(pluginOptions.foodDryRun)
const HOUR = 60 * 60 * 1000
/** When nothing in Storm eats food, only the player spends it: it is topped up once the storehouse is below this share. */
const IDLE_TOP_UP_SHARE = 0.5
const IDLE_LOOK_MS = HOUR
const noSourceRetryMs = stormTransfer.SENT_LOOK_MS

const mainCastle = () => castles.find(({ kingdomID, areaInfo }) => kingdomID == KingdomID.greatEmpire && areaInfo.type == AreaType.mainCastle)

/** Food eaten each hour, less what the castle grows. `FCR` scales what troops eat, as in feast.js. */
function burnPerHour({ getProductionData: p }) {
    const share = Number.isFinite(p.foodConsumptionReductionPercentage) ? p.foodConsumptionReductionPercentage : 1
    return Math.max(0, (Number(p.FoodConsumptionRate) || 0) * share - (Number(p.deltaFood) || 0))
}

/** The castle to send from and how much food it can spare: the first of the source list or, with no list, the main castle. */
function source() {
    const rows = Array.isArray(pluginOptions.foodSources) ? pluginOptions.foodSources : []
    const main = mainCastle()
    return stormTransfer.firstSource(rows.length ? rows : [{ castle: main && { kingdom: main.kingdomID, id: main.id }, keep: 0 }], "food")
}

/** How long the Storm castle's food lasts and, once that is under the hours set, the food to send. */
function look(storm) {
    const burn = burnPerHour(storm)
    const food = Number(storm.food) || 0
    const hoursLeft = burn > 0 ? food / burn : Infinity
    const want = { hoursLeft, maySkip: useSkips, dryRun }
    if (burn > 0 && hoursLeft > refillBelowHours) {
        const hoursTillRefill = hoursLeft - refillBelowHours
        return { ...want, waitMs: hoursTillRefill * HOUR, note: ["dontNeedFoodForAnother", Math.round(hoursTillRefill), "hoursMeadReplace"] }
    }
    if (burn <= 0 && food >= storm.getProductionData.maxAmountFood * IDLE_TOP_UP_SHARE)
        return { ...want, waitMs: IDLE_LOOK_MS, note: ["stormFoodNotEaten"] }

    const pick = source()
    const amount = Math.min(stormTransfer.fillAmount(storm, "food"), pick?.spare ?? 0)
    if (!(amount > 0))
        return { ...want, waitMs: noSourceRetryMs, note: [pluginOptions.foodSources?.length ? "foodSourcesKeepReached" : "mainCastleNoFood"] }
    return { ...want, order: { from: pick.castle, goods: { food: amount } } }
}

stormTransfer.register({
    name: "food",
    feedsTroops: true,
    look,
    busy: minutes => console.log("foodTransferInFlight", minutes, "minutesMeadReplace"),
    sent: ({ goods }) => console.log("sentMeadReplace", goods.food, "foodToStorm"),
    refused: code => console.log("failedToSendFood", code),
})
