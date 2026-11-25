if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const pretty = require('pretty-time')
const { movements, movementEvents, castles, ClientCommands, AreaType, KingdomID } = require('../../protocols')
const { mapGrid, scanGrid, wholeMapRects } = require('../../mapScan.js')
const { waitToAttack, waitOutDailyLimit, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getTotalAmountToolsFlank, getTotalAmountToolsFront,
    getMaxUnitsInReinforcementWave, sendAttack } = require("./attack")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, playerInfo } = require("../../ggeBot.js")
const { parseAutofill, readArmy, fillFromPlan, orderUnits, eats, choice, HORSES } = require("../../army.js")
const { presetsListed } = require("../../gamePresets.js")
const { statusReporter } = require("../../pluginStatus.js")

const err = require('../../err.json')

const minTroopCount = 100
const minTroopCountCY = 500
const type = AreaType.fortress

/** `filename` is the plugin's file, which its status goes by. */
async function fortressHit(kingdomID, level, options, filename) {
    const horse = choice(HORSES, options.horse, HORSES[2])
    const autofill = parseAutofill(options, { unitOrder: "fastest" })
    const report = statusReporter(filename)
    const army = readArmy(options, report)
    if (!army || !await presetsListed(army, report))
        return

    const areas = []

    const castle = castles.find(e => e.kingdomID == kingdomID && e.areaInfo.type == AreaType.externalKingdom)
    const sendHit = async () => {
        const commander = await waitForCommanderAvailable(options.commanderWhiteList,
            undefined,
            (a, b) => b.getEffects().speedBonus - a.getEffects().speedBonus, filename)
        
        const hasShieldMadiens = commander.getEffects().AttackSupportUnits
        try {
            const attackInfo = await waitToAttack(async () => {
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < areas.length; i++) {
                    const areaInfo = areas[i]

                    if (movements.find(movement =>
                        movement.kingdomID == kingdomID &&
                        movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                        continue

                    if (((areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000) - timeSinceEpoch) > -5000)
                        continue

                    await ClientCommands.preSpyInfo(areaInfo.x, areaInfo.y, kingdomID, false)

                    if (areaInfo.extraData[2] > 0)
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                let AI = areas[index]

                const attackInfo = getAttackInfo(kingdomID, castle, AI, commander, level, undefined, horse)

                if (army.mode == "waves") {
                    fillFromPlan(attackInfo, army.waves, castle.unitInventory, {
                        flankUnits: getAmountSoldiersFlank(level), frontUnits: getAmountSoldiersFront(level),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard: hasShieldMadiens ? 0 : getMaxUnitsInReinforcementWave(playerInfo.level, level),
                    }, { kingdom: kingdomID, areaType: type })
                    return await sendAttack(attackInfo, kingdomID, AI.x, AI.y, { deleteReports: options.deleteReports })
                }

                const attackerTroops = []

                for (let i = 0; i < castle.unitInventory.length; i++) {
                    const unit = castle.unitInventory[i]
                    if (unit.amount <= 0)
                        continue

                    if (unit.unitInfo.fightType == 0 &&
                        unit.unitInfo.beefSupply == undefined &&
                        unit.unitInfo.role &&
                        eats(autofill.supply, unit.unitInfo)
                    ) {
                        if (kingdomID == KingdomID.firePeaks &&
                            unit.unitInfo.wodID == 277 && !hasShieldMadiens)
                            continue

                        attackerTroops.push(unit)
                    }
                }

                orderUnits(attackerTroops, autofill.unitOrder)

                let allTroopCount = 0

                attackerTroops.forEach(e => allTroopCount += e.amount)

                if (allTroopCount < minTroopCount + (hasShieldMadiens ? 0 : minTroopCountCY))
                    throw "NO_MORE_TROOPS"

                attackInfo.A.forEach((wave, i) => {
                    if (i > 2 && kingdomID != KingdomID.firePeaks)
                        return
                    if (i > 4 && kingdomID == KingdomID.firePeaks)
                        return

                    const maxTroopFlank = getAmountSoldiersFlank(level)

                    let maxTroops = maxTroopFlank

                    wave.L.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                })

                if (!hasShieldMadiens) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level)
                    attackInfo.RW.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                }

                return await sendAttack(attackInfo, kingdomID, AI.x, AI.y, { deleteReports: options.deleteReports })
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }

            report("running")
            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', attackInfo.AAM.M.TA[1], ':', attackInfo.AAM.M.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
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
                    await waitOutDailyLimit(report)
                    return true
                default:
                    throw e
            }
        }
    }

    const byDistance = (a, b) =>
        (Math.pow(castle.areaInfo.x - a.x, 2) + Math.pow(castle.areaInfo.y - a.y, 2)) -
        (Math.pow(castle.areaInfo.x - b.x, 2) + Math.pow(castle.areaInfo.y - b.y, 2))

    if (mapGrid) {
        areas.push(...await scanGrid(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, e => e.type == type))
        areas.sort(byDistance)
        while (await sendHit());
    }
    if (areas.length == 0) {
        for (const rect of wholeMapRects(castle.areaInfo.x, castle.areaInfo.y)) {
            areas.push(...(await ClientCommands.getAreaInfo(kingdomID, rect.x, rect.y, rect.w, rect.h)).areaInfo.filter(e => e.type == type))

            areas.sort(byDistance)
            while (await sendHit());
        }
    }

    while (true) {
        let minimumTimeTillHit = Infinity
        areas.forEach(areaInfo => {
            if (movements.find(movement =>
                movement.kingdomID == kingdomID &&
                movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y))
                return
            minimumTimeTillHit = Math.min(minimumTimeTillHit, (areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000))
        })
        const time = (Math.max(0, minimumTimeTillHit - Date.now())) + 5000
        console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
        await new Promise(r => setTimeout(r, time).unref())

        while (await sendHit());
    }
}

module.exports = fortressHit