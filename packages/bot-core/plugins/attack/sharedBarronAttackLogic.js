const { armyOptions, unitOrderOption, supplyOption, parseAutofill, readArmy, fillFromPlan, orderUnits, eats, choice, HORSES } = require("../../army.js")
const { readLegacy } = require("../../legacyOptions.js")
const { towerAttackLine } = require("../../attackLog.js")
const { spendOptions } = require("../../stockOptions.js")

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
/** The tools the armoury tops up for each choice of the `tools` Select: ladders, and with rams and mantlets also 611 and 620. */
const AUTO_BUY_TOOLS = { none: [], ladders: [614], all: [614, 611, 620] }
/** The stock is looked at again no sooner than this, in milliseconds, so a refused or capped buy is not tried at every attack. */
const AUTO_BUY_RECHECK_MS = 5 * 60_000
const WAVE_COUNTS = ["All waves", "1 wave", "2 waves", "3 waves", "4 waves"]

/**
 * The options of every robber baron plugin, for the kingdom `kingdom`. `attackWaves` is the kingdom's default wave
 * count; 0 sends every wave. The `legacy` rules read what the horse, tool and wave options held before they were Selects.
 */
const baronOptions = ({ kingdom, attackWaves = 0 }) => [
    { type: "Label", key: "targetSettings" },
    { type: "CastlePicker", key: "sourceCastle", kingdom, default: null },
    { type: "Select", key: "towerFilter", selection: ["All towers", "Maxed only", "Non-maxed only"], default: 0 },
    { type: "Number", key: "searchRadius", min: 10, max: 100, unit: "clicks", display: "slider", default: 50 },
    { type: "Label", key: "limitSettings" },
    { type: "Number", key: "maxPerDay", min: 0, max: 4000, unit: "attacks", display: "slider", default: 0 },
    { type: "Number", key: "attacksPerHour", min: 0, max: 600, unit: "attacks", default: 0 },
    { type: "Label", key: "horseSettings" },
    {
        type: "Select", key: "horse", selection: ["No horse", "Coin horse", "Feather", "By distance"], default: 1, copyToAll: true,
        legacy: { from: { useFeather: false, useCoin: true }, cases: [[{ useFeather: true }, 2], [{ useCoin: true }, 1]], otherwise: 0 },
    },
    { type: "Number", key: "horseDistance", min: 1, max: 100, unit: "clicks", default: 15, showWhen: { key: "horse", in: [3] } },
    { type: "Checkbox", key: "useTimeSkips", default: false },
    { type: "Checkbox", key: "upgradeTowers", default: false },
    ...require("../../commanderOptions.js").commanderOptions(),
    { type: "SkipTypes", key: "skipTypes", default: null },
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
    { type: "Label", key: "armourySettings", army: "autofill" },
    { type: "Checkbox", key: "autoBuy", default: false, army: "autofill" },
    { type: "Number", key: "autoBuyMin", min: 0, max: 100_000, step: 100, unit: "tools", default: 1000, army: "autofill", showWhen: { key: "autoBuy", in: [1] } },
    ...spendOptions().map(def => ({ ...def, army: "autofill", showWhen: { key: "autoBuy", in: [1] } })),
]
const baronChecks = require("../../commanderOptions.js").commanderChecks

if (require("node:worker_threads").isMainThread)
    return module.exports = { hidden: true, baronOptions, baronChecks }

const pretty = require("pretty-time")

const { spendSkip, haveEnoughSkips } = require("../skips.js")
const { oneSkipPerCamp } = require("../../campSkips.js")
const { statusReporter } = require("../../pluginStatus.js")
const { castles, ClientCommands, AreaType, KingdomID, movements, movementEvents, resources } = require("../../protocols")
const {
    waitToAttack,
    getAttackInfo,
    assignUnit,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    getTotalAmountToolsFlank, getTotalAmountToolsFront, sendAttack, accountLimits } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, botConfig, playerInfo } = require("../../ggeBot.js")
const { areasAround, MAX_RADIUS } = require("../../mapScan.js")
const { TOWER_FILTERS, towerLevel, matchesFilter, marchDistance, pickSourceCastle, RollingWindow, DAY, HOUR, toolsIn, horseByDistance } = require("../../towers.js")

const { boxMullerRandom, sleep } = require("../../pacing.js")
const { topUp } = require("../../armourer.js")
const err = require("../../err.json")
const minTroopCount = 80
const troopBlackList = [277]

try {
    var { recruitTroops } = require(require("../../paths.js").extraPlugin("externalEventHelper.js"))
}
catch (e) {
    console.debug(e)
}

/** A scan is not repeated sooner than this, in minutes: 30, and up to 10 more so that kingdoms don't scan in step. */
const RESCAN_MINUTES = [30, 40]
/** After a scan the game didn't answer, the next one waits this long, in seconds. */
const SCAN_RETRY_SECONDS = [45, 120]
/** With nothing to attack, the plugin looks again after this long at most and this soon at least, in milliseconds. */
const IDLE_MS = [5_000, 60_000]
/** With the account's daily limit reached, the plugin asks again after this long, in milliseconds. */
const DAILY_LIMIT_RECHECK_MS = 30 * 60_000
/** Counts in a status are rounded down to these steps, so the status isn't rewritten after every attack. */
const STATUS_STEPS = { attacks: 10 }
/** A castle short of troops is looked at again after this long even when no march comes home, in milliseconds. */
const TROOPS_RECHECK_MS = 10 * 60_000

const castleName = castle => String(castle.areaInfo.extraData?.[7] || `${castle.areaInfo.x}:${castle.areaInfo.y}`)

/** `filename` is the plugin's file, which its status goes by. */
async function barronHit(type, kingdomID, stored, maxLevel, filename) {
    const options = readLegacy(baronOptions({ kingdom: kingdomID }), stored)
    const reportStatus = statusReporter(filename)
    const toolSet = choice(TOOL_SETS, options.tools, "ladders")
    const useWallTools = toolSet != "none"
    const useShields = toolSet == "all"
    const horseChoice = choice(BARON_HORSES, options.horse, "coin")
    const horseDistance = Number(options.horseDistance) || 15
    const RIDES = { none: HORSES[0], coin: HORSES[1], feather: HORSES[2] }
    /** Whether the last attack wanted a feather and rode the coin horse, or walked, because the player has none. */
    let outOfFeathers = false
    /** What `getAttackInfo` reads the horse from, for one target. */
    function horseFor(areaInfo) {
        if (horseChoice != "distance")
            return RIDES[horseChoice]
        const ride = horseByDistance(marchDistance(castle.areaInfo, areaInfo), horseDistance, resources.pegasusTicket)
        if (ride.fellBack && !outOfFeathers)
            console.warn("towersNoFeathers")
        outOfFeathers = ride.fellBack
        return RIDES[ride.horse]
    }
    const troopFloor = Math.max(minTroopCount, Number(options.minTroops) || 0)
    const caps = { day: Number(options.maxPerDay) || 0, hour: Number(options.attacksPerHour) || 0 }
    const sentInDay = new RollingWindow(DAY), sentInHour = new RollingWindow(HOUR)
    // What the runner kept of this kingdom's last 24 hours, so a restart doesn't hand the limits back.
    for (const { at } of botConfig.attackHistory?.[require("node:path").basename(filename, ".js")] ?? []) {
        sentInDay.add(at)
        sentInHour.add(at)
    }
    /** The minutes until `time`, rounded up to 5 above ten minutes and to 30 above an hour, so a long wait's status is rewritten seldom. */
    const minutesTo = time => {
        const minutes = Math.max(1, Math.ceil((time - Date.now()) / 60_000))
        const step = minutes > 60 ? 30 : minutes > 10 ? 5 : 1
        return Math.ceil(minutes / step) * step
    }
    /**
     * The limit that keeps this kingdom from attacking now, as a status and the time it lifts, or undefined. When
     * several apply, the one that lifts last is the one in force.
     */
    function limitInForce() {
        const now = Date.now()
        const account = accountLimits()
        const blocks = [
            caps.day > 0 && { until: sentInDay.roomAt(now, caps.day), key: "statusTowersLimitDay", params: { cap: caps.day } },
            caps.hour > 0 && { until: sentInHour.roomAt(now, caps.hour), key: "statusTowersLimitHour", params: { cap: caps.hour } },
            !account.hourlyLeft && { until: now + IDLE_MS[1], key: "statusTowersLimitShared", params: { cap: account.hourly } },
            account.used >= account.limit && { until: now + DAILY_LIMIT_RECHECK_MS, key: "statusTowersLimitAccount", params: { cap: account.limit } },
        ].filter(block => block && block.until > now)
        return blocks.sort((a, b) => b.until - a.until)[0]
    }
    /** The numbers every status of a running kingdom carries. */
    const progress = () => {
        const now = Date.now()
        const shown = (used, step, cap) => cap > 0 ? `${used}/${cap}` : String(used < step ? used : Math.floor(used / step) * step)
        return { castle: from, found: areas.length, attacks: shown(sentInDay.total(now), STATUS_STEPS.attacks, caps.day) }
    }
    const autofill = parseAutofill(options)
    const army = readArmy(options, reportStatus)
    if (!army)
        return
    const filter = choice(TOWER_FILTERS, options.towerFilter, "all")
    const radius = Math.min(Number(options.searchRadius) || 50, MAX_RADIUS)
    const getLevel = victorys => towerLevel(victorys, kingdomID)
    const wanted = areaInfo => areaInfo.type == type && matchesFilter(filter, getLevel(areaInfo.extraData[1]), maxLevel)

    const source = pickSourceCastle(castles, kingdomID, options.sourceCastle, [AreaType.externalKingdom, AreaType.mainCastle])
    const castle = source.castle
    if (!castle) {
        console.warn("towersNoCastle")
        reportStatus("stopped", "statusTowersNoCastle")
        return
    }
    const from = castleName(castle)
    if (source.fellBack) {
        console.warn("towersSourceCastleGone", from)
        reportStatus("waiting", "statusTowersCastleFallback", { castle: from })
    }

    let areas = []
    let nextScanAt = 0
    /** Looks at the map again. Towers that appeared since the last look come in, and every wait and level is fresh. */
    async function scan() {
        try {
            const found = await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, wanted, { radius })
            areas = found.sort((a, b) => marchDistance(castle.areaInfo, a) - marchDistance(castle.areaInfo, b))
            nextScanAt = Date.now() + boxMullerRandom(...RESCAN_MINUTES) * 60_000
        } catch (e) {
            console.warn(e)
            nextScanAt = Date.now() + boxMullerRandom(...SCAN_RETRY_SECONDS) * 1000
        }
    }
    const inFlight = areaInfo => movements.some(movement =>
        movement.kingdomID == kingdomID && movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y)
    const readyAt = areaInfo => areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000

    const skipTarget = oneSkipPerCamp(async areaInfo => {
        while (areaInfo.extraData[2] > 0) {
            let skip = spendSkip(areaInfo.extraData[2], options.skipTypes)

            if (skip == undefined)
                throw new Error("couldntFindSkip")

            const { result } = await ClientCommands.skipTarget(type, areaInfo.x, areaInfo.y, kingdomID, skip)

            if (result != 0)
                break
        }
    })

    movementEvents.on("returning", (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
        if (movement.targetOwner.ownerID != playerInfo.playerID)
            return

        if(movement.kingdomID != kingdomID)
            return

        if (movement.sourceAttack.type != type)
            return

        // The march home carries the tower as the attack left it: its new level and the wait before the next attack.
        const hit = areas.find(areaInfo => areaInfo.x == movement.sourceAttack.x && areaInfo.y == movement.sourceAttack.y)
        if (hit)
            Object.assign(hit, { extraData: movement.sourceAttack.extraData, timeSinceRequest: movement.sourceAttack.timeSinceRequest })

        const shouldUpgradeTower = options.upgradeTowers && getLevel(movement.sourceAttack.extraData[1]) != maxLevel

        if ((options.useTimeSkips || shouldUpgradeTower) &&
            movements.find(movement2 =>
                movement2.kingdomID           == kingdomID               &&
                movement2.sourceAttack.type   == type                    &&
                movement2.sourceAttack.x      == movement.sourceAttack.x &&
                movement2.sourceAttack.y      == movement.sourceAttack.y))
                skipTarget(movement.sourceAttack).catch(e => console.warn(e))
    })

    const buyTools = army.mode == "autofill" && options.autoBuy ? AUTO_BUY_TOOLS[toolSet] : []
    let nextBuyCheckAt = 0
    /**
     * With Auto-buy on, buys the tools the source castle holds fewer of than the minimum, up to the minimum, from the
     * armourer. The check repeats at most every AUTO_BUY_RECHECK_MS, whatever it bought.
     */
    async function restockTools() {
        const minimum = Number(options.autoBuyMin) || 0
        if (!(minimum > 0) || buyTools.length == 0 || Date.now() < nextBuyCheckAt)
            return
        nextBuyCheckAt = Date.now() + AUTO_BUY_RECHECK_MS
        const held = tool => castle.unitInventory.reduce((total, unit) => unit.unitInfo.wodID == tool ? total + unit.amount : total, 0)
        const rows = buyTools.map(tool => ({ tool, keep: minimum, have: held(tool), batch: minimum - held(tool) }))
        const { bought, spent } = await topUp(rows, {
            kingdom: kingdomID, dryRun: Boolean(options.dryRun), coinFloor: Number(options.armourerCoinFloor) || 0, spendCap: Number(options.armourerSpendCap) || 0,
        })
        if (bought > 0) {
            console.info("stormToolsBought", bought, " ", "stormToolsCoins", spent)
            if (!options.dryRun)
                await require("../stock.js").refreshHome().catch(error => console.warn(error))
        }
    }

    const sendHit = async () => {
        const commander = await waitForCommanderAvailable(options.commanderWhiteList)
        const hasShieldMadiens = commander.getEffects(type).AttackSupportUnits
        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < areas.length; i++) {
                    const areaInfo = areas[i]
                    if (!wanted(areaInfo))
                        continue
                    const shouldUpgradeTower = options.upgradeTowers && getLevel(areaInfo.extraData[1]) != maxLevel
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
                    else if (readyAt(areaInfo) - timeSinceEpoch > 0)
                        continue
                    else if (inFlight(areaInfo))
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                const areaInfo = areas[index]
                const level = getLevel(areaInfo.extraData[1])
                const horse = horseFor(areaInfo)
                /** Sends the frame and counts the attack against the kingdom's limits. */
                const sendFrame = async attackInfo => {
                    const sent = await sendAttack(attackInfo, kingdomID, areaInfo.x, areaInfo.y, { level, extraData: areaInfo.extraData })
                    const now = Date.now()
                    sentInDay.add(now)
                    sentInHour.add(now)
                    return { ...sent, tools: toolsIn(attackInfo) }
                }

                if (army.mode == "waves") {
                    const stats = commander.getEffects()
                    const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, undefined, horse, stats.additionalWaves)
                    fillFromPlan(attackInfo, army.waves, castle.unitInventory, {
                        flankUnits: getAmountSoldiersFlank(level, stats.attackUnitAmountFlank), frontUnits: getAmountSoldiersFront(level, stats.attackUnitAmountFront),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard: hasShieldMadiens ? 0 : getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | stats.attackUnitAmountReinforcementBonus),
                    })
                    return await sendFrame(attackInfo)
                }

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerShieldTools = []
                const attackerWallTools = []
                const attackerGateTools = []

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
                        else if (unit.unitInfo.gateBonus)
                            attackerGateTools.push(unit)
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

                if (allTroopCount < troopFloor)
                    throw "NO_MORE_TROOPS"

                attackerWallTools.sort((a, b) =>
                    Number(a.unitInfo.wallBonus) - Number(b.unitInfo.wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a.unitInfo.defRangeBonus) - Number(b.unitInfo.defRangeBonus))

                attackerGateTools.sort((a, b) =>
                    Number(a.unitInfo.gateBonus) - Number(b.unitInfo.gateBonus))
                // The front's second slot takes rams once the tools setting asks for them, and shields while the castle has none.
                const sendRams = useShields && attackerGateTools.some(unit => unit.amount > 0)
                const frontTools = i => i == 0 ? attackerWallTools : i == 1 && sendRams ? attackerGateTools : attackerShieldTools

                const autoConfigure = !(options.attackLeft || options.attackRight || options.attackMiddle)
                const attackLeft = autoConfigure || options.attackLeft
                const attackRight = autoConfigure || options.attackRight
                const attackMiddle = autoConfigure || options.attackMiddle
                const commanderStats = commander.getEffects()
                const attackInfo = getAttackInfo(kingdomID, castle, areaInfo, commander, level, Number(options.attackWaves), horse, commanderStats.additionalWaves)
                const maxTroopFront = getAmountSoldiersFront(level, commanderStats.attackUnitAmountFront)
                const maxTroopFlank = getAmountSoldiersFlank(level, commanderStats.attackUnitAmountFlank)
                const maxToolsFlank = useShields ? getTotalAmountToolsFlank(level, 0) : 10
                // The front always took the flank's room. With rams it takes its own, which is never less, so the shields still fit.
                const maxToolsFront = sendRams ? getTotalAmountToolsFront(level) : maxToolsFlank

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
                        maxTools = maxToolsFront
                        if (attackMiddle) {
                            wave.M.T.forEach((unitSlot, i) =>
                                maxTools -= assignUnit(unitSlot, frontTools(i), Math.min(maxTools, desiredToolCount)))

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

                return await sendFrame(attackInfo)
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            
            if (outOfFeathers)
                reportStatus("running", "statusTowersAttackingNoFeathers", progress())
            else
                reportStatus("running", "statusTowersAttacking", progress())
            console.info(...towerAttackLine(KingdomID[kingdomID], attackInfo.AAM.UM.L.VIS + 1, attackInfo.AAM.M.TA[1], attackInfo.AAM.M.TA[2],
                pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), attackInfo.tools))
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
                    reportStatus("waiting", "statusTowersNoTroops", { castle: from })
                    await new Promise(resolve => {
                        const recheck = setTimeout(done, TROOPS_RECHECK_MS)
                        recheck.unref?.()
                        function done() {
                            clearTimeout(recheck)
                            movementEvents.off("return", home)
                            resolve()
                        }
                        function home(/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) {
                            if (movement.kingdomID == kingdomID && movement.targetAttack.extraData[0] == castle.id)
                                done()
                        }
                        movementEvents.on("return", home)
                    })
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "MISSING_UNITS":
                case "ATTACK_TOO_MANY_UNITS":
                case "CASTLE_LOCKED":
                    return true
                case "ATTACK_LIMIT_REACHED":
                    // The loop's own look at the limits reports it and waits.
                    return false
                case "CANT_START_NEW_ARMIES":
                default:
                    throw e
            }
        }
    }

    await scan()
    while (true) {
        const limit = limitInForce()
        if (limit) {
            reportStatus("waiting", limit.key, { ...limit.params, minutes: minutesTo(limit.until) })
            await sleep(Math.min(Math.max(limit.until - Date.now(), IDLE_MS[0]), IDLE_MS[1]))
            continue
        }
        await restockTools()
        if (await sendHit())
            continue
        // Nothing can be attacked now. The map is read again once the last look is old enough, and never sooner.
        if (Date.now() >= nextScanAt) {
            await scan()
            if (areas.some(areaInfo => !inFlight(areaInfo) && readyAt(areaInfo) <= Date.now()))
                continue
        }
        const nextReady = Math.min(...areas.filter(areaInfo => !inFlight(areaInfo)).map(readyAt))
        if (areas.length == 0)
            reportStatus("waiting", "statusTowersNoneInRange", { castle: from, radius })
        else if (Number.isFinite(nextReady))
            reportStatus("waiting", "statusTowersCooling", { ...progress(), minutes: minutesTo(nextReady) })
        else
            reportStatus("waiting", "statusTowersAllOut", progress())
        const wait = Math.min(nextReady, nextScanAt) - Date.now()
        await sleep(Math.min(Math.max(wait, IDLE_MS[0]), IDLE_MS[1]))
    }
}

module.exports = barronHit