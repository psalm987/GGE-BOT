/** The camps the `campSide` Select attacks, by the id of a camp's owner: -411 is the red side's and -410 the blue side's. */
const CAMP_SIDES = [undefined, -411, -410]
/** The first wave that carries event tools, counted from 0, by the choice of the `eventToolsFrom` Select. */
const FIRST_TOOL_WAVES = [1, 2, 3, 4]
/**
 * `eventToolsFrom` replaced the text option `wavesTillChests`, which the plugin declared and never read. Event tools
 * always started in the second wave, so that is what every stored record means.
 */
const waveOptions = () => [{
    type: "Select", key: "eventToolsFrom", selection: ["Wave 2", "Wave 3", "Wave 4", "Wave 5"], default: 0, army: "autofill",
    legacy: { from: { wavesTillChests: "4" }, cases: [], otherwise: 0 },
}]

if (require('node:worker_threads').isMainThread)
    return module.exports = {
        targets: [{ kingdom: 0, areaType: require("../../areaTypes.js").AreaType.beriCamp }],
        checks: require("../../commanderOptions.js").commanderChecks,
        pluginOptions: [
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
            ...require("../../commanderOptions.js").commanderOptions(),
            { type: "SkipTypes", key: "skipTypes", default: null },
            { type: "Select", key: "campSide", selection: ["All camps", "Red camps only", "Blue camps only"], default: 0 },
            { type: "CastlePicker", key: "sourceCastle", kingdom: 0, default: null },
            ...require("../../army.js").armyOptions({ sides: { left: true, front: true, right: true, courtyard: true }, waves: "all", tools: ["noEventTools", "reputation", "lowValueChests"], whenNoTools: "eventTools", unitOrder: "unitOrder", supply: "supply" }),
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false,
                army: "autofill"
            },
            ...waveOptions(),
            {
                type: "Checkbox",
                key: "noEventTools",
                army: "autofill",
                default: false
            },
            {
                type: "Checkbox",
                key: "reputation",
                army: "autofill",
                default: false
            },
            require("../../army.js").unitOrderOption(),
            require("../../army.js").supplyOption(),
            {
                type: "Checkbox",
                key: "dryRun",
                default: false
            }
        ]

    }
const { spendSkip } = require("../skips.js")
const { oneSkipPerCamp } = require("../../campSkips.js")
const { movementEvents, ClassTypes, castles, ClientCommands, AreaType, KingdomID } = require("../../protocols.js")
const { waitToAttack, waitOutDailyLimit, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, courtyardRoom, sendAttack, openAttackScreen, waitForTroops } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, commanderRefused } = require('../commander.js')
const { areasAround } = require("../../mapScan.js")
const { pickSourceCastle, castleName } = require("../../towers.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require('../../ggeBot.js')


const pretty = require('pretty-time')

const err = require('../../err.json')

const { readArmy, fillFromPlan, parseAutofill, orderUnits, eats, choice } = require("../../army.js")
const { presetsListed } = require("../../gamePresets.js")
const { readLegacy } = require("../../legacyOptions.js")
const pluginOptions = readLegacy(waveOptions(), botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {})
const autofill = parseAutofill(pluginOptions)
const campOwner = choice(CAMP_SIDES, pluginOptions.campSide, undefined)
const firstToolWave = choice(FIRST_TOOL_WAVES, pluginOptions.eventToolsFrom, 1)
const reportStatus = require("../../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusEventClosed")

const kingdomID = KingdomID.greatEmpire
const type = AreaType.beriCamp
const minTroopCount = 100
const eventID = 85

/** A camp the game refused as not ready (a refused skip or screen, COOLING_DOWN, WONT_REACH_IN_TIME) is left alone this long. */
const NOT_READY_HOLD_MS = 5 * 60_000
/** Short of coins, the plugin waits this long before it tries again. */
const COINS_WAIT_MS = 10 * 60_000
/** With no camp to attack now, the plugin looks again after this long at least and at most, in milliseconds. */
const IDLE_MS = [5_000, 60_000]
/** Camp -> when a refusal's hold on it ends. */
const heldUntil = new Map()
const keyOf = areaInfo => `${areaInfo.x}:${areaInfo.y}`
const readyAt = areaInfo => Math.max((areaInfo.timeSinceRequest ?? 0) + (Number(areaInfo.extraData[2]) || 0) * 1000, heldUntil.get(keyOf(areaInfo)) ?? 0)

let saidOutOfSkips = false
/** Skips a camp's wait. With no skip left the plugin attacks camps that are ready on their own instead of stopping. */
const skipTarget = oneSkipPerCamp(async areaInfo => {
    while (areaInfo.extraData[2] > 0) {
        const skip = spendSkip(areaInfo.extraData[2], pluginOptions.skipTypes)
        if (skip == undefined) {
            if (!saidOutOfSkips)
                console.warn("campOutOfSkips")
            saidOutOfSkips = true
            break
        }

        const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

        if (result != 0) {
            heldUntil.set(keyOf(areaInfo), Date.now() + NOT_READY_HOLD_MS)
            break
        }
        saidOutOfSkips = false
    }
})

movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.targetOwner.ownerID != playerInfo.playerID)
        return

    if (movement.sourceAttack.type != type)
        return

    if (!pluginOptions.dryRun)
        skipTarget(movement.sourceAttack).catch(e => console.warn(e))
})

let quit = false

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

    const army = readArmy(pluginOptions, reportStatus)
    if (!army || !await presetsListed(army, reportStatus))
        return

    const source = pickSourceCastle(castles, kingdomID, pluginOptions.sourceCastle, [AreaType.mainCastle])
    const castle = source.castle
    if (source.fellBack)
        console.warn("campSourceCastleGone", castleName(castle))

    const areas = (await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, ai => ai.type == type))
        .filter(ai => campOwner === undefined || ai.extraData[4] == campOwner)
    if (areas.length == 0) {
        console.error("campsNoneFound")
        return reportStatus("stopped", campOwner === undefined ? "statusCampsNoneFound" : "statusCampsNoneOfSide")
    }

    quit = false
    if (source.fellBack)
        reportStatus("running", "statusCampCastleFallback", { castle: castleName(castle) })
    else
        reportStatus("running")

    /**
     * The next camp in turn that is ready, its wait skipped where the player has skips, or undefined. A camp still
     * cooling down after that is passed over: before, it got the attack anyway.
     */
    async function readyCamp() {
        for (let tries = 0; tries < areas.length; tries++) {
            const areaInfo = areas.shift()
            areas.push(areaInfo)
            if ((heldUntil.get(keyOf(areaInfo)) ?? 0) > Date.now())
                continue
            if (pluginOptions.dryRun)
                return areaInfo
            await skipTarget(areaInfo)
            if (readyAt(areaInfo) <= Date.now())
                return areaInfo
        }
    }

    while (!quit) {
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList, undefined, undefined, __filename)
        let target
        try {
            const attackInfo = await waitToAttack(async () => {
                const areaInfo = target = await readyCamp()
                if (!areaInfo)
                    return
                const lord = await openAttackScreen(castle, areaInfo, kingdomID, commander, { dryRun: pluginOptions.dryRun })
                if (readyAt(areaInfo) > Date.now() && !pluginOptions.dryRun)
                    return
                const level = areaInfo.extraData[1] + (areaInfo.extraData[6] == 100 ? 70 : 56)
                const context = { level, extraData: areaInfo.extraData, dryRun: pluginOptions.dryRun }

                if (army.mode == "waves") {
                    const effects = lord.getEffects(type)
                    const planned = getAttackInfo(kingdomID, castle, areaInfo, lord, level, undefined, pluginOptions, effects.additionalWaves)
                    fillFromPlan(planned, army.waves, castle.unitInventory, {
                        flankUnits: getAmountSoldiersFlank(level, effects.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, effects.attackUnitAmountFront),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard: courtyardRoom(level, effects),
                    }, { kingdom: kingdomID, areaType: type })
                    return await sendAttack(planned, kingdomID, areaInfo.x, areaInfo.y, context)
                }

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBerimondTools = []
                const attackerWallBerimondTools = []
                const attackerGateBerimondTools = []
                const attackerShieldBerimondTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]


                    if (unit.unitInfo.wodID == 277)
                        continue

                    else if (unit.unitInfo.pointBonus && !pluginOptions.noEventTools) {
                        if (unit.unitInfo.gateBonus)
                            attackerGateBerimondTools.push(unit)
                        else if (unit.unitInfo.wallBonus)
                            attackerWallBerimondTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldBerimondTools.push(unit)
                        else if (!pluginOptions.reputation)
                            attackerBerimondTools.push(unit)
                    }
                    else if (unit.unitInfo.reputationBonus && pluginOptions.reputation && !pluginOptions.noEventTools) {
                        attackerBerimondTools.push(unit)
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
                if (pluginOptions.reputation) {
                    attackerBerimondTools.sort((a, b) =>
                        Number(b.unitInfo.reputationBonus) - Number(a.unitInfo.reputationBonus))
                }
                else {
                    attackerBerimondTools.sort((a, b) =>
                        Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                }
                attackerGateBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerWallBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))
                attackerShieldBerimondTools.sort((a, b) =>
                    Number(b.unitInfo.pointBonus) - Number(a.unitInfo.pointBonus))

                if (pluginOptions.lowValueChests) {
                    attackerBerimondTools.reverse()
                    attackerGateBerimondTools.reverse()
                    attackerWallBerimondTools.reverse()
                    attackerShieldBerimondTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                attackerWallBerimondTools.push(...attackerWallTools)
                attackerShieldBerimondTools.push(...attackerShieldTools)

                const commanderStats = lord.getEffects(type)
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, lord, level, undefined, pluginOptions, commanderStats.additionalWaves)

                const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                const maxToolsFront = getTotalAmountToolsFront(level)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const desiredToolCount = attackerBerimondTools.length == 0 ? 20 : 10

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallBerimondTools :
                                i == 1 ? attackerGateBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

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
                    }
                    else if (!pluginOptions.noEventTools && index >= firstToolWave) {
                        const selectTool = i => {
                            let tools = attackerBerimondTools
                            if (tools.length == 0 || ((!tools[0]?.unitInfo.pointBonus && !tools[0]?.unitInfo.reputationBonus))) {
                                if (i == 0) {
                                    tools = attackerWallBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo.pointBonus && !tools[0]?.unitInfo.reputationBonus))
                                        tools = attackerShieldBerimondTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo.pointBonus && !tools[0]?.unitInfo.reputationBonus))
                                        tools = attackerWallBerimondTools
                                }
                                if (i == 2) {
                                    tools = attackerGateBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo.pointBonus && !tools[0]?.unitInfo.reputationBonus))
                                        tools = attackerWallBerimondTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo.pointBonus && !tools[0]?.unitInfo.reputationBonus))
                                        tools = attackerShieldBerimondTools
                                }
                                if ((!tools[0]?.unitInfo.pointBonus && !tools[0]?.unitInfo.reputationBonus))
                                    tools = []
                            }

                            return tools
                        }

                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFront
                        wave.M.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    }
                })
                let maxTroops = courtyardRoom(level, commanderStats)
                attackInfo.RW.forEach((unitSlot, i) => {
                    let attacker = i & 1 ?
                        (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                        (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                    maxTroops -= assignUnit(unitSlot, attacker,
                        Math.floor(maxTroops / 2) - 1)
                })

                return await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, context)
            }, __filename)
            if (!attackInfo) {
                freeCommander(commander.lordID)
                const nextReady = Math.min(...areas.map(readyAt))
                await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(nextReady - Date.now(), IDLE_MS[0]), IDLE_MS[1])).unref())
                continue
            }
            if (attackInfo.dryRun) {
                freeCommander(commander.lordID)
                continue
            }



            reportStatus("running")
            console.info("hittingTargetAttack", 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
        } catch (e) {
            e == "LORD_IS_USED" ? commanderRefused(commander.lordID) : freeCommander(commander.lordID)
            if (target && ["ATTACK_SCREEN_REFUSED", "COOLING_DOWN", "WONT_REACH_IN_TIME"].includes(e))
                heldUntil.set(keyOf(target), Date.now() + NOT_READY_HOLD_MS)
            switch (e) {
                case "NOT_ENOUGH_CURRENCY1":
                    await new Promise(resolve => setTimeout(resolve, COINS_WAIT_MS).unref())
                    break
                case "NO_MORE_TROOPS":
                    await waitForTroops(movement => movement.kingdomID == kingdomID && movement.targetAttack.extraData[0] == castle.id)
                    break
                case "LORD_IS_USED":
                case "ATTACK_SCREEN_REFUSED":
                case "WONT_REACH_IN_TIME":
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "CASTLE_LOCKED":
                case "CANT_START_NEW_ARMIES":
                    break
                case "ATTACK_LIMIT_REACHED":
                    await waitOutDailyLimit(reportStatus)
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})