const { armyOptions, unitOrderOption, supplyOption, parseAutofill, readArmy, fillFromPlan, orderUnits, eats, choice, HORSES } = require("../../army.js")
const { readLegacy } = require("../../legacyOptions.js")

const AUTOFILL = {
    sides: { left: "attackLeft", front: "attackMiddle", right: "attackRight", courtyard: "attackCourtyard" },
    whenNoSides: ["left", "front", "right", "courtyard"],
    waves: "attackWaves",
    tools: ["tools"],
    unitOrder: "unitOrder",
    supply: "supply",
    minTroops: "minTroops",
}
/** The horse of an attack, by the choice of the `horse` Select. "distance" picks one for each target. */
const BARON_HORSES = ["none", "coin", "feather", "distance"]
/** What the `tools` Select sends in the first wave: nothing, wall tools, or wall tools with shields beside them. */
const TOOL_SETS = ["none", "ladders", "all"]
const WAVE_COUNTS = ["All waves", "1 wave", "2 waves", "3 waves", "4 waves"]

/**
 * The options of every robber baron plugin, for the kingdom `kingdom`. `attackWaves` is the kingdom's default wave
 * count; 0 sends every wave. The `legacy` rules read what the horse, tool and wave options held before they were Selects.
 */
const baronOptions = ({ kingdom, attackWaves = 0 }) => [
    { type: "Label", key: "targetSettings" },
    { type: "CastlePicker", key: "sourceCastle", kingdom, default: null },
    { type: "Select", key: "towerFilter", selection: ["All towers", "Maxed only", "Non-maxed only"], default: 0 },
    { type: "Number", key: "searchRadius", min: 10, max: 100, unit: "tiles", display: "slider", default: 50 },
    { type: "Label", key: "limitSettings" },
    { type: "Number", key: "maxPerDay", min: 0, max: 4000, unit: "attacks", display: "slider", default: 0 },
    { type: "Number", key: "toolBudgetPerDay", min: 0, max: 10000, unit: "tools", display: "slider", default: 0 },
    { type: "Number", key: "attacksPerHour", min: 0, max: 120, unit: "attacks", default: 0 },
    { type: "Label", key: "horseSettings" },
    {
        type: "Select", key: "horse", selection: ["No horse", "Coin horse", "Feather", "By distance"], default: 1, copyToAll: true,
        legacy: { from: { useFeather: false, useCoin: true }, cases: [[{ useFeather: true }, 2], [{ useCoin: true }, 1]], otherwise: 0 },
    },
    { type: "Number", key: "horseDistance", min: 1, max: 100, unit: "tiles", default: 15 },
    { type: "Checkbox", key: "useTimeSkips", default: false },
    { type: "Checkbox", key: "upgradeTowers", default: false },
    { type: "Text", key: "commanderWhiteList", default: "1-99" },
    { type: "SkipTypes", key: "skipTypes", default: null, advanced: true },
    ...armyOptions(AUTOFILL),
    { type: "Label", key: "attackSettings", army: "autofill" },
    {
        type: "Select", key: "tools", selection: ["No tools", "Ladders only", "Ladders, rams and mantlets"], default: 1, army: "autofill",
        legacy: { from: { useWallTools: true, useShields: false }, cases: [[{ useWallTools: false }, 0], [{ useShields: true }, 2]], otherwise: 1 },
    },
    {
        type: "Select", key: "attackWaves", selection: WAVE_COUNTS, default: attackWaves, army: "autofill",
        legacy: { from: { attackWaves: "" }, cases: [1, 2, 3, 4].map(waves => [{ attackWaves: String(waves) }, waves]), otherwise: 0 },
    },
    { type: "Number", key: "minTroops", min: 0, max: 5000, unit: "troops", default: 0, army: "autofill" },
    { type: "Checkbox", key: "useDogs", default: false, army: "autofill" },
    { type: "Checkbox", key: "foodTroopsOnly", default: false, army: "autofill" },
    { type: "Checkbox", key: "attackLeft", default: false, army: "autofill" },
    { type: "Checkbox", key: "attackMiddle", default: false, army: "autofill" },
    { type: "Checkbox", key: "attackRight", default: false, army: "autofill" },
    { type: "Checkbox", key: "attackCourtyard", default: false, army: "autofill" },
    unitOrderOption(),
    supplyOption(),
]
const baronChecks = [{ type: "commanders", option: "commanderWhiteList" }, { type: "dailyAttacks" }]

if (require("node:worker_threads").isMainThread)
    return module.exports = { hidden: true, baronOptions, baronChecks }

const pretty = require("pretty-time")

const { spendSkip, haveEnoughSkips } = require("../skips.js")
const { statusReporter } = require("../../pluginStatus.js")
const { castles, ClientCommands, AreaType, KingdomID, movements, movementEvents, resources } = require("../../protocols")
const {
    waitToAttack,
    getAttackInfo,
    assignUnit,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    getTotalAmountToolsFlank, getTotalAmountToolsFront, sendAttack } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, botConfig, playerInfo } = require("../../ggeBot.js")
const { areasAround } = require("../../mapScan.js")
const err = require("../../err.json")
const minTroopCount = 80
const troopBlackList = [277]

try {
    var { recruitTroops } = require(require("../../paths.js").extraPlugin("externalEventHelper.js"))
}
catch (e) {
    console.debug(e)
}

/** `filename` is the plugin's file, which its status goes by. */
async function barronHit(type, kingdomID, stored, maxLevel, filename) {
    const options = readLegacy(baronOptions({ kingdom: kingdomID }), stored)
    const toolSet = choice(TOOL_SETS, options.tools, "ladders")
    const useWallTools = toolSet != "none"
    const useShields = toolSet == "all"
    // "distance" rides the coin horse until the bot picks a horse for each target.
    const horse = { none: HORSES[0], coin: HORSES[1], feather: HORSES[2], distance: HORSES[1] }[choice(BARON_HORSES, options.horse, "coin")]
    const autofill = parseAutofill(options)
    const army = readArmy(options, (...report) => statusReporter(filename)(...report))
    if (!army)
        return
    const getLevel = victorys =>
        Math.floor(1.9 * Math.pow(victorys, .555)) + ([1, 35, 20, 45][kingdomID] ?? 0)

    const castle = castles.find(e => e.kingdomID == kingdomID &&
        [AreaType.externalKingdom, AreaType.mainCastle].includes(e.areaInfo.type))

    do {
        try {
            var areas = (await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, ai => ai.type == type)).sort((a, b) =>
                    (Math.pow(castle.areaInfo.x - a.x, 2) + Math.pow(castle.areaInfo.y - a.y, 2)) -
                    (Math.pow(castle.areaInfo.x - b.x, 2) + Math.pow(castle.areaInfo.y - b.y, 2)))
            break
        } catch (e) {
            console.warn(e)
        }
    } while (true)

    async function skipTarget(areaInfo) {
        while (areaInfo.extraData[2] > 0) {
            let skip = spendSkip(areaInfo.extraData[2], options.skipTypes)

            if (skip == undefined)
                throw new Error("couldntFindSkip")

            const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

            if (result != 0)
                break
        }
    }
    
    movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
        if (movement.targetOwner.ownerID != playerInfo.playerID)
            return

        if(movement.kingdomID != kingdomID)
            return

        if (movement.sourceAttack.type != type)
            return

        const shouldUpgradeTower = options.upgradeTowers && getLevel(movement.sourceAttack.extraData[1], kingdomID) != maxLevel
        
        if ((options.useTimeSkips || shouldUpgradeTower) && 
            movements.find(movement2 => 
                movement2.kingdomID           == kingdomID               &&
                movement2.sourceAttack.type   == type                    && 
                movement2.sourceAttack.x      == movement.sourceAttack.x && 
                movement2.sourceAttack.y      == movement.sourceAttack.y))
                skipTarget(movement.sourceAttack)
    })

    const sendHit = async () => {
        const commander = await waitForCommanderAvailable(options.commanderWhiteList)
        const hasShieldMadiens = commander.getEffects(type).AttackSupportUnits
        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < areas.length; i++) {
                    const areaInfo = areas[i]
                    const shouldUpgradeTower = options.upgradeTowers && getLevel(areaInfo.extraData[1], kingdomID) != maxLevel
                    const skipsPerTower = 7200

                    const coinSkips = recruitTroops ? Math.floor(resources.coins / (1000 / (20 * 5))) : 0
                    const enoughSkips = haveEnoughSkips(skipsPerTower * movements.reduce((count, movement) =>
                        (movement.targetAttack.type == type ? count++ : count, count), 0) - coinSkips, options.skipTypes) || (recruitTroops && resources.coins > 25000)

                    if (enoughSkips && (options.useTimeSkips || shouldUpgradeTower)) {
                        try {
                            await skipTarget(areaInfo)
                        }
                        catch (e) {
                            console.warn(e)
                            continue
                        }
                    }
                    else if (((areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - timeSinceEpoch) > 0)
                        continue
                    else if (movements.find(movement =>
                        movement.kingdomID == kingdomID &&
                        movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                const areaInfo = areas[index]
                const level = getLevel(areaInfo.extraData[1], kingdomID)

                if (army.mode == "waves") {
                    const stats = commander.getEffects()
                    const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, horse, stats.additionalWaves)
                    fillFromPlan(attackInfo, army.waves, castle.unitInventory, {
                        flankUnits: getAmountSoldiersFlank(level, stats.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, stats.attackUnitAmountFront),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard: hasShieldMadiens ? 0 : getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | stats.attackUnitAmountReinforcementBonus),
                    })
                    return await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, { level, extraData: areaInfo.extraData })
                }

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerShieldTools = []
                const attackerWallTools = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]
                    if (unit.amount <= 0)
                        continue

                    if (unit.unitInfo.toolCategory &&
                        unit.unitInfo.usageEventID == undefined &&
                        unit.unitInfo.allowedToAttack == undefined &&
                        unit.unitInfo.typ == 'Attack' &&
                        unit.unitInfo.amountPerWave == undefined) {
                        if (unit.unitInfo.wallBonus)
                            attackerWallTools.push(unit)
                        else if (unit.unitInfo.defRangeBonus)
                            attackerShieldTools.push(unit)
                    }
                    else if (unit.unitInfo.fightType == 0 &&
                        unit.unitInfo.beefSupply == undefined) {
                        // The older switch keeps its meaning while the troop supply is All.
                        if (autofill.supply == "all" ? options.foodTroopsOnly && unit.unitInfo.meadSupply : !eats(autofill.supply, unit.unitInfo))
                            continue
                        if (!options.useDogs && unit.unitInfo.wodID == 277)
                            continue
                        if (options.useDogs && unit.unitInfo.wodID != 277)
                            continue
                        if (unit.unitInfo.role == "melee")
                            attackerMeleeTroops.push(unit)
                        else if (unit.unitInfo.role == "ranged")
                            attackerRangeTroops.push(unit)
                    }
                }

                orderUnits(attackerMeleeTroops, autofill.unitOrder)
                orderUnits(attackerRangeTroops, autofill.unitOrder)

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e.amount)
                attackerMeleeTroops.forEach(e => allTroopCount += e.amount)

                if (allTroopCount < minTroopCount)
                    throw "NO_MORE_TROOPS"

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                const autoConfigure = !(options.attackLeft || options.attackRight || options.attackMiddle)
                const attackLeft = autoConfigure || options.attackLeft
                const attackRight = autoConfigure || options.attackRight
                const attackMiddle = autoConfigure || options.attackMiddle
                const commanderStats = commander.getEffects()
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, Number(options.attackWaves), horse, commanderStats.additionalWaves)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const maxToolsFlank = useShields ? getTotalAmountToolsFlank(level, 0) : 10

                attackInfo.A.forEach((wave, index) => {
                    let maxTroops = maxTroopFlank

                    if (index == 0 && useWallTools) {
                        const desiredToolCount = 10
                        let maxTools = maxToolsFlank
                        if (attackLeft) {
                            wave.L.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallTools : attackerShieldTools, Math.min(maxTools, desiredToolCount)))

                            wave.L.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        }
                        maxTools = maxToolsFlank
                        if (attackRight) {
                            wave.R.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallTools : attackerShieldTools, Math.min(maxTools, desiredToolCount)))

                            maxTroops = maxTroopFlank
                            wave.R.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        }
                        maxTools = maxToolsFlank
                        if (attackMiddle) {
                            wave.M.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, i == 0 ?
                                    attackerWallTools : attackerShieldTools, Math.min(maxTools, desiredToolCount)))

                            maxTroops = maxTroopFront
                            wave.M.U.forEach(unitSlot =>
                                maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        }
                        return
                    }

                    if (attackLeft) {
                        wave.L.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                    if (attackRight) {
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                    if (attackMiddle) {
                        maxTroops = maxTroopFront
                        wave.M.U.forEach(unitSlot =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    }
                })

                if (autoConfigure ? (hasShieldMadiens ? false : true) : options.attackCourtyard) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | commanderStats.attackUnitAmountReinforcementBonus)
                    attackInfo.RW.forEach((unitSlot, i) => {
                        let attacker = i & 1 ?
                            (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops) :
                            (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops)

                        maxTroops -= assignUnit(unitSlot, attacker,
                            Math.floor(maxTroops / 2) - 1)
                    })
                }

                return await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, { level, extraData: areaInfo.extraData })
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            
            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    try {
                        if (botConfig.externalEvent && kingdomID == KingdomID.greatEmpire && recruitTroops) {
                            await recruitTroops(castle)
                            return true
                        }
                    }
                    catch (e) {
                        console.debug(e)
                    }
                    console.log("[", KingdomID[kingdomID], "] ", "waitingForMoreTroops")
                    await new Promise(resolve => movementEvents.on("return", function self(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
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
                case "ATTACK_TOO_MANY_UNITS":
                case "CASTLE_LOCKED":
                    return true
                case "CANT_START_NEW_ARMIES":
                default:
                    throw e
            }
        }
    }

    while (true) {
        if (!options.useTimeSkips && !options.upgradeTowers) {
            let minimumTimeTillHit = 5 * 1000 + Date.now()

            areas.forEach(areaInfo => {
                if (movements.find(movement =>
                    movement.kingdomID == kingdomID &&
                    movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                    return

                minimumTimeTillHit = Math.min(minimumTimeTillHit, (areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000))
            })

            const time = (Math.max(0, minimumTimeTillHit - Date.now()))
            if (time > 0)
                console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
            await new Promise(r => setTimeout(r, time).unref())
        }

        while (await sendHit());
    }
}

module.exports = barronHit