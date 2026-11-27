if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

const pretty = require('pretty-time')
const { movements, castles, ClientCommands, AreaType, KingdomID } = require('../../protocols')
const { areasAround } = require('../../mapScan.js')
const { waitToAttack, waitForTroops, waitOutDailyLimit, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getTotalAmountToolsFlank, getTotalAmountToolsFront,
    courtyardRoom, sendAttack, openAttackScreen } = require("./attack")
const { waitForCommanderAvailable, freeCommander, commanderRefused } = require("../commander")
const { parseAutofill, readArmy, fillFromPlan, orderUnits, eats, choice, HORSES } = require("../../army.js")
const { presetsListed } = require("../../gamePresets.js")
const { statusReporter } = require("../../pluginStatus.js")
const { pickSourceCastle, castleName } = require("../../towers.js")
const { askTracker } = require("../ggeTracker.js")

const bossDungeons = require("../../paths.js").loadItem("bossdungeons")

const minTroopCount = 100
const minTroopCountCY = 500
const type = AreaType.fortress
/** Fortresses are looked for within this many tiles of the castle, as Lazy Lord does, not over the whole map. */
const SCAN_RADIUS = 50
/** A fortress whose attack screen or attack was refused as not ready is left alone this long. */
const NOT_READY_HOLD_MS = 5 * 60_000
/** With every fortress under attack the plugin looks again after the first; it never sleeps longer than the second. */
const IDLE_RECHECK_MS = [60_000, 10 * 60_000]
/** How often the runner is asked for the timetable again. It reads gge-tracker.com only once a day per kingdom. */
const TIMETABLE_ASK_GAP_MS = 30 * 60_000

/**
 * `fallbackLevel` is the level used when a fortress's map data has none. `filename` is the plugin's file, which its
 * status goes by.
 */
async function fortressHit(kingdomID, fallbackLevel, options, filename) {
    const horse = choice(HORSES, options.horse, HORSES[2])
    const autofill = parseAutofill(options, { unitOrder: "fastest" })
    const report = statusReporter(filename)
    const army = readArmy(options, report)
    if (!army || !await presetsListed(army, report))
        return

    // After this player's own hit a fortress stays closed to them this long (about 5 days), while the map shows
    // everyone only the global cooldown (1 day), so a hit sent on the map's word is refused again and again
    // (Lazy Lord's sharedFortressAttackLogic.js; medium confidence).
    const playerCooldownMs = (Number(bossDungeons.find(b => Number(b.kID) == kingdomID)?.playerCooldownDelay) || 0) * 1000
    // The game client reads a fortress's level from its map data (Lazy Lord; medium confidence).
    const levelOf = areaInfo => Number(areaInfo.extraData[1]) > 0 ? Number(areaInfo.extraData[1]) : fallbackLevel

    let areas = []
    const keyOf = areaInfo => `${areaInfo.x}:${areaInfo.y}`
    /** Fortress -> when this player may hit it again: after their own cooldown, or a refusal's hold. */
    const heldUntil = new Map()
    /** The latest of the game's cooldown as last seen, a hold, and the timetable's time (`availableAt`), which is only a hint. */
    const readyAt = areaInfo => Math.max(areaInfo.timeSinceRequest + areaInfo.extraData[2] * 1000, heldUntil.get(keyOf(areaInfo)) ?? 0, areaInfo.availableAt ?? 0)
    const underAttack = areaInfo => movements.some(movement =>
        movement.kingdomID == kingdomID && movement.targetAttack.x == areaInfo.x && movement.targetAttack.y == areaInfo.y)

    const source = pickSourceCastle(castles, kingdomID, options.sourceCastle, [AreaType.externalKingdom])
    const castle = source.castle
    if (source.fellBack) {
        const from = castleName(castle)
        console.warn("towersSourceCastleGone", from)
        report("running", "statusTowersCastleFallback", { castle: from })
    }

    /** The first fortress that is ready by the bot's data and still ready at a fresh look, or undefined. */
    async function nextTarget() {
        for (const areaInfo of areas) {
            if (underAttack(areaInfo) || readyAt(areaInfo) - Date.now() > -5000)
                continue
            const look = await ClientCommands.preSpyInfo(areaInfo.x, areaInfo.y, kingdomID, false)
            if (look?.areaInfo?.extraData)
                Object.assign(areaInfo, { extraData: look.areaInfo.extraData, timeSinceRequest: look.areaInfo.timeSinceRequest })
            if (areaInfo.extraData[2] > 0)
                continue
            return areaInfo
        }
    }

    const sendHit = async () => {
        const commander = await waitForCommanderAvailable(options.commanderWhiteList,
            undefined,
            (a, b) => b.getEffects(type).speedBonus - a.getEffects(type).speedBonus, filename)

        let target
        try {
            const attackInfo = await waitToAttack(async () => {
                target = await nextTarget()
                if (!target)
                    return
                const lord = await openAttackScreen(castle, target, kingdomID, commander)
                const effects = lord.getEffects(type)
                const hasShieldMadiens = effects.AttackSupportUnits
                const level = levelOf(target)
                const attackInfo = getAttackInfo(kingdomID, castle, target, lord, level, undefined, horse, effects.additionalWaves)
                const flankUnits = getAmountSoldiersFlank(level, effects.attackUnitAmountFlank)
                const courtyard = hasShieldMadiens ? 0 : courtyardRoom(level, effects)

                if (army.mode == "waves") {
                    fillFromPlan(attackInfo, army.waves, castle.unitInventory, {
                        flankUnits, frontUnits: getAmountSoldiersFront(level, effects.attackUnitAmountFront),
                        flankTools: getTotalAmountToolsFlank(level, 0), frontTools: getTotalAmountToolsFront(level),
                        courtyard,
                    }, { kingdom: kingdomID, areaType: type })
                    return await sendAttack(attackInfo, kingdomID, target.x, target.y, { deleteReports: options.deleteReports })
                }

                const attackerTroops = castle.unitInventory.filter(unit => unit.amount > 0 &&
                    unit.unitInfo.fightType == 0 &&
                    unit.unitInfo.beefSupply == undefined &&
                    unit.unitInfo.role &&
                    eats(autofill.supply, unit.unitInfo) &&
                    !(kingdomID == KingdomID.firePeaks && unit.unitInfo.wodID == 277 && !hasShieldMadiens))

                orderUnits(attackerTroops, autofill.unitOrder)

                const allTroopCount = attackerTroops.reduce((total, unit) => total + unit.amount, 0)
                if (allTroopCount < minTroopCount + (hasShieldMadiens ? 0 : minTroopCountCY))
                    throw "NO_MORE_TROOPS"

                attackInfo.A.forEach((wave, i) => {
                    if (i > 2 && kingdomID != KingdomID.firePeaks)
                        return
                    if (i > 4 && kingdomID == KingdomID.firePeaks)
                        return

                    let maxTroops = flankUnits
                    wave.L.U.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                })

                if (!hasShieldMadiens) {
                    let maxTroops = courtyard
                    attackInfo.RW.forEach(unitSlot =>
                        maxTroops -= assignUnit(unitSlot, attackerTroops, maxTroops))
                }

                return await sendAttack(attackInfo, kingdomID, target.x, target.y, { deleteReports: options.deleteReports })
            }, filename)

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }

            const march = attackInfo.AAM.M
            if (playerCooldownMs > 0)
                heldUntil.set(keyOf(target), Date.now() + Math.max(0, Number(march.TT) - Number(march.PT) || 0) * 1000 + playerCooldownMs)
            report("running")
            console.info("hittingTargetAttack", KingdomID[kingdomID], ' ', 'C', attackInfo.AAM.UM.L.VIS + 1, ' ', march.TA[1], ':', march.TA[2], " ", pretty(Math.round(1000000000 * Math.abs(Math.max(0, march.TT - march.PT))), 's'), "tillImpactAttack")
            return true
        } catch (e) {
            e == "LORD_IS_USED" ? commanderRefused(commander.lordID) : freeCommander(commander.lordID)
            if (target && (e == "COOLING_DOWN" || e == "ATTACK_SCREEN_REFUSED"))
                heldUntil.set(keyOf(target), Date.now() + NOT_READY_HOLD_MS)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await waitForTroops(movement => movement.kingdomID == kingdomID && movement.targetAttack.extraData[0] == castle.id)
                    return true
                case "LORD_IS_USED":
                case "ATTACK_SCREEN_REFUSED":
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

    /**
     * Where the fortresses come from: the gge-tracker.com timetable when the player opted in and the runner has it, else
     * the map around the castle. A fortress already known keeps the game's data on it and takes the timetable's time.
     */
    let listFrom
    let askedAt = 0
    async function findFortresses() {
        askedAt = Date.now()
        const timetable = await askTracker({ kind: "fortresses", kingdom: kingdomID })
        if (timetable.ok) {
            const known = new Map(areas.map(areaInfo => [keyOf(areaInfo), areaInfo]))
            const listed = timetable.fortresses.map(fortress => Object.assign(
                known.get(keyOf(fortress)) ?? { type, x: fortress.x, y: fortress.y, extraData: [0, 0, 0], timeSinceRequest: 0 },
                { availableAt: fortress.availableAt }))
            const listedKeys = new Set(listed.map(keyOf))
            areas = listed.concat(areas.filter(areaInfo => !listedKeys.has(keyOf(areaInfo)) && underAttack(areaInfo)))
            if (listFrom != "timetable")
                console.info("fortressTimetableUsed", KingdomID[kingdomID], ' ', listed.length)
            listFrom = "timetable"
        } else if (listFrom != "map") {
            if (timetable.error != "off")
                console.info("fortressTimetableUnavailable", KingdomID[kingdomID], ' ', timetable.error)
            areas = await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, e => e.type == type, { radius: SCAN_RADIUS })
            listFrom = "map"
        }
        areas.sort(byDistance)
    }

    await findFortresses()
    while (await sendHit());

    while (true) {
        if (Date.now() - askedAt >= TIMETABLE_ASK_GAP_MS)
            await findFortresses()
        let minimumTimeTillHit = Infinity
        for (const areaInfo of areas)
            if (!underAttack(areaInfo))
                minimumTimeTillHit = Math.min(minimumTimeTillHit, readyAt(areaInfo))
        const time = minimumTimeTillHit == Infinity ? IDLE_RECHECK_MS[0] : Math.min(Math.max(0, minimumTimeTillHit - Date.now()) + 5000, IDLE_RECHECK_MS[1])
        console.info("waitingForNextPossibleHit", Math.round(time / 1000), "waitingForNextPossibleHit2")
        await new Promise(r => setTimeout(r, time).unref())

        while (await sendHit());
    }
}

module.exports = fortressHit
