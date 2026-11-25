if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            { type: "Number", key: "refillBelowHours", min: 1, max: 24, step: 0.1, unit: "hours", default: 2.1 },
            { type: "Number", key: "sourceReserve", min: 0, max: 100_000_000, step: 1000, default: 0 },
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
const { spendSkip, MinuteSkipType } = require("./skips.js")
const { events, botConfig } = require("../ggeBot.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const hoursLeftTillRefilMandatory = Number(pluginOptions.refillBelowHours) || 2.1
/** Mead the main castle keeps for itself. 0 sends whatever the Storm castle has room for, as the plugin always did. */
const sourceReserve = Math.max(0, Number(pluginOptions.sourceReserve) || 0)
const hoursLeftTillRefilWarning = 3.1
const sendResTimeout = 29 * 30 * 1000
const kingdomID = KingdomID.stormIslands

/**
 * 
 * @param {import("../protocols.js").ClassTypes.CastleInfo} castle 
 * @returns 
 */
const skipResource = async castle => {
    while (castle.resourceTransfer?.remainingTime > 0) {
        let skip = spendSkip(castle.resourceTransfer.remainingTime)

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        if(await ClientCommands.skipResourceTransfer(skip, kingdomID, KingdomSkipType.sendResource) != 0)
            return
        // The game's next transfer update is not guaranteed before the loop reads the time again.
        castle.resourceTransfer.remainingTime -= MinuteSkipType[skip] * 60
    }
}

events.once("load", async () => {
    if(!unlockInfoList.find(e => e.kingdomID == kingdomID)?.isUnlocked)
        return console.warn("wontRunWithoutStormUnlocked")

    const stormCastle = castles.find(e => e.kingdomID == kingdomID &&
        e.areaInfo.type == AreaType.externalKingdom)
    
    const mainCastle = castles.find(({ kingdomID, areaInfo }) => kingdomID == KingdomID.greatEmpire && areaInfo.type == AreaType.mainCastle)

    let checkMead = async () => {
        if (stormCastle.resourceTransfer?.resources?.mead)
            stormCastle.mead += (stormCastle?.resourceTransfer?.resources?.mead ?? 0)

        let meadLossPerHour = stormCastle.mead / stormCastle.getProductionData.MeadConsumptionRate
        let hoursTillRefill = Math.max(0, meadLossPerHour - hoursLeftTillRefilMandatory)

        if (meadLossPerHour == Infinity || isNaN(meadLossPerHour))
            return console.log("dontNeedToSendMead")

        if (stormCastle.getProductionData.maxAmountMead / stormCastle.getProductionData.MeadConsumptionRate < hoursLeftTillRefilWarning)
            console.warn("notEnoughTimeForMeadReplace", hoursLeftTillRefilWarning, "hoursForFoodMeadReplace")

        if (stormCastle.resourceTransfer?.remainingTime >= 
                (stormCastle.mead - (stormCastle.resourceTransfer?.resources?.mead ?? 0)) / stormCastle.getProductionData.MeadConsumptionRate / 60 / 60) { //TODO: Partial Skipping
            await skipResource(stormCastle)
        }
        else
            console.log("dontNeedMeadForAnother", Math.round(hoursTillRefill), "hoursMeadReplace")

        setTimeout(async () => {
            let amount = Math.floor((stormCastle.getProductionData.maxAmountMead - stormCastle.mead))
            if (sourceReserve > 0)
                amount = Math.min(amount, Math.floor((Number(mainCastle.mead) || 0) - sourceReserve))
            if (amount <= 0) {
                console.log("meadReserveReached")
                return setTimeout(checkMead, sendResTimeout)
            }

            let result = await ClientCommands.kingdomUnitTransfer(
                mainCastle.id,
                KingdomID.greatEmpire,
                kingdomID,
                [["MEAD", amount]])
            if (result == 0)
                console.log("sentMeadReplace", amount, "meadToMeadReplace")
            else
                console.log("failedToSendMead")
            
            setTimeout(checkMead, sendResTimeout)

        }, Math.min(hoursTillRefill * 60 * 60 * 1000, 2147483647))
    }
    checkMead()
})