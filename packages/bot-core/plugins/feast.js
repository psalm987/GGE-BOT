if (require('node:worker_threads').isMainThread) {
    module.exports = {
        pluginOptions: [
            {
                type: "Text",
                key: "feastFoodReduction",
                default: "150000"
            },
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
    }
    return
}

const { ClientCommands, KingdomID, AreaType, castles } = require("../protocols.js")
const { events, botConfig } = require("../ggeBot.js")
const { pause } = require("../pacing.js")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const feastFoodReduction = pluginOptions.feastFoodReduction ? Number(pluginOptions.feastFoodReduction): 150000
const minimumFood = pluginOptions.minimumFood ? Number(pluginOptions.minimumFood): 150000
const minimumFoodRate = pluginOptions.minimumFoodRate ? Number(pluginOptions.minimumFoodRate) : 0

let feasting = false

const tryToFeast = async () => {
    if (feasting)
        return
    feasting = true
    let feasts = 0
    try {
        for (const castle of castles) {
            if(castle.kingdomID == KingdomID.stormIslands)
                continue
            if (castle.kingdomID == KingdomID.berimond)
                continue
            let foodRate = castle.getProductionData.deltaFood - castle.getProductionData.FoodConsumptionRate *
                castle.getProductionData.foodConsumptionReductionPercentage
            if (foodRate < Math.max(0, minimumFoodRate))
                continue

            if(castle.kingdomID == KingdomID.greatEmpire && castle.areaInfo.type == AreaType.mainCastle && castle.getProductionData.maxAmountFood < castle.food)
                continue

            while (minimumFood < (castle.food - feastFoodReduction) && feastFoodReduction <= castle.food) {
                if (feasts > 0)
                    await pause(2000, 6000)
                const feast = await ClientCommands.startFeast(8, castle.id, castle.kingdomID)
                if (feast.result != 0)
                    break
                feasts++
                castle.food -= feastFoodReduction
            }
        }
    } finally {
        feasting = false
    }

    if (feasts > 0)
        console.log("consumed", feastFoodReduction * feasts)
    else {
        console.log("notEnoughFoodToFeast")
    }
}

events.once("load", () => {
    setInterval(() => tryToFeast().catch(e => console.warn("feast", e)), 1000 * 60 * 8)
    tryToFeast().catch(e => console.warn("feast", e))
})