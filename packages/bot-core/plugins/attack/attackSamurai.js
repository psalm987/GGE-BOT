if (require('node:worker_threads').isMainThread)
    return module.exports = {
        checks: [{ type: "commanders", option: "commanderWhiteList" }, { type: "dailyAttacks" }],
        pluginOptions: [
            {
                type: "Select",
                key: "eventDifficulty",
                selection: [
                    "Classic",
                    "Easy",
                    "Easy+",
                    "Intermediate",
                    "Intermediate+",
                    "Hard",
                    "Hard+",
                    "Expert",
                    "Expert+",
                    "Master",
                    "Master+",
                    "Archmaster"
                ],
                default: "4"
            },
            ...require("../../eventCamps.js").campTargetOptions(),
            ...require("../../army.js").armyOptions({ sides: { left: true, front: true, right: true, courtyard: true }, waves: "all", tools: ["noChests", "lowValueChests"], whenNoTools: "eventTools", unitOrder: "unitOrder", supply: "supply" }),
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-50"
            },
            { type: "SkipTypes", key: "skipTypes", default: null, advanced: true },
            {
                type: "Checkbox",
                key: "lowValueChests",
                army: "autofill",
                default: false
            },
            {
                type: "Checkbox",
                key: "noChests",
                army: "autofill",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Checkbox",
                key: "foodTroopsOnly",
                army: "autofill",
                default: false
            },
            {
                type: "Text",
                key: "scoreShutoff"
            },
            require("../../army.js").unitOrderOption(),
            require("../../army.js").supplyOption(),
            {
                type: "Checkbox",
                key: "dryRun",
                default: false,
                advanced: true
            }
        ]

    }
const pretty = require('pretty-time')
const { spendSkip } = require("../skips.js")
const { movementEvents, movements, castles, AreaType, KingdomID, ClientCommands } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave, sendAttack } = require("./attack")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { areasAround, gridBoxes } = require("../../mapScan.js")
const { readArmy, fillFromPlan, parseAutofill, orderUnits, eats } = require("../../army.js")
const { parseTarget, campQueue, campAt } = require("../../eventCamps.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")

const eventsDifficulties = require("../../paths.js").loadItem("eventAutoScalingDifficulties")
const ggeConfig = require("../../config.js")
const samuraiCampsClassic = require("../../paths.js").loadItem("samuraiCamps")
const eventAutoScalingCamps = require("../../paths.js").loadItem("eventAutoScalingCamps")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const err = require('../../err.json')
const kingdomID = KingdomID.greatEmpire
const type = AreaType.samCamp
const minTroopCount = 100
const eventID = 80
let samsPoints = 0
const reportStatus = require("../../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusEventClosed")
const target = parseTarget(pluginOptions)
const autofill = parseAutofill(pluginOptions)
const queue = campQueue(target)

const skipTarget = async areaInfo => {
    while (areaInfo.extraData[2] > 0 && queue.maySkip()) {
        let skip = spendSkip(areaInfo.extraData[2], pluginOptions.skipTypes)

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

        if (result != 0)
            break
        queue.skipped()
    }
}
/** With no camp to attack now, the plugin looks again after this long at least and at most, in milliseconds. */
const IDLE_MS = [5_000, 60_000]

movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.targetOwner.ownerID != playerInfo.playerID)
        return

    if (movement.sourceAttack.type != type)
        return

    queue.update(movement.sourceAttack)
    if (!pluginOptions.dryRun)
        skipTarget(movement.sourceAttack)
})

let quit = false
xtHandler.on("pep", obj => {
    if (pluginOptions.scoreShutoff <= 0)
        pluginOptions.scoreShutoff = Infinity

    if (obj.EID != eventID)
        return
    samsPoints = Number(obj.OP[0])

    if (quit)
        return

    if (samsPoints >= pluginOptions.scoreShutoff) {
        console.log("shuttingDownEvent", "scoreReached")
        reportStatus("stopped", "statusScoreReached", { score: samsPoints })
        quit = true
    }
})
events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return
    if (quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    reportStatus("waiting", "statusEventClosed")
    quit = true
})
events.on("eventStart", async eventInfo => {
    if (eventInfo.EID != eventID)
        return

    if (eventInfo.EDID == -1 && !(ggeConfig.classicBug && pluginOptions.eventDifficulty == 0)) {
        const eventDifficultyID =
            Number(eventsDifficulties.find(e =>
                ((pluginOptions.eventDifficulty)) == e.difficultyTypeID &&
                e.eventID == eventID)
                .difficultyID)

        await sendXT("sede", JSON.stringify({ EID: eventID, EDID: eventDifficultyID, C2U: 0 }))
        await waitForResult("sede", 1000 * 10)
        eventInfo.EDID = eventDifficultyID
    }
    let classic = false
    if ([0, -1].includes(eventInfo.EDID))
        classic = true

    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.mainCastle)

    const army = readArmy(pluginOptions, reportStatus)
    if (!army)
        return
    queue.areas.length = 0
    if (target.mode == "single") {
        if (!target.at) {
            console.error("campTargetNotSet")
            return reportStatus("error", "statusCampTargetNotSet")
        }
        const camp = await campAt(ClientCommands.getAreaInfo, gridBoxes, kingdomID, target.at, type)
        if (!camp) {
            console.error("campTargetNotFound", `${target.at.x}:${target.at.y}`)
            return reportStatus("error", "statusCampTargetNotFound", target.at)
        }
        queue.areas.push(camp)
    }
    else
        queue.areas.push(...(await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, ai => ai.type == type))
            .sort((a, b) =>
                (Math.pow(castle.areaInfo.x - a.x, 2) + Math.pow(castle.areaInfo.y - a.y, 2)) -
                (Math.pow(castle.areaInfo.x - b.x, 2) + Math.pow(castle.areaInfo.y - b.y, 2)))
            .sort((a, b) => a.extraData[6] - b.extraData[6]))
    if (queue.areas.length == 0) {
        console.error("campsNoneFound")
        return reportStatus("stopped", "statusCampsNoneFound")
    }

    quit = false
    reportStatus("running")

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                const areaInfo = queue.pick(movements.filter(march => march.kingdomID == kingdomID))
                if (!areaInfo)
                    return

                if (!pluginOptions.dryRun)
                    await skipTarget(areaInfo)
                if (areaInfo.extraData[2] > 0 && !queue.maySkip())
                    return

                const campInfo = classic ? samuraiCampsClassic.find(obj => (areaInfo.extraData[1] + 1) == Number(obj.countVictory)) :
                    eventAutoScalingCamps.find(obj => areaInfo.extraData[5] == obj.eventAutoScalingCampID)

                const level = Number(classic ? (80 + Number(campInfo.countVictory)) : campInfo.camplevel)
                const context = { level, extraData: areaInfo.extraData, campID: campInfo?.eventAutoScalingCampID ?? campInfo?.id, dryRun: pluginOptions.dryRun }

                if (army.mode == "waves") {
                    const effects = commander.getEffects()
                    const planned = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, effects.additionalWaves)
                    fillFromPlan(planned, army.waves, castle.unitInventory, {
                        flankUnits: getAmountSoldiersFlank(level, effects.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, effects.attackUnitAmountFront),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard: getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | effects.attackUnitAmountReinforcementBonus),
                    })
                    return await sendAttack(planned, kingdomID, areaInfo.x, areaInfo.y, context)
                }

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerSamuraiTools = []
                const attackerWallSamuraiTools = []
                const attackerGateSamuraiTools = []
                const attackerShieldSamuraiTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]
                    if (unit.amount <= 0)
                        continue

                    if (unit.unitInfo.wodID == 277)
                        continue

                    else if (unit.unitInfo.samuraiTokenBooster != undefined) {
                        if (unit.unitInfo.gateBonus)
                            attackerGateSamuraiTools.push(unit)
                        else if (unit.unitInfo.wallBonus)
                            attackerWallSamuraiTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldSamuraiTools.push(unit)
                        else
                            attackerSamuraiTools.push(unit)
                    }
                    else if (
                        unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack' &&
                        unit.unitInfo.amountPerWave == undefined
                    ) {
                        if (unit.unitInfo.wallBonus)
                            attackerWallTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldTools.push(unit)
                    }
                    else if (unit.unitInfo.fightType == 0) {
                        if (!eats(autofill.supply, unit.unitInfo))
                            continue
                        if(pluginOptions.foodTroopsOnly && unit.unitInfo.meadSupply)
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

                attackerSamuraiTools.sort((a, b) =>
                    Number(b.unitInfo.samuraiTokenBooster) - Number(a.unitInfo.samuraiTokenBooster))
                attackerGateSamuraiTools.sort((a, b) =>
                    Number(b.unitInfo.samuraiTokenBooster) - Number(a.unitInfo.samuraiTokenBooster))
                attackerWallSamuraiTools.sort((a, b) =>
                    Number(b.unitInfo.samuraiTokenBooster) - Number(a.unitInfo.samuraiTokenBooster))
                attackerShieldSamuraiTools.sort((a, b) =>
                    Number(b.unitInfo.samuraiTokenBooster) - Number(a.unitInfo.samuraiTokenBooster))

                if (pluginOptions.lowValueChests) {
                    attackerSamuraiTools.reverse()
                    attackerGateSamuraiTools.reverse()
                    attackerWallSamuraiTools.reverse()
                    attackerShieldSamuraiTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                attackerWallSamuraiTools.push(...attackerWallTools)
                attackerShieldSamuraiTools.push(...attackerShieldTools)

                const commanderStats = commander.getEffects()
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)
                const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                const maxToolsFront = getTotalAmountToolsFront(level)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const desiredToolCount = attackerSamuraiTools.length == 0 || !attackerSamuraiTools[0]?.unitInfo?.samuraiTokenBooster ? 20 : 10

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallSamuraiTools : attackerShieldSamuraiTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallSamuraiTools : attackerShieldSamuraiTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallSamuraiTools :
                                i == 1 ? attackerGateSamuraiTools : attackerShieldSamuraiTools, Math.min(maxTools, desiredToolCount)))

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFront
                        wave.M.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))

                        if (autofill.unitOrder == "castle") {
                            attackerMeleeTroops.sort((a, b) => Number(a.unitInfo.meleeAttack) - Number(b.unitInfo.meleeAttack))
                            attackerRangeTroops.sort((a, b) => Number(a.unitInfo.rangeAttack) - Number(b.unitInfo.rangeAttack))
                        }
                        return
                    }
                    else if (!pluginOptions.noChests) {
                        const selectTool = i => {
                            let tools = attackerSamuraiTools
                            if (tools.length == 0 || !tools[0]?.unitInfo?.samuraiTokenBooster) {
                                if (i == 0) {
                                    tools = attackerWallSamuraiTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo?.samuraiTokenBooster)
                                        tools = attackerShieldSamuraiTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldSamuraiTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo?.samuraiTokenBooster)
                                        tools = attackerWallSamuraiTools
                                }
                                if (i == 2) {
                                    tools = attackerGateSamuraiTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo?.samuraiTokenBooster)
                                        tools = attackerWallSamuraiTools
                                    if (tools.length == 0 || !tools[0]?.unitInfo?.samuraiTokenBooster)
                                        tools = attackerShieldSamuraiTools
                                }
                                if (!tools[0]?.unitInfo?.samuraiTokenBooster)
                                    tools = []
                            }

                            return tools
                        }

                        wave.L.T.forEach(unitSlot =>
                            maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        maxTools = maxToolsFlank
                        wave.R.T.forEach(unitSlot =>
                            maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        maxTools = maxToolsFront
                        wave.M.T.forEach(unitSlot =>
                            maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                    }

                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    maxTroops = maxTroopFlank
                    wave.R.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                            attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    maxTroops = maxTroopFront
                    wave.M.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                            attackerMeleeTroops : attackerRangeTroops, maxTroops))
                })
                let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | commanderStats.attackUnitAmountReinforcementBonus)
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ?
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker,
                        Math.floor(maxTroops / 2) - 1)
                })

                return await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, context)
            })
            if (!attackInfo) {
                freeCommander(commander.lordID)
                const wait = Math.min(Math.max(queue.nextReadyAt() - Date.now(), IDLE_MS[0]), IDLE_MS[1])
                reportStatus("waiting", "statusCampsCooling", { minutes: Math.max(1, Math.ceil((queue.nextReadyAt() - Date.now()) / 60_000)) })
                await new Promise(resolve => setTimeout(resolve, wait).unref())
                continue
            }
            if (attackInfo.dryRun) {
                freeCommander(commander.lordID)
                continue
            }

            reportStatus("running")
            console.info("hittingTargetAttack", 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                        if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != castle.id)
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "CASTLE_LOCKED":
                case "CANT_START_NEW_ARMIES":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})