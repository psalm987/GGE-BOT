if (require("node:worker_threads").isMainThread)
    return module.exports = { hidden: true }

const pretty = require('pretty-time')
const { spendSkip } = require("../skips.js")
const { oneSkipPerCamp } = require("../../campSkips.js")
const { movementEvents, movements, AreaType, castles, ClientCommands, resources } = require("../../protocols.js")
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, courtyardRoom, sendAttack, openAttackScreen, waitForTroops, waitOutDailyLimit } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, commanderRefused } = require("../commander.js")
const { areasAround, gridBoxes } = require("../../mapScan.js")
const { readArmy, fillFromPlan, parseAutofill, orderUnits, eats, choice, HORSES } = require("../../army.js")
const { readLegacy } = require("../../legacyOptions.js")
const { parseTarget, campQueue, hitsBeforeCooldown, areaAt, readCamp, sortTargets, eventCampOptions, EVENT_PROFILES, CAMP_HORSES, CAMP_TOOL_SETS, KEEP_DIFFICULTY } = require("../../eventCamps.js")
const { pickSourceCastle, castleName, marchDistance, horseByDistance } = require("../../towers.js")
const { campAttackLine } = require("../../attackLog.js")
const { xtHandler, events, playerInfo } = require("../../ggeBot.js")
const { presetsListed } = require("../../gamePresets.js")
const { settleDifficulty } = require("../../eventDifficulty.js")
const { statusReporter } = require("../../pluginStatus.js")
const { sleep } = require("../../pacing.js")

const eventAutoScalingCamps = require("../../paths.js").loadItem("eventAutoScalingCamps")

const minTroopCount = 100
/** A count of attacks in a status is rounded down to this step once it passes it, so the status isn't rewritten after every attack. */
const STATUS_STEP = 10

/** A camp the game refused as not ready (a refused skip or screen, COOLING_DOWN, WONT_REACH_IN_TIME) is left alone this long. */
const NOT_READY_HOLD_MS = 5 * 60_000
/** Short of coins, the plugin waits this long before it tries again. */
const COINS_WAIT_MS = 10 * 60_000

/** With no camp to attack now, the plugin looks again after this long at least and at most, in milliseconds. */
const IDLE_MS = [5_000, 60_000]

/**
 * Attacks the camps of one event while it runs. `profile` is the event's entry in eventCamps.js' EVENT_PROFILES,
 * `stored` the plugin's stored options and `filename` the plugin's file, which its status goes by.
 */
function eventCampAttacks(profile, stored, filename) {
    const options = readLegacy(eventCampOptions(profile), stored)
    const toolSet = choice(CAMP_TOOL_SETS, options.tools, "all")
    const horseChoice = choice(CAMP_HORSES, options.horse, "none")
    const horseDistance = Number(options.horseDistance) || 15
    const RIDES = { none: HORSES[0], coin: HORSES[1], feather: HORSES[2] }
    const scoreShutoff = Number(options.scoreShutoff) > 0 ? Number(options.scoreShutoff) : Infinity
    const runLimit = Math.max(0, Number(options.attacksPerRun) || 0)
    const troopFloor = Math.max(minTroopCount, Number(options.minTroops) || 0)
    // With left, middle and right all off the plugin fills every side, as it did before the sides could be chosen.
    const everySide = !(options.attackLeft || options.attackMiddle || options.attackRight)
    const sides = {
        left: everySide || Boolean(options.attackLeft), front: everySide || Boolean(options.attackMiddle),
        right: everySide || Boolean(options.attackRight), courtyard: everySide || Boolean(options.attackCourtyard),
    }
    const { eventID, kingdom: kingdomID, booster } = profile
    const type = AreaType[profile.areaType]
    const classicCamps = require("../../paths.js").loadItem(profile.classicCamps)
    const rows = { classicRows: classicCamps, scalingRows: eventAutoScalingCamps }
    const said = { attacking: "statusCampsAttacking", cooling: "statusCampsCooling", noneFound: "statusCampsNoneFound", unreadable: "statusCampsUnreadable", ...profile.statuses }
    let points = 0
    const reportStatus = statusReporter(filename)
    reportStatus("waiting", "statusEventClosed")
    const target = parseTarget(options)
    const autofill = parseAutofill(options)
    const queue = campQueue(target)

    let saidOutOfSkips = false
    /**
     * Skips a camp's wait while the budget allows, and returns the skips it spent. With no skip left the queue falls
     * back to camps that are ready on their own, and a refused skip holds the camp; before, both stopped the plugin or
     * sent the attack to a camp still cooling down.
     */
    const skipTarget = oneSkipPerCamp(async areaInfo => {
        const spent = []
        while (areaInfo.extraData[2] > 0 && queue.maySkip()) {
            const skip = spendSkip(areaInfo.extraData[2], options.skipTypes)
            if (skip == undefined) {
                queue.outOfSkips()
                if (!saidOutOfSkips)
                    console.warn("campOutOfSkips")
                saidOutOfSkips = true
                break
            }

            const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

            if (result != 0) {
                queue.hold(areaInfo, NOT_READY_HOLD_MS)
                break
            }
            saidOutOfSkips = false
            queue.skipped()
            spent.push(skip)
        }
        return spent
    })
    movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
        if (movement.targetOwner.ownerID != playerInfo.playerID)
            return

        if (movement.sourceAttack.type != type)
            return

        queue.update(movement.sourceAttack)
        if (!options.dryRun)
            skipTarget(movement.sourceAttack).catch(e => console.warn(e))
    })

    let quit = false
    /** Whether the event runs, and which start of it the latest is, so a scan that waits stops when the event ends or starts again. */
    let running = false, starts = 0
    /** The attacks sent since the event, or the bot, last started. */
    let sentThisRun = 0

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

        running = false
        if (quit)
            return

        console.log("shuttingDownEvent", "eventEnded")
        reportStatus("waiting", "statusEventClosed")
        quit = true
    })
    events.on("eventStart", async eventInfo => {
        if (eventInfo.EID != eventID)
            return
        running = true
        const start = ++starts
        const live = () => running && start == starts
        const unready = target.mode != "single" && profile.unready?.(options)
        if (unready) {
            console.warn("campsNoneWanted")
            return reportStatus("error", unready)
        }

        if (eventInfo.EDID == -1 && Number(options.eventDifficulty) == KEEP_DIFFICULTY) {
            console.warn("campDifficultyNotSet")
            return reportStatus("waiting", "statusCampDifficultyNotSet")
        }
        const settled = await settleDifficulty(eventID, eventInfo.EDID, options.eventDifficulty)
        if (settled.refused) {
            console.warn("campDifficultyRefused", settled.refused)
            return reportStatus("waiting", "statusCampDifficultyRefused")
        }
        eventInfo.EDID = settled.EDID
        let classic = false
        if ([-1, 0].includes(eventInfo.EDID))
            classic = true
        queue.room = classic ? () => 1 : area => hitsBeforeCooldown(eventAutoScalingCamps, area.extraData[5])

        const source = pickSourceCastle(castles, kingdomID, options.sourceCastle, [AreaType.mainCastle])
        const castle = source.castle
        const from = castleName(castle)
        if (source.fellBack)
            console.warn("campSourceCastleGone", from)
        let saidNoBoosters = false
        /** Whether the last attack wanted a feather and rode the coin horse because the player has none. */
        let outOfFeathers = false
        /** What `getAttackInfo` reads the horse from, for one camp, and the name the log gives it. */
        function horseFor(areaInfo) {
            if (horseChoice != "distance")
                return { ride: RIDES[horseChoice], name: horseChoice }
            const picked = horseByDistance(marchDistance(castle.areaInfo, areaInfo), horseDistance, resources.pegasusTicket)
            if (picked.fellBack && !outOfFeathers)
                console.warn("campNoFeathers")
            outOfFeathers = picked.fellBack
            return { ride: RIDES[picked.horse], name: picked.horse }
        }
        const shown = () => runLimit > 0 ? `${sentThisRun}/${runLimit}` : String(sentThisRun < STATUS_STEP ? sentThisRun : Math.floor(sentThisRun / STATUS_STEP) * STATUS_STEP)
        const reportAttacking = () => target.mode == "single"
            ? reportStatus("running", "statusCampAttackingOne", { ...target.at, castle: from, attacks: shown() })
            : reportStatus("running", said.attacking, { found: queue.areas.length, castle: from, attacks: shown() })

        const army = readArmy(options, reportStatus)
        if (!army || !await presetsListed(army, reportStatus))
            return
        queue.areas.length = 0
        let found
        if (target.mode == "single") {
            if (!target.at) {
                console.error("campTargetNotSet")
                return reportStatus("error", "statusCampTargetNotSet")
            }
            const camp = await areaAt(ClientCommands.getAreaInfo, gridBoxes, kingdomID, target.at)
            if (camp?.type != type) {
                const otherEvent = Object.values(EVENT_PROFILES).some(other => AreaType[other.areaType] == camp?.type)
                console.error(otherEvent ? "campTargetOtherEvent" : "campTargetNotFound", `${target.at.x}:${target.at.y}`)
                return reportStatus("error", otherEvent ? "statusCampTargetOtherEvent" : "statusCampTargetNotFound", target.at)
            }
            found = sortTargets(profile, [camp], classic, rows)
        }
        else {
            /** The camps around the castle, the lowest camp id first and the nearer camp first among equals. */
            const scan = async () => {
                const areas = (await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, ai => ai.type == type))
                    .sort((a, b) =>
                        (Math.pow(castle.areaInfo.x - a.x, 2) + Math.pow(castle.areaInfo.y - a.y, 2)) -
                        (Math.pow(castle.areaInfo.x - b.x, 2) + Math.pow(castle.areaInfo.y - b.y, 2)))
                    .sort((a, b) => a.extraData[5] - b.extraData[5])
                return sortTargets(profile, areas, classic, rows, read => profile.wants?.(read, options) ?? true)
            }
            found = await scan()
            while (profile.rescanMs && found.kept.length == 0 && found.unreadable.length == 0) {
                reportStatus("waiting", said.noneFound, { castle: from, minutes: profile.rescanMs / 60_000 })
                await sleep(profile.rescanMs)
                if (!live())
                    return
                found = await scan()
            }
        }
        if (found.unreadable.length > 0)
            console.warn("campsUnreadable", found.unreadable.map(({ area, problem }) => `${area.x}:${area.y} ${problem} ${JSON.stringify(area.extraData)}`).join(", "))
        if (found.kept.length == 0 && found.unreadable.length > 0)
            return reportStatus("error", said.unreadable, { count: found.unreadable.length })
        if (found.kept.length == 0) {
            if (target.mode == "single") {
                console.error("campTargetNotFound", `${target.at.x}:${target.at.y}`)
                return reportStatus("error", "statusCampTargetNotFound", target.at)
            }
            console.error("campsNoneFound")
            return reportStatus("stopped", said.noneFound, { castle: from })
        }
        queue.areas.push(...found.kept)

        quit = false
        sentThisRun = 0
        if (source.fellBack)
            reportStatus("waiting", "statusCampCastleFallback", { castle: from })
        else
            reportAttacking()

        /**
         * The next camp to attack and what its map entry reads, with its wait skipped where the plugin skips, or
         * undefined. When the skips run out on the first camp it tries once more, now among camps ready on their own.
         */
        async function readyCamp(sending) {
            for (let tries = 0; tries < 2; tries++) {
                const areaInfo = queue.pick(movements.filter(march => march.kingdomID == kingdomID))
                if (!areaInfo)
                    return
                const read = readCamp(profile, areaInfo.extraData, classic, rows)
                if (read.problem || (target.mode != "single" && profile.wants && !profile.wants(read, options))) {
                    if (read.problem)
                        console.warn("campsUnreadable", `${areaInfo.x}:${areaInfo.y} ${read.problem} ${JSON.stringify(areaInfo.extraData)}`)
                    queue.areas.splice(queue.areas.indexOf(areaInfo), 1)
                    return
                }
                sending.camp = areaInfo
                if (!options.dryRun)
                    sending.skips = await skipTarget(areaInfo)
                if (areaInfo.extraData[2] <= 0 || (options.dryRun && queue.maySkip()))
                    return { areaInfo, read }
            }
        }

        while (!quit) {
            const commander = await waitForCommanderAvailable(options.commanderWhiteList, undefined, undefined, filename)
            /** What the log line says of the attack being built: the skips spent on the camp and the horse. */
            const sending = { skips: [], horse: "none", camp: undefined }
            try {
                const attackInfo = await waitToAttack(async () => {
                    const { areaInfo, read } = await readyCamp(sending) ?? {}
                    if (!areaInfo)
                        return
                    const horse = horseFor(areaInfo)
                    sending.horse = horse.name

                    const { level } = read
                    const context = { level, extraData: areaInfo.extraData, campID: read.campID, dryRun: options.dryRun, deleteReports: options.deleteReports }
                    const lord = await openAttackScreen(castle, areaInfo, kingdomID, commander, { dryRun: options.dryRun })
                    if (areaInfo.extraData[2] > 0 && !options.dryRun)
                        return

                    if (army.mode == "waves") {
                        const effects = lord.getEffects(areaInfo.type)
                        const planned = getAttackInfo(kingdomID, castle, areaInfo, lord, level, undefined, horse.ride, effects.additionalWaves)
                        fillFromPlan(planned, army.waves, castle.unitInventory, {
                            flankUnits: getAmountSoldiersFlank(level, effects.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, effects.attackUnitAmountFront),
                            flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                            courtyard: courtyardRoom(level, effects),
                        }, { kingdom: kingdomID, areaType: areaInfo.type })
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
                        else if (profile.isTroop(unit.unitInfo)) {
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

                    if (allTroopCount < troopFloor)
                        throw "NO_MORE_TROOPS"
                    if (toolSet == "all" && booster && !saidNoBoosters && ![attackerEventTools, attackerWallEventTools, attackerGateEventTools, attackerShieldEventTools].some(tools => tools.length)) {
                        saidNoBoosters = true
                        console.warn("campNoEventBoosters")
                    }

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
                    const commanderStats = lord.getEffects(areaInfo.type)
                    const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, lord, level, Number(options.attackWaves), horse.ride, commanderStats.additionalWaves)
                    const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                    const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                    const desiredToolCount = attackerEventTools.length == 0 ? profile.plainToolCount : 10

                    const [flankShare, frontShare] = profile.splitToolRoom ? [2, 3] : [1, 1]

                    attackInfo.A.forEach((wave, index) => {
                        let maxTools = maxToolsFlank
                        if (index == 0) {
                            if (toolSet != "none") {
                                if (sides.left)
                                    wave.L.T.forEach((unitSlot, i) =>
                                        maxTools -= assignUnit(unitSlot, i == 0 ?
                                            attackerWallEventTools : attackerShieldEventTools, Math.min(maxTools / flankShare, desiredToolCount)))

                                maxTools = maxToolsFlank
                                if (sides.right)
                                    wave.R.T.forEach((unitSlot, i) =>
                                        maxTools -= assignUnit(unitSlot, i == 0 ?
                                            attackerWallEventTools : attackerShieldEventTools, Math.min(maxTools / flankShare, desiredToolCount)))

                                maxTools = maxToolsFront
                                if (sides.front)
                                    wave.M.T.forEach((unitSlot, i) =>
                                        maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallEventTools :
                                            i == 1 ? attackerGateEventTools : attackerShieldEventTools, Math.min(maxTools / frontShare, desiredToolCount)))
                            }

                            let maxTroops = maxTroopFlank

                            if (sides.left)
                                wave.L.U.forEach(unitSlot =>
                                    maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                        attackerMeleeTroops : attackerRangeTroops, maxTroops))
                            maxTroops = maxTroopFlank
                            if (sides.right)
                                wave.R.U.forEach(unitSlot =>
                                    maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                        attackerMeleeTroops : attackerRangeTroops, maxTroops))
                            maxTroops = maxTroopFront
                            if (sides.front)
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

                            if (sides.left)
                                wave.L.T.forEach(unitSlot =>
                                    maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                            maxTools = maxToolsFlank
                            if (sides.right)
                                wave.R.T.forEach(unitSlot =>
                                    maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                            maxTools = maxToolsFront
                            if (sides.front)
                                wave.M.T.forEach(unitSlot =>
                                    maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                        }

                        let maxTroops = maxTroopFlank

                        if (sides.left)
                            wave.L.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                    attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        if (sides.right)
                            wave.R.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                    attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFront
                        if (sides.front)
                            wave.M.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                    })
                    let maxTroops = courtyardRoom(level, commanderStats)
                    if (sides.courtyard) attackInfo.RW.forEach((unitSlot, i) => {
                        let attacker = i & 1 ?
                            (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) :
                            (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                        maxTroops -= assignUnit(unitSlot, attacker,
                            Math.floor(maxTroops / 2) - 1)
                    })

                    return await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, context)
                }, filename)
                if (!attackInfo) {
                    freeCommander(commander.lordID)
                    const wait = Math.min(Math.max(queue.nextReadyAt() - Date.now(), IDLE_MS[0]), IDLE_MS[1])
                    reportStatus("waiting", said.cooling, { minutes: Math.max(1, Math.ceil((queue.nextReadyAt() - Date.now()) / 60_000)) })
                    await new Promise(resolve => setTimeout(resolve, wait).unref())
                    continue
                }
                sentThisRun++
                if (attackInfo.dryRun)
                    freeCommander(commander.lordID)
                else {
                    if (!quit)
                        reportAttacking()
                    console.info(...campAttackLine(profile.logName, attackInfo.AAM.UM.L.VIS + 1, attackInfo.AAM.M.TA[1], attackInfo.AAM.M.TA[2],
                        pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), sending))
                }
                if (!quit && runLimit > 0 && sentThisRun >= runLimit) {
                    console.log("shuttingDownEvent", "campRunLimitReached")
                    reportStatus("stopped", "statusCampRunLimit", { limit: runLimit })
                    quit = true
                }
            } catch (e) {
                e == "LORD_IS_USED" ? commanderRefused(commander.lordID) : freeCommander(commander.lordID)
                console.warn(e)
                if (sending.camp && ["ATTACK_SCREEN_REFUSED", "COOLING_DOWN", "WONT_REACH_IN_TIME"].includes(e))
                    queue.hold(sending.camp, NOT_READY_HOLD_MS)
                switch (e) {
                    case "NOT_ENOUGH_CURRENCY1":
                        await sleep(COINS_WAIT_MS)
                        break
                    case "ATTACK_LIMIT_REACHED":
                        await waitOutDailyLimit(reportStatus)
                        break
                    case "NO_MORE_TROOPS":
                        reportStatus("waiting", army.mode == "waves" ? "statusCampPlanShort" : "statusCampNoTroops", { castle: from, floor: troopFloor })
                        await waitForTroops(movement => movement.kingdomID == kingdomID && movement.targetAttack.extraData[0] == castle.id)
                        break
                    case "LORD_IS_USED":
                    case "ATTACK_SCREEN_REFUSED":
                    case "COOLING_DOWN":
                    case "WONT_REACH_IN_TIME":
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
