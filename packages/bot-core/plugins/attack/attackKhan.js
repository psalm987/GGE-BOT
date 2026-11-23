if (require('node:worker_threads').isMainThread)
    return module.exports = {
        checks: require("../../commanderOptions.js").commanderChecks,
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
            ...require("../../commanderOptions.js").commanderOptions(),
            { type: "SkipTypes", key: "skipTypes", default: null },
            ...require("../../army.js").armyOptions({ sides: { left: true, front: true, right: true, courtyard: true }, waves: "all", tools: ["noChests", "lowValueChests", "eventWallToolsFirst"], whenNoTools: "eventTools", unitOrder: "unitOrder", supply: "supply" }),
            {
                type: "Checkbox",
                key: "eventWallToolsFirst",
                default: false,
                army: "autofill"
            },
            {
                type: "Checkbox",
                key: "lowValueChests",
                default: false,
                army: "autofill"
            },
            ...require("../../khan.js").khanWaveOptions(),
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: true
            },
            {
                type: "Checkbox",
                key: "noChests",
                army: "autofill",
                default: false
            },
            require("../../army.js").unitOrderOption(),
            require("../../army.js").supplyOption(require("../../army.js").SUPPLY_SWITCHES),
            {
                type: "Text",
                key: "scoreShutoff",
                default: ""
            },
            ...require("../../khan.js").khanChainOptions(),
            {
                type: "Checkbox",
                key: "dryRun",
                default: false
            }
        ]

    }

const { spendSkip } = require("../skips.js")
const { oneSkipPerCamp } = require("../../campSkips.js")
const { movementEvents, movements, castles, AreaType, KingdomID, ClientCommands } = require("../../protocols.js")
const { waitToAttack, getAttackInfo, assignUnit, fillEventTools, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave, sendAttack } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander.js")
const { sendXT, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")
const { settleDifficulty } = require("../../eventDifficulty.js")
const { keepDefence } = require("../../khanDefence.js")

const nomadCampsClassic = require("../../paths.js").loadItem("nomadCamps")

const { readArmy, fillFromPlan, parseAutofill, orderUnits, eats, supplyOption, SUPPLY_SWITCHES } = require("../../army.js")
const { presetsListed } = require("../../gamePresets.js")
const { readLegacy } = require("../../legacyOptions.js")
const { khanWaveOptions, parseKhan, waveKind, isTaunt, incomingTaunts, tauntHold, defenceResult, tauntLandings, DEFENCE_TOOLS } = require("../../khan.js")
const { holdingsOf, gained, loadRewardNames, rewardLine } = require("../../khanRewards.js")
const pluginOptions = readLegacy([...khanWaveOptions(), supplyOption(SUPPLY_SWITCHES)], botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {})
const khan = parseKhan(pluginOptions)
const autofill = parseAutofill(pluginOptions)
const reportStatus = require("../../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusEventClosed")
const eventAutoScalingCamps = require("../../paths.js").loadItem("eventAutoScalingCamps")
const pretty = require('pretty-time')

const kingdomID = KingdomID.greatEmpire
const type = AreaType.khanCamp
const minTroopCount = 100
const eventID = 72
const troopBlackList = [277, 34, 35]

let campRageNeeded = NaN
/** The defence keeper, started with the first run of the event. */
let defence

const skipTarget = oneSkipPerCamp(async areaInfo => {
    while (areaInfo.extraData[2] > 0) {
        let skip = spendSkip(areaInfo.extraData[2], pluginOptions.skipTypes)

        if (skip == undefined)
            throw new Error("couldntFindSkip")

        const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

        if (result != 0)
            break
    }
})
/** While hits are paused for incoming taunts, the count is looked at again after this long, in milliseconds. */
const TAUNT_RECHECK_MS = 20_000

movementEvents.on("outgoing", async (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.owner?.ownerID != playerInfo.playerID)
        return

    if (movement.targetAttack.type != type)
        return

    campRageNeeded = eventAutoScalingCamps.find(campInfo =>
        campInfo.eventAutoScalingCampID == movement.targetAttack.extraData[6]).playerRageCap
})

movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.owner?.ownerID != playerInfo.playerID)
        return

    if (movement.sourceAttack.type != type)
        return

    campRageNeeded = eventAutoScalingCamps.find(campInfo =>
        campInfo.eventAutoScalingCampID == movement.sourceAttack.extraData[6]).playerRageCap
    skipTarget(movement.sourceAttack).catch(e => console.warn(e))
})

let nomadsPoints = 0
let quit = false
let defenceShort = false
let defenceLost = false
let rage = 0
/** The hold logged last, so a hold is announced when it starts or changes and never once per `rpr`. */
let announced

const HOLD_WARNINGS = { defenceShort: "khanTauntHeldDefenceShort", defenceLost: "khanTauntHeldDefenceLost" }

function announce(hold) {
    if (hold == announced)
        return
    const before = announced
    announced = hold
    if (HOLD_WARNINGS[hold])
        console.warn(HOLD_WARNINGS[hold])
    else if (!hold && HOLD_WARNINGS[before])
        console.info("khanTauntsResumed")
}

/** Spends the full rage bar on a taunt unless something holds it. Called with each `rpr` and whenever a hold clears. */
function tryTaunt() {
    const hold = tauntHold({ tabletsOnly: khan.tabletsOnly, dryRun: pluginOptions.dryRun, quit, defenceLost, defenceShort })
    announce(hold)
    if (hold || !(rage >= campRageNeeded))
        return
    console.info("rageTrigger")
    rage = 0
    sendXT("lta", JSON.stringify({ AV: 0, EID: eventID }))
}

xtHandler.on("rpr", ({ EID, PCRP }) => {
    if (EID != eventID)
        return

    rage = PCRP
    if (rage > campRageNeeded)
        console.warn("rageTooHigh")
    tryTaunt()
})

const landings = tauntLandings()
const seenTaunts = new Set()

movementEvents.on("outgoing", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ march) => {
    if (!isTaunt(march, playerInfo.playerID, type) || seenTaunts.has(march.id))
        return
    seenTaunts.add(march.id)
    landings.expect(Date.now() + Math.max(0, march.totalTime - (march.deltaTime - Date.now())))
})

/** The player's mystery boxes, keys and construction items as the game last listed them, by the command that lists each. */
const holdings = {}
for (const command of ["gls", "gii"])
    xtHandler.on(command, (reply, result) => {
        if (Number(result) == 0)
            holdings[command] = holdingsOf(command, reply)
    })
/** How long after a battle report its reward pushes have all come in, in milliseconds. They came within 0.2 s. */
const REWARDS_SETTLE_MS = 3000
let rewardNames
/** Logs what a defended taunt paid: how far the holdings rose from the battle report to a moment after it. */
function logTauntRewards() {
    const before = { ...holdings }
    setTimeout(() => {
        const gains = Object.keys(holdings).flatMap(command => gained(before[command], holdings[command]))
        if (gains.length == 0)
            return
        rewardNames ??= loadRewardNames()
        console.info("khanTauntRewards", rewardLine(gains, rewardNames))
    }, REWARDS_SETTLE_MS).unref?.()
}

xtHandler.on("sne", ({ MSG }) => {
    for (const message of Array.isArray(MSG) ? MSG : []) {
        const result = defenceResult(message, playerInfo.playerID)
        if (!result || !landings.claim(Date.now()))
            continue
        if (result == "held") {
            console.info("khanDefenceHeld")
            logTauntRewards()
        }
        else {
            console.warn("khanDefenceLost")
            defenceLost = true
            tryTaunt()
        }
    }
})

xtHandler.on("pep", ({ EID, OP }) => {
    if (EID != eventID)
        return

    nomadsPoints = Number(OP[0])

    if (quit)
        return

    if (pluginOptions.scoreShutoff <= 0)
        pluginOptions.scoreShutoff = Infinity

    if (nomadsPoints >= pluginOptions.scoreShutoff) {
        console.log("shuttingDownEvent", "scoreReached")
        reportStatus("stopped", "statusScoreReached", { score: nomadsPoints })
        quit = true
    }
})
events.on("eventStop", ({ EID }) => {
    if (EID != eventID)
        return

    // A lost defence holds taunts through reconnects, which start the event again, and only until the event ends.
    defenceLost = false
    if (quit)
        return

    console.log("shuttingDownEvent", "eventEnded")
    reportStatus("waiting", "statusEventClosed")
    quit = true
})
events.on("eventStart", async ({ EID, EDID }) => {
    if (EID != eventID)
        return

    const settled = await settleDifficulty(eventID, EDID, pluginOptions.eventDifficulty)
    if (settled.refused) {
        console.warn("campDifficultyRefused", settled.refused)
        return reportStatus("waiting", "statusCampDifficultyRefused")
    }
    EDID = settled.EDID
    let classic = false

    if ([-1, 0].includes(EDID))
        classic = true

    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.mainCastle)

    const army = readArmy(pluginOptions, reportStatus)
    if (!army || !await presetsListed(army, reportStatus))
        return

    quit = false
    reportStatus("running")
    if (khan.keepDefence) {
        defence ??= keepDefence({
            castle, kingdomID, isTaunt: march => isTaunt(march, playerInfo.playerID, type), dryRun: pluginOptions.dryRun,
            onChecked: ({ missing }) => {
                defenceShort = missing > 0
                tryTaunt()
            },
        })
        defence.refill()
    }
    tryTaunt()

    const { areaInfo } = await ClientCommands.getNextMapObject(type, kingdomID)

    while (!quit) {
        const taunts = incomingTaunts(movements, playerInfo.playerID, type)
        if (khan.pauseAtTaunts > 0 && taunts >= khan.pauseAtTaunts) {
            reportStatus("waiting", "statusKhanTauntsPaused", { taunts, limit: khan.pauseAtTaunts })
            await new Promise(resolve => setTimeout(resolve, TAUNT_RECHECK_MS).unref())
            continue
        }
        reportStatus("running")
        const commander = await waitForCommanderAvailable(pluginOptions.commanderWhiteList)
        try {
            const attackInfo = await waitToAttack(async () => {
                if (!pluginOptions.dryRun)
                    await skipTarget(areaInfo)

                const campInfo = classic ? nomadCampsClassic.find(obj => areaInfo.extraData[1] == obj.id) :
                    eventAutoScalingCamps.find(obj => areaInfo.extraData[6] == obj.eventAutoScalingCampID)

                const level = Number(classic ? (80 + campInfo.countVictory) : campInfo.camplevel)
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
                const attackerBannerKhanTools = []
                const attackerNomadTools = []
                const attackerWallNomadTools = []
                const attackerGateNomadTools = []
                const attackerShieldNomadTools = []
                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]
                    if (unit.amount <= 0)
                        continue

                    if (unit.unitInfo.ragePointBonus != undefined)
                        attackerBannerKhanTools.push(unit)
                    else if (unit.unitInfo.khanTabletBooster != undefined) {
                        if (unit.unitInfo.gateBonus)
                            attackerGateNomadTools.push(unit)
                        else if (unit.unitInfo.wallBonus)
                            attackerWallNomadTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldNomadTools.push(unit)
                        else
                            attackerNomadTools.push(unit)
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
                    else if (unit.unitInfo.fightType == 0 && !unit.unitInfo.beefSupply) {
                        if (!eats(autofill.supply, unit.unitInfo))
                            continue
                        if (troopBlackList.includes(unit.unitInfo.wodID))
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

                attackerBannerKhanTools.sort((a, b) =>
                    Number(b.unitInfo.ragePointBonus + Number(b.unitInfo.khanTabletBooster ?? 0)) -
                    Number(a.unitInfo.ragePointBonus + Number(a.unitInfo.khanTabletBooster ?? 0)))

                attackerNomadTools.sort((a, b) =>
                    Number(b.unitInfo.khanTabletBooster ?? 0) - Number(a.unitInfo.khanTabletBooster ?? 0))
                attackerGateNomadTools.sort((a, b) =>
                    Number(b.unitInfo.khanTabletBooster ?? 0) - Number(a.unitInfo.khanTabletBooster ?? 0))
                attackerWallNomadTools.sort((a, b) =>
                    Number(b.unitInfo.khanTabletBooster ?? 0) - Number(a.unitInfo.khanTabletBooster ?? 0))
                attackerShieldNomadTools.sort((a, b) =>
                    Number(b.unitInfo.khanTabletBooster ?? 0) - Number(a.unitInfo.khanTabletBooster ?? 0))

                if (pluginOptions.lowValueChests) {
                    attackerBannerKhanTools.reverse()
                    attackerNomadTools.reverse()
                    attackerGateNomadTools.reverse()
                    attackerWallNomadTools.reverse()
                    attackerShieldNomadTools.reverse()
                }

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                attackerWallNomadTools.push(...attackerWallTools)
                attackerShieldNomadTools.push(...attackerShieldTools)

                const commanderStats = commander.getEffects()
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, pluginOptions, commanderStats.additionalWaves)
                const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                const maxToolsFront = getTotalAmountToolsFront(level)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const desiredToolCount = attackerNomadTools.length == 0 || (!attackerNomadTools[0]?.unitInfo?.khanTabletBooster && !attackerNomadTools[0]?.unitInfo?.ragePointBonus) ? 20 : 10

                attackInfo.A.forEach((wave, index) => {
                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallNomadTools :
                                i == 1 ? attackerGateNomadTools : attackerShieldNomadTools, Math.min(maxTools, desiredToolCount)))

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
                    const kind = pluginOptions.noChests ? "troops" : waveKind(khan, index)
                    const room = { flank: maxToolsFlank, front: maxToolsFront }
                    if (kind == "booster" && khan.tabletChests.length > 0)
                        fillEventTools([wave], castle.unitInventory.filter(unit => unit.unitInfo.ragePointBonus == undefined), { maxTools: room, bonusField: "khanTabletBooster", list: khan.tabletChests })
                    else if (kind == "booster") {
                        const selectTool = i => {
                            let tools = attackerNomadTools
                            if (tools.length == 0 || (!tools[0]?.unitInfo?.khanTabletBooster && !tools[0]?.unitInfo?.ragePointBonus)) {
                                if (i == 0) {
                                    tools = attackerWallNomadTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo?.khanTabletBooster && !tools[0]?.unitInfo?.ragePointBonus))
                                        tools = attackerShieldNomadTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldNomadTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo?.khanTabletBooster && !tools[0]?.unitInfo?.ragePointBonus))
                                        tools = attackerWallNomadTools
                                }
                                if (i == 2) {
                                    tools = attackerGateNomadTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo?.khanTabletBooster && !tools[0]?.unitInfo?.ragePointBonus))
                                        tools = attackerWallNomadTools
                                    if (tools.length == 0 || (!tools[0]?.unitInfo?.khanTabletBooster && !tools[0]?.unitInfo?.ragePointBonus))
                                        tools = attackerShieldNomadTools
                                }
                                if (!tools[0]?.unitInfo?.khanTabletBooster && !tools[0]?.unitInfo?.ragePointBonus)
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
                    else if (kind == "rage" && !pluginOptions.eventWallToolsFirst)
                        fillEventTools([wave], attackerBannerKhanTools, { maxTools: room, bonusField: "ragePointBonus", list: khan.rageTools.length > 0 ? khan.rageTools : undefined })
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
            if (!attackInfo || attackInfo.dryRun) {
                freeCommander(commander.lordID)
                continue
            }
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
                case "ATTACK_TOO_MANY_UNITS":
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


// The Khan's counter-attacks use up defence tools, so the main castle's stock is topped up from the armourer.
require("../../armourer.js").keepStocked("khanArmourer", DEFENCE_TOOLS, kingdomID, pluginOptions, ["khanDefenceToolsBought", "khanDefenceToolsCoins"])
