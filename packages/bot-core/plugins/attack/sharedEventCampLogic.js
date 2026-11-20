if (require("node:worker_threads").isMainThread)
    return module.exports = { hidden: true }

const pretty = require('pretty-time')
const { spendSkip } = require("../skips.js")
const { movementEvents, movements, AreaType, castles, ClientCommands } = require("../../protocols.js")
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave, sendAttack } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander.js")
const { areasAround, gridBoxes } = require("../../mapScan.js")
const { readArmy, fillFromPlan, parseAutofill, orderUnits, eats, choice, HORSES } = require("../../army.js")
const { readLegacy } = require("../../legacyOptions.js")
const { parseTarget, campQueue, campAt, eventCampOptions, CAMP_HORSES, CAMP_TOOL_SETS } = require("../../eventCamps.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo } = require("../../ggeBot.js")
const { statusReporter } = require("../../pluginStatus.js")

const eventsDifficulties = require("../../paths.js").loadItem("eventAutoScalingDifficulties")
const eventAutoScalingCamps = require("../../paths.js").loadItem("eventAutoScalingCamps")
const ggeConfig = require("../../config.js")

const minTroopCount = 100
/** With no camp to attack now, the plugin looks again after this long at least and at most, in milliseconds. */
const IDLE_MS = [5_000, 60_000]

/**
 * Attacks the camps of one event while it runs. `profile` is the event's entry in eventCamps.js' EVENT_PROFILES,
 * `stored` the plugin's stored options and `filename` the plugin's file, which its status goes by.
 */
function eventCampAttacks(profile, stored, filename) {
    const options = readLegacy(eventCampOptions(profile), stored)
    const toolSet = choice(CAMP_TOOL_SETS, options.tools, "all")
    const horse = { none: HORSES[0], coin: HORSES[1], feather: HORSES[2] }[choice(CAMP_HORSES, options.horse, "none")] ?? HORSES[0]
    const scoreShutoff = Number(options.scoreShutoff) > 0 ? Number(options.scoreShutoff) : Infinity
    const { eventID, kingdom: kingdomID, booster } = profile
    const type = AreaType[profile.areaType]
    const classicCamps = require("../../paths.js").loadItem(profile.classicCamps)
    let points = 0
    const reportStatus = statusReporter(filename)
    reportStatus("waiting", "statusEventClosed")
    const target = parseTarget(options)
    const autofill = parseAutofill(options)
    const queue = campQueue(target)

    const skipTarget = async areaInfo => {
        while (areaInfo.extraData[2] > 0 && queue.maySkip()) {
            let skip = spendSkip(areaInfo.extraData[2], options.skipTypes)

            if (skip == undefined)
                throw new Error("couldntFindSkip")

            const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

            if (result != 0)
                break
            queue.skipped()
        }
    }
    movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
        if (movement.targetOwner.ownerID != playerInfo.playerID)
            return

        if (movement.sourceAttack.type != type)
            return

        queue.update(movement.sourceAttack)
        if (!options.dryRun)
            skipTarget(movement.sourceAttack)
    })

    let quit = false

    xtHandler.on("pep", obj => {
        if (obj.EID != eventID)
            return

        points = Number(obj.OP[0])
        if (quit)
            return

        if (points >= scoreShutoff) {
            console.log("shuttingDownEvent", "scoreReached")
            reportStatus("stopped", "statusScoreReached", { score: points })
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

        if (eventInfo.EDID == -1 && !(ggeConfig.classicBug && options.eventDifficulty == 0)) {
            const eventDifficultyID =
                Number(eventsDifficulties.find(e =>
                    ((options.eventDifficulty)) == e.difficultyTypeID &&
                    e.eventID == eventID)
                    .difficultyID)

            await sendXT("sede", JSON.stringify({ EID: eventID, EDID: eventDifficultyID, C2U: 0 }))
            await waitForResult("sede", 1000 * 10)
            eventInfo.EDID = eventDifficultyID
        }
        let classic = false
        if ([-1, 0].includes(eventInfo.EDID))
            classic = true

        const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.mainCastle)

        const army = readArmy(options, reportStatus)
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
            const commander = await waitForCommanderAvailable(options.commanderWhiteList)
            try {
                const attackInfo = await waitToAttack(async () => {
                    const areaInfo = queue.pick(movements.filter(march => march.kingdomID == kingdomID))
                    if (!areaInfo)
                        return

                    if (!options.dryRun)
                        await skipTarget(areaInfo)
                    if (areaInfo.extraData[2] > 0 && !queue.maySkip())
                        return

                    const campInfo = classic ? profile.classicCamp(classicCamps, areaInfo.extraData) :
                        eventAutoScalingCamps.find(obj => areaInfo.extraData[5] == obj.eventAutoScalingCampID)

                    const level = Number(classic ? profile.classicLevel(campInfo) : campInfo.camplevel)
                    const context = { level, extraData: areaInfo.extraData, campID: campInfo?.eventAutoScalingCampID ?? campInfo?.id, dryRun: options.dryRun }

                    if (army.mode == "waves") {
                        const effects = commander.getEffects()
                        const planned = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, horse, effects.additionalWaves)
                        fillFromPlan(planned, army.waves, castle.unitInventory, {
                            flankUnits: getAmountSoldiersFlank(level, effects.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, effects.attackUnitAmountFront),
                            flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                            courtyard: getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | effects.attackUnitAmountReinforcementBonus),
                        })
                        return await sendAttack(planned, kingdomID, areaInfo.x, areaInfo.y, context)
                    }

                    const attackerMeleeTroops = []
                    const attackerRangeTroops = []
                    const attackerEventTools = []
                    const attackerWallEventTools = []
                    const attackerGateEventTools = []
                    const attackerShieldEventTools = []
                    const attackerWallTools = []
                    const attackerShieldTools = []

                    for (let i = 0; i < castle.unitInventory.length; i++) {
                        const unit = castle.unitInventory[i]
                        if (unit.amount <= 0)
                            continue

                        if (unit.unitInfo.wodID == 277)
                            continue

                        else if (profile.isEventTool(unit.unitInfo)) {
                            if (unit.unitInfo.gateBonus)
                                attackerGateEventTools.push(unit)
                            else if (unit.unitInfo.wallBonus)
                                attackerWallEventTools.push(unit)
                            else if (unit.unitInfo.defRangeBonus)
                                attackerShieldEventTools.push(unit)
                            else
                                attackerEventTools.push(unit)
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
                        else if (profile.isTroop(unit.unitInfo, options)) {
                            if (!eats(autofill.supply, unit.unitInfo))
                                continue
                            if(options.foodTroopsOnly && unit.unitInfo.meadSupply)
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

                    attackerEventTools.sort((a, b) =>
                        Number(b.unitInfo[booster]) - Number(a.unitInfo[booster]))
                    attackerGateEventTools.sort((a, b) =>
                        Number(b.unitInfo[booster]) - Number(a.unitInfo[booster]))
                    attackerWallEventTools.sort((a, b) =>
                        Number(b.unitInfo[booster]) - Number(a.unitInfo[booster]))
                    attackerShieldEventTools.sort((a, b) =>
                        Number(b.unitInfo[booster]) - Number(a.unitInfo[booster]))

                    if (options.lowValueChests) {
                        attackerEventTools.reverse()
                        attackerGateEventTools.reverse()
                        attackerWallEventTools.reverse()
                        attackerShieldEventTools.reverse()
                    }

                    attackerWallTools.sort((a, b) =>
                        Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                    attackerShieldTools.sort((a, b) =>
                        Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                    attackerWallEventTools.push(...attackerWallTools)
                    attackerShieldEventTools.push(...attackerShieldTools)

                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)
                    const commanderStats = commander.getEffects()
                    const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, horse, commanderStats.additionalWaves)
                    const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                    const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                    const desiredToolCount = attackerEventTools.length == 0 ? profile.plainToolCount : 10

                    const [flankShare, frontShare] = profile.splitToolRoom ? [2, 3] : [1, 1]

                    attackInfo.A.forEach((wave, index) => {
                        let maxTools = maxToolsFlank
                        if (index == 0) {
                            wave.L.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallEventTools : attackerShieldEventTools, Math.min(maxTools / flankShare, desiredToolCount)))

                            maxTools = maxToolsFlank
                            wave.R.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallEventTools : attackerShieldEventTools, Math.min(maxTools / flankShare, desiredToolCount)))

                            maxTools = maxToolsFront
                            wave.M.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallEventTools :
                                    i == 1 ? attackerGateEventTools : attackerShieldEventTools, Math.min(maxTools / frontShare, desiredToolCount)))

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
                        else if (toolSet == "all") {
                            const selectTool = i => {
                                let tools = options.eventWallToolsFirst ? [] : attackerEventTools
                                if (tools.length == 0 || !tools[0]?.unitInfo[booster]) {
                                    if (i == 0) {
                                        tools = attackerWallEventTools
                                        if (tools.length == 0 || !tools[0]?.unitInfo[booster])
                                            tools = attackerShieldEventTools
                                    }
                                    else if (i == 1) {
                                        tools = attackerShieldEventTools
                                        if (tools.length == 0 || !tools[0]?.unitInfo[booster])
                                            tools = attackerWallEventTools
                                    }
                                    if (i == 2) {
                                        tools = attackerGateEventTools
                                        if (tools.length == 0 || !tools[0]?.unitInfo[booster])
                                            tools = attackerWallEventTools
                                        if (tools.length == 0 || !tools[0]?.unitInfo[booster])
                                            tools = attackerShieldEventTools
                                    }
                                    if (!tools[0]?.unitInfo[booster])
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
                console.warn(e)
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
}

module.exports = eventCampAttacks
