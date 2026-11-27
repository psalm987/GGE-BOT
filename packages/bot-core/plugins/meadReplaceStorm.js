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

const {
    ClientCommands,
    KingdomSkipType,
    KingdomID,
    AreaType,
    castles,
    unlockInfoList
} = require("../protocols.js")
const { spendSkip, skipRefused, MinuteSkipType } = require("./skips.js")
const { events, botConfig, xtHandler } = require("../ggeBot.js")
const { ask } = require("../chores.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const hoursLeftTillRefilMandatory = Number(pluginOptions.refillBelowHours) || 2.1
/** Mead the main castle keeps for itself when no source list is set. 0 sends whatever the Storm castle has room for. */
const sourceReserve = Math.max(0, Number(pluginOptions.sourceReserve) || 0)
const hoursLeftTillRefilWarning = 3.1
const sendResTimeout = 29 * 30 * 1000
/** A transfer in flight blocks a new one, so the next look comes soon. */
const busyRetryMs = 5 * 60 * 1000
const noConsumptionRetryMs = 60 * 60 * 1000
/** setTimeout fires at once for a longer delay. */
const TIMER_MAX = 2 ** 31 - 1
const kingdomID = KingdomID.stormIslands

const stormCastle = () => castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.externalKingdom)
const mainCastle = () => castles.find(({ kingdomID, areaInfo }) => kingdomID == KingdomID.greatEmpire && areaInfo.type == AreaType.mainCastle)

/**
 * When each transfer timer was read. The game's RS is the seconds left at that moment and is never updated in
 * between, so a timer read an hour ago has an hour less left.
 */
const timerReadAt = new WeakMap()
function secondsLeft(transfer) {
    if (!(transfer?.remainingTime > 0))
        return 0
    if (!timerReadAt.has(transfer))
        timerReadAt.set(transfer, Date.now())
    return Math.max(0, transfer.remainingTime - (Date.now() - timerReadAt.get(transfer)) / 1000)
}
for (const cmd of ["kpi", "fjf", "kgt", "msk", "kut"])
    xtHandler.on(cmd, () => secondsLeft(stormCastle()?.resourceTransfer))

/**
 * Skips the transfer in flight. An msk reply with the kingdom info replaces the timer; one without it leaves the old
 * timer, so the skip is counted down on it here, or the next look would skip the same time again.
 */
async function skipTransfer(storm) {
    while (secondsLeft(storm.resourceTransfer) > 0) {
        const before = storm.resourceTransfer
        const skip = spendSkip(secondsLeft(before))
        if (skip == undefined)
            return

        const result = await ClientCommands.skipResourceTransfer(skip, kingdomID, KingdomSkipType.sendResource)
        if (result != 0) {
            if (skipRefused(skip, result))
                continue
            return
        }
        if (storm.resourceTransfer === before)
            before.remainingTime -= MinuteSkipType[skip] * 60
    }
}

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

/** One look at the Storm castle's mead. Resolves to the delay before the next look. */
async function check() {
    // The castles' mead doesn't drop locally as troops eat it. If the refresh fails, the figures held are used.
    const { result } = await ask("dcl", { CD: 1 })
    if (result !== 0)
        console.warn("meadLevelsNotRefreshed")

    const storm = stormCastle()
    const rate = storm.getProductionData.MeadConsumptionRate
    if (!(rate > 0)) {
        console.log("dontNeedToSendMead")
        return noConsumptionRetryMs
    }
    if (storm.getProductionData.maxAmountMead / rate < hoursLeftTillRefilWarning)
        console.warn("notEnoughTimeForMeadReplace", hoursLeftTillRefilWarning, "hoursForFoodMeadReplace")

    const inFlight = storm.resourceTransfer
    if (secondsLeft(inFlight) > 0) {
        if (secondsLeft(inFlight) >= storm.mead / rate * 3600)
            await skipTransfer(storm)
        if (secondsLeft(storm.resourceTransfer) > 0) {
            console.log("meadTransferInFlight", Math.ceil(secondsLeft(storm.resourceTransfer) / 60), "minutesMeadReplace")
            return busyRetryMs
        }
        // Landed through the skips: the castle's mead counts it only from the game's next update.
        storm.mead = Math.min(storm.mead + (inFlight.resources?.mead ?? 0), storm.getProductionData.maxAmountMead)
    }

    const hoursTillRefill = Math.max(0, storm.mead / rate - hoursLeftTillRefilMandatory)
    if (hoursTillRefill > 0) {
        console.log("dontNeedMeadForAnother", Math.round(hoursTillRefill), "hoursMeadReplace")
        return hoursTillRefill * 60 * 60 * 1000
    }

    const pick = source()
    const amount = Math.min(Math.floor(storm.getProductionData.maxAmountMead - storm.mead), pick?.spare ?? 0)
    if (!(amount > 0)) {
        console.log(pluginOptions.meadSources?.length ? "meadSourcesKeepReached" : "meadReserveReached")
        return sendResTimeout
    }

    const sent = await ClientCommands.kingdomUnitTransfer(pick.castle.id, pick.castle.kingdomID, kingdomID, [["MEAD", amount]])
    if (sent != 0) {
        console.log("failedToSendMead")
        return busyRetryMs
    }
    pick.castle.mead -= amount
    console.log("sentMeadReplace", amount, "meadToMeadReplace")
    return sendResTimeout
}

async function checkMead() {
    let next = busyRetryMs
    try {
        next = await check()
    }
    catch (e) {
        console.warn("meadReplaceStorm", e)
    }
    finally {
        setTimeout(checkMead, Math.min(next, TIMER_MAX))
    }
}

events.once("load", () => {
    if (!unlockInfoList.find(e => e.kingdomID == kingdomID)?.isUnlocked)
        return console.warn("wontRunWithoutStormUnlocked")
    checkMead()
})
