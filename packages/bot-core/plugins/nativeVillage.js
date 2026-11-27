/**
 * The three native villages: the kingdom, the goods it takes, the package field holding the price, and the packs it
 * sells as `[choice label, packageID]`, in the order the game's slums.json lists them (two for each village level).
 */
const VILLAGES = [
    {
        kingdom: 1, option: "burningSandsPack", goods: "oil", price: "packagePriceOil",
        packs: [["nativeVillageCoins", 108], ["nativeVillageIronProduction", 3174], ["nativeVillageSaberWarriors", 110], ["nativeVillageDesertBowmen", 111],
            ["nativeVillageCompositeBowmen", 112], ["nativeVillageFlameBearers", 113], ["nativeVillageOilProduction", 3175], ["nativeVillageOilStorage", 3176]],
    },
    {
        kingdom: 2, option: "everWinterPack", goods: "coal", price: "packagePriceCoal",
        packs: [["nativeVillageCoins", 100], ["nativeVillageFoodProduction", 2793], ["nativeVillageNorsemanWarriors", 102], ["nativeVillageNorsemanBowmen", 103],
            ["nativeVillageWolfhounds", 104], ["nativeVillageBarbarians", 105], ["nativeVillageCoalProduction", 2794], ["nativeVillageCoalStorage", 3173]],
    },
    {
        kingdom: 3, option: "firePeaksPack", goods: "glass", price: "packagePriceGlass",
        packs: [["nativeVillageCoins", 116], ["nativeVillageIronStorage", 3177], ["nativeVillageCultistWarriors", 118], ["nativeVillageCultistBowmen", 119],
            ["nativeVillageDemonHorrors", 120], ["nativeVillageDeathlyHorrors", 121], ["nativeVillageGlassProduction", 3178], ["nativeVillageGlassStorage", 3179]],
    },
]

const optionDefs = [
    ...VILLAGES.map(({ option, packs }) => ({ type: "Select", key: option, selection: ["nativeVillageNoPack", ...packs.map(([label]) => label)], default: 0 })),
    { type: "Number", key: "villageGoodsKeep", min: 0, max: 100_000_000, step: 1000, default: 0 },
    { type: "Checkbox", key: "dryRunOrders", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig } = require("../ggeBot.js")
const { AreaType, castles, unlockInfoList, setCastle, shopTurn } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const stock = require("./stock.js")
const loadItem = require("../paths.js").loadItem

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusNativeVillageStarting")

/** One purchase buys at most this many packs. The client was seen buying 11 at once. */
const MAX_PER_PURCHASE = 100
/** CONSTRUCTION_ITEM_INVENTORY_MAX_AMOUNT_REACHED: the building item storage is full. */
const STORAGE_FULL = 377

const packages = new Map(loadItem("packages").map(pack => [Number(pack.packageID), pack]))
/** The village level that unlocks each package, by kingdom and packageID. */
const levels = new Map(loadItem("slums").flatMap(row => String(row.packageIDs ?? "").split("+").filter(Boolean)
    .map(id => [`${Number(row.kID)}:${Number(id)}`, Number(row.slumLevel)])))

/** The picked pack of each village as `{ village, packageID, price, level }`; price or level is undefined when the game's data doesn't list it. */
const picks = () => VILLAGES.map(village => ({ village, choice: Number(pluginOptions[village.option]) }))
    .filter(({ village, choice }) => Number.isInteger(choice) && choice >= 1 && choice <= village.packs.length)
    .map(({ village, choice }) => {
        const packageID = village.packs[choice - 1][1]
        const price = Number(packages.get(packageID)?.[village.price])
        return { village, packageID, price: price > 0 ? price : undefined, level: levels.get(`${village.kingdom}:${packageID}`) }
    })

/** Villages whose purchase the game refused for full storage: closed until the bot restarts. The saved pick is left as it is. */
const closed = new Set()

/** Opens the village in its kingdom castle and buys, as the client does. Resolves to the game's result. */
async function buy(castle, order) {
    const ours = (reply, result) => result != 0 || reply.grc?.KID === undefined || reply.grc.KID == order.KID
    try {
        const { result } = await setCastle(castle, () => shopTurn(async () => {
            await ask("gbc", { CID: castle.id, KID: order.KID })
            return ask("sbp", order, undefined, ours)
        }))
        return result
    } catch (error) {
        return String(error?.message ?? error)
    }
}

const BLOCKERS = ["unknownPack", "noCastle", "storageFull", "levelLow", "refused", "short"]
const STATUS_KEY = {
    unknownPack: "statusNativeVillageUnknownPack", noCastle: "statusNativeVillageNoCastle", storageFull: "statusNativeVillageStorageFull",
    levelLow: "statusNativeVillageLevelLow", refused: "statusNativeVillageRefused", short: "statusNativeVillageShort",
}

async function cycle(active) {
    const picked = picks()
    if (picked.length == 0) {
        reportStatus("waiting", "statusNativeVillageNoPicks")
        return 60 * 60_000
    }
    const dryRun = Boolean(pluginOptions.dryRunOrders)
    const keep = Math.max(0, Number(pluginOptions.villageGoodsKeep) || 0)
    await stock.refreshHome()

    const outcomes = []
    let bought = 0, neededLevel
    for (const { village, packageID, price, level } of picked) {
        const kingdom = village.kingdom
        if (closed.has(kingdom)) {
            outcomes.push("storageFull")
            continue
        }
        if (price === undefined || level === undefined) {
            outcomes.push("unknownPack")
            continue
        }
        const unlock = unlockInfoList.find(u => u.kingdomID == kingdom)
        const castle = castles.find(c => c.kingdomID == kingdom && c.areaInfo?.type == AreaType.externalKingdom)
        if (!unlock?.isUnlocked || !castle) {
            outcomes.push("noCastle")
            continue
        }
        if (!(unlock.slumLevel >= level)) {
            neededLevel ??= level
            outcomes.push("levelLow")
            continue
        }
        const amount = Math.min(MAX_PER_PURCHASE, Math.floor((Number(castle[village.goods]) - keep) / price))
        if (!(amount > 0)) {
            outcomes.push("short")
            continue
        }
        if (!active())
            return
        const order = { PID: packageID, BT: 3, TID: -1, AMT: amount, KID: kingdom, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }
        if (dryRun)
            console.log("dryRunSbp", JSON.stringify(order))
        else {
            const result = await buy(castle, order)
            if (result === STORAGE_FULL) {
                closed.add(kingdom)
                console.warn("nativeVillageStorageFull", JSON.stringify(order))
                outcomes.push("storageFull")
                continue
            }
            if (result !== 0) {
                console.warn("nativeVillageRefused", JSON.stringify(order), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
                outcomes.push("refused")
                continue
            }
            castle[village.goods] -= amount * price
            console.log("nativeVillageBought", JSON.stringify(order))
        }
        bought += amount
        outcomes.push("bought")
        await pause(2000, 5000)
    }

    if (bought > 0)
        reportStatus("running", "statusNativeVillageBought", { packs: bought })
    else {
        const blocker = BLOCKERS.find(b => outcomes.includes(b))
        reportStatus("waiting", STATUS_KEY[blocker], blocker == "levelLow" ? { level: neededLevel } : {})
    }
    return boxMullerRandom(28 * 60_000, 32 * 60_000)
}

events.once("load", () => chore("nativeVillage", cycle, boxMullerRandom(2 * 60_000, 5 * 60_000)))
