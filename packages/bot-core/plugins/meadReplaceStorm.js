if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            { type: "Number", key: "refillBelowHours", min: 1, max: 24, step: 0.1, unit: "hours", default: 2.1 },
            { type: "Number", key: "sourceReserve", min: 0, max: 100_000_000, step: 1000, default: 0 },
            {
                type: "Rows",
                key: "meadSources",
                columns: [
                    { key: "castle", type: "castle" },
                    { key: "keep", type: "number", min: 0, max: 100_000_000, default: 0 },
                ],
                default: []
            },
        ]
    }

const { KingdomID, AreaType, castles } = require("../protocols.js")
const { botConfig } = require("../ggeBot.js")
const stormTransfer = require("../stormTransfer.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const hoursLeftTillRefilMandatory = Number(pluginOptions.refillBelowHours) || 2.1
/** Mead the main castle keeps for itself when no source list is set. 0 sends whatever the Storm castle has room for. */
const sourceReserve = Math.max(0, Number(pluginOptions.sourceReserve) || 0)
const hoursLeftTillRefilWarning = 3.1
const noSourceRetryMs = stormTransfer.SENT_LOOK_MS
const noConsumptionRetryMs = 60 * 60 * 1000

const mainCastle = () => castles.find(({ kingdomID, areaInfo }) => kingdomID == KingdomID.greatEmpire && areaInfo.type == AreaType.mainCastle)

/**
 * The castle to send from and how much mead it can spare: the first castle of the source list with mead above its
 * keep or, with no list, the main castle above `sourceReserve`.
 */
function source() {
    const rows = Array.isArray(pluginOptions.meadSources) ? pluginOptions.meadSources : []
    if (rows.length == 0) {
        const main = mainCastle()
        return main && { castle: main, spare: sourceReserve > 0 ? Math.floor((Number(main.mead) || 0) - sourceReserve) : Infinity }
    }
    return rows
        .map(row => ({ castle: castles.find(c => c.kingdomID == row.castle?.kingdom && c.id == row.castle?.id), keep: Number(row.keep) || 0 }))
        .filter(({ castle }) => castle && ![KingdomID.stormIslands, KingdomID.berimond].includes(castle.kingdomID))
        .map(({ castle, keep }) => ({ castle, spare: Math.floor((Number(castle.mead) || 0) - keep) }))
        .find(({ spare }) => spare > 0)
}

/** How long the Storm castle's mead lasts and, once that is under the hours set, the mead to send. */
function look(storm) {
    const rate = storm.getProductionData.MeadConsumptionRate
    if (!(rate > 0))
        return { hoursLeft: Infinity, waitMs: noConsumptionRetryMs, note: ["dontNeedToSendMead"] }
    if (storm.getProductionData.maxAmountMead / rate < hoursLeftTillRefilWarning)
        console.warn("notEnoughTimeForMeadReplace", hoursLeftTillRefilWarning, "hoursForFoodMeadReplace")

    const hoursLeft = storm.mead / rate
    const hoursTillRefill = Math.max(0, hoursLeft - hoursLeftTillRefilMandatory)
    if (hoursTillRefill > 0)
        return { hoursLeft, maySkip: true, waitMs: hoursTillRefill * 60 * 60 * 1000, note: ["dontNeedMeadForAnother", Math.round(hoursTillRefill), "hoursMeadReplace"] }

    const pick = source()
    const amount = Math.min(stormTransfer.fillAmount(storm, "mead"), pick?.spare ?? 0)
    if (!(amount > 0))
        return { hoursLeft, maySkip: true, waitMs: noSourceRetryMs, note: [pluginOptions.meadSources?.length ? "meadSourcesKeepReached" : "meadReserveReached"] }
    return { hoursLeft, maySkip: true, order: { from: pick.castle, goods: { mead: amount } } }
}

stormTransfer.register({
    name: "mead",
    feedsTroops: true,
    look,
    busy: minutes => console.log("meadTransferInFlight", minutes, "minutesMeadReplace"),
    sent: ({ goods }) => console.log("sentMeadReplace", goods.mead, "meadToMeadReplace"),
    refused: () => console.log("failedToSendMead"),
})
