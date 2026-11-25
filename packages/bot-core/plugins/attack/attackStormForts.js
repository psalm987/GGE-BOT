const fs = require("fs")
/** How the forts are queued, by the choice of the `fortOrder` Select. "level" is what the plugin always did. */
const FORT_ORDERS = ["level", "nearest"]
/** The decoration the `decoration` Select buys from Luna's trade boat, as its package and its price in aquamarine. */
const DECORATIONS = [undefined, { PID: 3116, cost: 75000 }, { PID: 3118, cost: 75000 }, { PID: 3117, cost: 100000 }]
/** The attack tools kept in stock on the Storm Islands, as [option key, wodID]. */
const STORM_TOOLS = [["stockLadders", 614], ["stockRams", 611], ["stockMantlets", 620]]
/** `decoration` replaced the checkbox `buyDecoration`, which bought the Whale Lagoon. */
const decorationOption = () => ({
    type: "Select", key: "decoration", selection: ["No decoration", "Crab Rock", "Tide Garden", "Whale Lagoon"], default: 0,
    legacy: { from: { buyDecoration: false }, cases: [[{ buyDecoration: true }, 3]], otherwise: 0 },
})
if (require('node:worker_threads').isMainThread) {
    const { armyOptions, unitOrderOption, supplyOption } = require("../../army.js")
    const { stockOptions, spendOptions } = require("../../stockOptions.js")
    module.exports = {
        targets: [{ kingdom: 4, areaType: require("../../areaTypes.js").AreaType.stormTower }],
        checks: require("../../commanderOptions.js").commanderChecks,
        pluginOptions: [
            { type: "Select", key: "fortOrder", selection: ["Highest level first", "Nearest first"], default: 0 },
            { type: "Label", key: "easyForts", md: 2 },
            { type: "Checkbox", key: "allowLvl60Easy", default: true },
            { type: "Checkbox", key: "allowLvl70Easy", default: true },
            { type: "Checkbox", key: "allowLvl80Easy", default: true },
            { type: "", md: 3 },

            { type: "Label", key: "hardForts", md: 2 },
            { type: "Checkbox", key: "allowLvl40Hard", default: false },
            { type: "Checkbox", key: "allowLvl50Hard", default: false },
            { type: "Checkbox", key: "allowLvl60Hard", default: false },
            { type: "Checkbox", key: "allowLvl70Hard", default: false },
            { type: "Checkbox", key: "allowLvl80Hard", default: false },

            ...armyOptions({ sides: { left: true, right: true }, waves: 3, tools: [], unitOrder: "unitOrder", supply: "supply" }),
            unitOrderOption(),
            supplyOption(),

            { type: "Label", key: "aquaShop" },
            { type: "Checkbox", key: "buyCoins", default: true },
            decorationOption(),
            { type: "Checkbox", key: "buySkips5h", default: false },
            { type: "Checkbox", key: "buySkips24h", default: false },
            { type: "Checkbox", key: "buyXP", default: false },
            { type: "Checkbox", key: "buyDummyPeasants", default: false },
            { type: "Number", key: "aquaKeep", min: 0, max: 100_000_000, step: 1000, default: 0 },

            { type: "Label", key: "toolStock" },
            ...stockOptions(STORM_TOOLS),
            ...spendOptions(),

            { type: "Label", key: "other" },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            { type: "Checkbox", key: "useCoin", default: false },
            // { type: "Checkbox", key: "meadReplace", default: false },
            { type: "Checkbox", key: "resourceSend", default: false },
        ]
    }
    try {
        fs.accessSync(require("../../paths.js").extraPlugin("upgradeStormCargo.js"))
        module.exports.pluginOptions.push({
            type: "Checkbox",
            key: "upgradeStormForts"
        })
    }
    catch (e) {
        console.debug(e)
    }
    return module.exports.pluginOptions.push(...require("../../commanderOptions.js").commanderOptions(), { type: "Checkbox", key: "dryRun", default: false })
}


const { movementEvents, ClientCommands, AreaType, KingdomID, movements, castles } = require("../../protocols.js")
const { mapGrid, scanGrid, wholeMapRects } = require("../../mapScan.js")
const { waitToAttack, waitOutDailyLimit, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getTotalAmountToolsFlank, getTotalAmountToolsFront, getMaxUnitsInReinforcementWave, sendAttack } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander.js")
const { sendXT, waitForResult, botConfig, events, xtHandler, playerInfo } = require("../../ggeBot.js")
const { marchDistance } = require("../../towers.js")
const { readArmy, fillFromPlan, parseAutofill, orderUnits, eats, choice } = require("../../army.js")
const { presetsListed } = require("../../gamePresets.js")
const { readLegacy } = require("../../legacyOptions.js")
const stormClosing = require("../../stormClosing.js")

const err = require("../../err.json")
const pretty = require('pretty-time')

const minTroopCount = 100

const pluginOptions =
    readLegacy([decorationOption()], botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {})
const autofill = parseAutofill(pluginOptions)
const fortOrder = choice(FORT_ORDERS, pluginOptions.fortOrder, "level")
const decoration = choice(DECORATIONS, pluginOptions.decoration, undefined)
const reportStatus = require("../../pluginStatus.js").statusReporter(__filename)

if (pluginOptions.upgradeStormForts) {
    try {
        require(require("../../paths.js").extraPlugin("upgradeStormCargo.js"))
    }
    catch (e) {
        console.warn(e)
    }
}
// if (pluginOptions.meadReplace) {
//     try {
//         require("../meadReplaceStorm.js")
//     }
//     catch (e) {
//         console.warn(e)
//     }
// }
if (pluginOptions.resourceSend) {
    try {
        require("../resourceSendStorm.js")
    }
    catch (e) {
        console.warn(e)
    }
}

const { pause } = require("../../pacing.js")
const kingdomID = KingdomID.stormIslands
const stormWatch = stormClosing.stormWatch(stormClosing.STORM_EVENT_ID, { xtHandler, activeEvent: require("../../protocols.js").activeEvent })
/** Set once every fort that is ready would be hit after the Storm event has ended. No attack is sent after that. */
let closing = false
const type = AreaType.stormTower

require("../../armourer.js").keepStocked("stormArmourer", STORM_TOOLS, kingdomID, pluginOptions, ["stormToolsBought", "stormToolsCoins"])

events.once("load", async () => {
    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.externalKingdom)
    // `stock` is how many of a package the shop sells. The plugin never asks for more of one in a session.
    const purchases = [
        { on: pluginOptions.buyCoins, PID: 2798, cost: 75000, log: "broughtCoins" },
        { on: Boolean(decoration), ...decoration, log: "broughtDeco" },
        { on: pluginOptions.buySkips5h, PID: 3122, cost: 40000, stock: 10, log: "boughtAquaSkips" },
        { on: pluginOptions.buySkips24h, PID: 3123, cost: 40000, stock: 30, log: "boughtAquaSkips" },
        { on: pluginOptions.buyXP, PID: 3114, cost: 10000, log: "broughtXP" },
        { on: pluginOptions.buyDummyPeasants, PID: 248, cost: 1570, log: "boughtDummyPeasants" },
    ].filter(purchase => purchase.on).map(purchase => ({ ...purchase, left: purchase.stock ?? Infinity }))
    const aquaKeep = Math.max(0, Number(pluginOptions.aquaKeep) || 0)
    let buying = false
    async function onResourceUpdate() {
        if (buying)
            return
        const nearlyFull = castle.getProductionData.maxAmountAqua <=
            Math.min(castle.getProductionData.maxAmountAqua, castle.aqua + 100000)
        if (!nearlyFull)
            return
        buying = true
        let bought = 0
        try {
            let aqua = Math.max(0, castle.aqua - aquaKeep)
            for (const purchase of purchases) {
                const { PID, cost, log } = purchase
                const count = Math.min(Math.floor(aqua / cost), purchase.left)
                aqua -= count * cost
                purchase.left -= count
                for (let i = 0; i < count; i++) {
                    if (bought > 0)
                        await pause(2000, 6000)
                    const order = { PID, BT: 3, TID: -1, AMT: 1, KID: 4, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }
                    if (pluginOptions.dryRun)
                        console.log("dryRunSbp", JSON.stringify(order))
                    else
                        await sendXT("sbp", JSON.stringify(order))
                    castle.aqua -= cost
                    bought++
                    console.info(log)
                }
            }
        } finally {
            buying = false
        }
        if (bought)
            castle.emit("resourceUpdate")
    }
    await onResourceUpdate()
    castle.on("resourceUpdate", onResourceUpdate)

    let allowedLevels = []

    if (pluginOptions["allowLvl40Hard"])
        allowedLevels.push(10)
    if (pluginOptions["allowLvl50Hard"])
        allowedLevels.push(11)
    if (pluginOptions["allowLvl60Hard"])
        allowedLevels.push(12)
    if (pluginOptions["allowLvl70Hard"])
        allowedLevels.push(13)
    if (pluginOptions["allowLvl80Hard"])
        allowedLevels.push(14)
    if (pluginOptions["allowLvl60Easy"])
        allowedLevels.push(7)
    if (pluginOptions["allowLvl70Easy"])
        allowedLevels.push(8)
    if (pluginOptions["allowLvl80Easy"])
        allowedLevels.push(9)

    if (allowedLevels.length === 0)
        allowedLevels.push(7, 8, 9, 13, 14)

    const army = readArmy(pluginOptions, reportStatus)
    if (!army || !await presetsListed(army, reportStatus))
        return

    let areas = []

    const sendHit = async () => {
        if (closing)
            return false
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList, undefined,
            (a, b) => b.getEffects().lootBonus - a.getEffects().lootBonus, __filename)
        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                let tooLate = 0
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < areas.length; i++) {
                    const areaInfo = areas[i]

                    if (movements.find(movement =>
                        movement.kingdomID == kingdomID &&
                        movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                        continue

                    if ((areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000) - timeSinceEpoch > 0)
                        continue

                    await ClientCommands.preSpyInfo(areaInfo.x, areaInfo.y, kingdomID, false)

                    if (!allowedLevels.includes(areaInfo.extraData[2]))
                        continue

                    if (areaInfo.extraData[3] > 0)
                        continue
                    
                    if (areaInfo.extraData[5] != 0)
                        continue

                    if (!stormWatch.lands(marchDistance(castle.areaInfo, areaInfo))) {
                        tooLate++
                        continue
                    }

                    index = i
                    break
                }
                if (index == -1) {
                    if (tooLate > 0) {
                        closing = true
                        console.warn("stormClosingStopped")
                        reportStatus("stopped", "statusStormClosing")
                    }
                    return
                }

                const areaInfo = areas[index]

                const level = {
                    7: 60,
                    8: 70,
                    9: 80,
                    10: 40,
                    11: 50,
                    12: 60,
                    13: 70,
                    14: 80,
                }[areaInfo.extraData[2]]

                if (army.mode == "waves") {
                    const effects = commander.getEffects()
                    const planned = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, effects.additionalWaves)
                    planned.LP = 3
                    fillFromPlan(planned, army.waves, castle.unitInventory, {
                        flankUnits: getAmountSoldiersFlank(level, effects.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, effects.attackUnitAmountFront),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard: getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | effects.attackUnitAmountReinforcementBonus),
                    }, { kingdom: kingdomID, areaType: type })
                    return await sendAttack(planned, kingdomID, areaInfo.x, areaInfo.y, { dryRun: pluginOptions.dryRun })
                }

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerWallTools = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]
                    if (unit.amount <= 0)
                        continue

                    if (
                        unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack' &&
                        unit.unitInfo.amountPerWave == undefined
                    ) {
                        if (unit.unitInfo.wallBonus)
                            attackerWallTools.push(unit)
                    }
                    else if (unit.unitInfo.fightType == 0 && !unit.unitInfo.beefSupply) {
                        if (!eats(autofill.supply, unit.unitInfo))
                            continue
                        if (unit.unitInfo.role == "melee")
                            attackerMeleeTroops.push(unit)
                        else if (unit.unitInfo.role == "ranged")
                            attackerRangeTroops.push(unit)
                    }
                }

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e.amount)
                attackerMeleeTroops.forEach(e => allTroopCount += e.amount)

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"

                orderUnits(attackerMeleeTroops, autofill.unitOrder)
                orderUnits(attackerRangeTroops, autofill.unitOrder)

                const commanderStats = commander.getEffects()
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, 3, pluginOptions, commanderStats.additionalWaves)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const maxToolsFlank = 10

                attackInfo.LP = 3
                attackInfo.A.forEach((wave, index) => {
                    let maxTroops = maxTroopFlank
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach(unitSlot =>
                            maxTools -= assignUnit(unitSlot,
                                attackerWallTools, maxTools))
                    }

                    wave.L.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    maxTroops = maxTroopFlank
                    wave.R.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                })

                return await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, { dryRun: pluginOptions.dryRun })
            })

            if (!attackInfo || attackInfo.dryRun) {
                freeCommander(commander.lordID)
                return false
            }

            reportStatus("running")
            stormWatch.learn(attackInfo.AAM.M.TT - attackInfo.AAM.M.PT, marchDistance(castle.areaInfo, { x: attackInfo.AAM.M.TA[1], y: attackInfo.AAM.M.TA[2] }))
            console.info("hittingTargetAttack", 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    console.log("waitingForMoreTroops")
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").Types.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != castle.id)
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "CASTLE_LOCKED":
                case "CANT_START_NEW_ARMIES":
                    return true
                case "ATTACK_LIMIT_REACHED":
                    await waitOutDailyLimit(reportStatus)
                    return true
                default:
                    throw e
            }
        }
    }
    const byDistance = (a, b) =>
        (Math.pow(castle.areaInfo.x - a.x, 2) + Math.pow(castle.areaInfo.y - a.y, 2)) -
        (Math.pow(castle.areaInfo.x - b.x, 2) + Math.pow(castle.areaInfo.y - b.y, 2))
    /** Puts the forts in the order they are tried: nearest first, or by level and hits left with the nearest first among equals. */
    const queueForts = () => fortOrder == "nearest" ? areas.sort(byDistance) : areas.sort(byLevelThenHitsLeft)
    const byLevelThenHitsLeft = (a, b) => {
        if ((a.extraData[2] % 10) > (b.extraData[2] % 10))
            return -1
        if ((a.extraData[2] % 10) < (b.extraData[2] % 10))
            return 1
        //hits left
        if (a.extraData[4] < b.extraData[4])
            return -1
        if (a.extraData[4] > b.extraData[4])
            return 1

        return 0
    }

    if (mapGrid) {
        areas.push(...(await scanGrid(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, ai => ai.type == type)).sort(byDistance))
        queueForts()
        while (await sendHit());
    }
    if (areas.length == 0) {
        for (const rect of wholeMapRects(castle.areaInfo.x, castle.areaInfo.y)) {
            areas.push(...(await ClientCommands.getAreaInfo(kingdomID, rect.x, rect.y, rect.w, rect.h))
                .areaInfo.filter(ai => ai.type == type).sort(byDistance))

            if (areas.every(ai => ![7, 8, 9].includes(ai.extraData[2]))) //Find and hit a good one before continuing scanning
                continue

            queueForts()
            while (await sendHit());
        }
    }

    while (!closing) {
        let minimumTimeTillHit = Infinity

        for (let i = 0; i < areas.length; i++) {
            const areaInfo = areas[i]

            if (!allowedLevels.includes(areaInfo.extraData[2]))
                if (((areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000) - Date.now()) <= 0)
                    continue

            if (movements.find(movement =>
                movement.kingdomID == kingdomID &&
                movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                continue

            minimumTimeTillHit = Math.min(minimumTimeTillHit, (areaInfo.timeSinceRequest + areaInfo.extraData[3] * 1000))
        }

        let time = (Math.max(0, minimumTimeTillHit - Date.now()))
        console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
        await new Promise(r => setTimeout(r, time).unref())

        while (await sendHit());
    }
})