/** The game's slotIDs (items equipment_slots, and `e[1]` of a stored item). Skins have no choice and follow the colour alone. */
const SLOTS = [
    { key: "sellSlotArmour", id: 1 },
    { key: "sellSlotWeapon", id: 2 },
    { key: "sellSlotHelmet", id: 3 },
    { key: "sellSlotArtifact", id: 4 },
    { key: "sellSlotHero", id: 6 },
]
const MAX_GEM_LEVEL = 13

const optionDefs = [
    { type: "Number", key: "sellStartDelayMinutes", min: 1, max: 60, step: 1, unit: "minutes", default: 2, legacy: "text" },
    { type: "Number", key: "sellMaxPerRun", min: 1, max: 50, step: 1, default: 20, legacy: "text" },
    { type: "Label", key: "sellRarities" },
    { type: "Checkbox", key: "sellGrey", default: true },
    { type: "Checkbox", key: "sellGreen", default: true },
    { type: "Checkbox", key: "sellPurple", default: false },
    { type: "Checkbox", key: "sellOrange", default: false },
    { type: "Checkbox", key: "sellRed", default: false },
    { type: "Checkbox", key: "sellRelic", default: false },
    { type: "Checkbox", key: "sellLooseGems", default: true },
    { type: "Number", key: "sellGemMaxLevel", min: 0, max: MAX_GEM_LEVEL, step: 1, default: MAX_GEM_LEVEL },
    { type: "Label", key: "sellSlots" },
    ...SLOTS.map(({ key }) => ({ type: "Checkbox", key, default: true })),
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

// Rarity ids from the game's equipment_rarenesses table. Hero variants are the normal id plus 10.
const rarityGroups = {
    sellGrey: [1, 11],
    sellGreen: [2, 12],
    sellPurple: [3, 13],
    sellOrange: [4, 14],
    sellRed: [0, 10],
    sellRelic: [5, 15],
}
const option = key => pluginOptions[key] ?? optionDefs.find(def => def.key == key).default
const soldRarities = Object.entries(rarityGroups).filter(([key]) => option(key)).flatMap(([, ids]) => ids)
const sellGems = Boolean(option("sellLooseGems"))
const soldSlots = SLOTS.filter(({ key }) => option(key)).map(({ id }) => id)
const gemMaxLevel = Number.isFinite(Number(option("sellGemMaxLevel"))) && option("sellGemMaxLevel") !== "" ? Number(option("sellGemMaxLevel")) : MAX_GEM_LEVEL

/** An ordinary coloured gem: not part of a set, not retired. Old troop gems and other special ones have no colour. */
const isOrdinaryGem = gem => gem && gem.setID == undefined && gem.gemColorID != undefined && gem.deprecated == undefined

const gemSales = e => Array.from(e.GEM ?? []).flatMap(([id, amount]) => {
    const gem = gems.find(g => g.gemID == id)
    if (!isOrdinaryGem(gem) || Number(gem.gemLevelID) > gemMaxLevel)
        return []
    return Array.from({ length: amount }, () => ["sge", { GID: gem.gemID, RGEM: 0, LFID: -1 }])
})

// Equipment rows: [id, slotType, lordType, rarity, name, ?, objectID, setID, enchantmentLevel, secondsLeft, ...].
// An item with seconds left is temporary.
const equipmentSales = e => Array.from(e.I ?? [])
    .filter(item => soldRarities.includes(item[3]) && item[7] == -1 && !(item[9] > 0))
    .filter(item => !SLOTS.some(({ id }) => id == item[1]) || soldSlots.includes(item[1]))
    .map(item => ["seq", { EID: item[0], LID: -1, EX: 0, LFID: -1 }])

async function fetch(cmd) {
    const reply = waitForResult(cmd, 1000 * 10)
    await sendXT(cmd, JSON.stringify({}))
    const [obj] = await reply
    return obj
}

async function sellRun() {
    const equipment = soldRarities.length ? equipmentSales(await fetch("gei")) : []
    const gemList = sellGems ? gemSales(await fetch("ggm")) : []
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

const reportStatus = require("../pluginStatus.js").statusReporter(__filename)

events.once("load", async () => {
    if (!soldRarities.length && !sellGems) {
        console.log("sellNothingSelected")
        reportStatus("waiting", "statusSellNothingSelected")
        return
    }
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
