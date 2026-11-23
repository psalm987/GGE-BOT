const optionDefs = [
    { type: "Number", key: "sellStartDelayMinutes", min: 1, max: 60, step: 1, unit: "minutes", default: 2, legacy: "text" },
    { type: "Number", key: "sellMaxPerRun", min: 1, max: 50, step: 1, default: 20, legacy: "text" },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const { events, sendXT, waitForResult, botConfig } = require('../ggeBot')
const { pause } = require("../pacing.js")
const { readLegacy } = require("../legacyOptions.js")
const gems = require("../paths.js").loadItem("gems")

const pluginOptions = readLegacy(optionDefs, botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {})
const startDelayMinutes = Number(pluginOptions.sellStartDelayMinutes) || 2
const maxPerRun = Number(pluginOptions.sellMaxPerRun) || 20
const runIntervalMs = 1000 * 60 * 5

const equipmentType = {
    unique : 0,
    common : 1,
    rare : 2,
    epic : 3,
    legendary : 4,
    relic : 5,
    heroUnique : 10,
    heroCommon : 11,
    heroRare : 12,
    heroEpic : 13,
    heroLegendary : 14,
    heroRelic : 15
}
const keptRarities = [equipmentType.relic, equipmentType.heroRelic, equipmentType.unique, equipmentType.heroUnique]

const gemSales = e => Array.from(e.GEM ?? []).flatMap(([id, amount]) => {
    const gem = gems.find(g => g.gemID == id)
    if (!gem || gem.setID != undefined)
        return []
    return Array.from({ length: amount }, () => ["sge", { GID: gem.gemID, RGEM: 0, LFID: -1 }])
})

// Equipment rows: [id, slotType, lordType, rarity, name, ?, objectID, setID, ...]
const equipmentSales = e => Array.from(e.I ?? [])
    .filter(item => !keptRarities.includes(item[3]) && item[7] == -1)
    .map(item => ["seq", { EID: item[0], LID: -1, EX: 0, LFID: -1 }])

async function fetch(cmd) {
    const reply = waitForResult(cmd, 1000 * 10)
    await sendXT(cmd, JSON.stringify({}))
    const [obj] = await reply
    return obj
}

async function sellRun() {
    const equipment = equipmentSales(await fetch("gei"))
    const gemList = gemSales(await fetch("ggm"))
    const sales = [...equipment, ...gemList].slice(0, maxPerRun)
    for (let i = 0; i < sales.length; i++) {
        if (i > 0)
            await pause(2000, 6000)
        const [cmd, params] = sales[i]
        await sendXT(cmd, JSON.stringify(params))
    }
    const equipmentSold = sales.filter(([cmd]) => cmd == "seq").length
    if (equipmentSold)
        console.log("equipmentSold", equipmentSold)
    if (sales.length - equipmentSold)
        console.log(sales.length - equipmentSold, "gemsSold")
}

events.once("load", async () => {
    await pause(startDelayMinutes * 60_000, (startDelayMinutes + 3) * 60_000)
    while (true) {
        try {
            await sellRun()
        } catch (e) {
            console.warn("sellStoredEquipment", e)
        }
        await pause(runIntervalMs, runIntervalMs * 1.5)
    }
})
