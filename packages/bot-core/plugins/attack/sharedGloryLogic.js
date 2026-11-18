/**
 * The attack loop for glory events whose camps are alliance invasion camps, such as Foreign Lords (event 71) and
 * Bloodcrows (event 103). A plugin passes its event; see docs/protocol/invasions.md, banners.md and dethrone.md.
 */
const DIFFICULTIES = [
    "Highest unlocked without rubies",
    "Easy", "Easy+", "Intermediate", "Intermediate+",
    "Hard (rented with rubies)", "Hard+ (rented with rubies)", "Expert (rented with rubies)", "Expert+ (rented with rubies)",
    "Master (rented with rubies)", "Master+ (rented with rubies)", "Archmaster (rented with rubies)",
]

const { unitOrderOption, parseAutofill, orderUnits, HORSES } = require("../../army.js")

const gloryOptions = [
    { type: "Select", key: "gloryDifficulty", selection: DIFFICULTIES, default: 0 },
    { type: "Number", key: "scoreShutoff", min: 0, max: 100_000_000, step: 1, default: 0 },
    { type: "Number", key: "stopMinutesBefore", min: 0, max: 240, step: 5, unit: "minutes", default: 30 },
    { type: "Text", key: "commanderWhiteList", default: "1-99" },
    { type: "Select", key: "horse", selection: ["No horse", "Coin horse", "Feather"], default: 0 },
    { type: "Number", key: "minTroopsHome", min: 0, max: 1_000_000, step: 1, unit: "troops", default: 0, advanced: true },
    { type: "Number", key: "toolWaves", min: 1, max: 4, step: 1, default: 2, advanced: true },
    { type: "Select", key: "waveTemplate", selection: ["Wall, gate and moat", "Wall, gate and mantlet"], default: 0, advanced: true },
    { type: "Select", key: "soldiers", selection: ["All", "Food only", "Mead only"], default: 0, advanced: true },
    unitOrderOption(),
    { type: "Number", key: "bannersPerAttack", min: 0, max: 1000, step: 1, default: 0, advanced: true },
    { type: "Select", key: "bannerOrder", selection: ["In the order of the list below", "Highest bonus first", "Lowest bonus first"], default: 2, advanced: true },
    { type: "OrderedList", key: "bannerList", catalog: "banners", default: [], advanced: true },
    { type: "OrderedList", key: "supportTools", catalog: "supportTools", default: [], advanced: true },
    { type: "Checkbox", key: "courtyardWave", default: true, advanced: true },
    { type: "Select", key: "dethrone", selection: ["Off", "Exile, paid in coins", "Fortify, paid in rubies"], default: 0, advanced: true },
    { type: "Number", key: "dethroneMaxEach", min: 0, max: 1_000_000_000, step: 1, default: 0, advanced: true },
    { type: "Number", key: "dethroneMaxTotal", min: 0, max: 2_000_000_000, step: 1, default: 0, advanced: true },
    { type: "Number", key: "dethroneKeep", min: 0, max: 2_000_000_000, step: 1, default: 0, advanced: true },
    { type: "Checkbox", key: "attackUnderProtection", default: false, advanced: true },
    { type: "Checkbox", key: "dryRun", default: false, advanced: true },
]
const gloryChecks = [{ type: "commanders", option: "commanderWhiteList" }, { type: "dailyAttacks" }]

if (require("node:worker_threads").isMainThread)
    return module.exports = { hidden: true, gloryOptions, gloryChecks }

const path = require("node:path")
const pretty = require("pretty-time")
const err = require("../../err.json")
const { castles, movements, movementEvents, AreaType, KingdomID, ClientCommands } = require("../../protocols.js")
const { waitToAttack, getAttackInfo, assignUnit, fillEventTools, sendAttack, getTotalAmountToolsFlank, getTotalAmountToolsFront,
    getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack.js")
const { waitForCommanderAvailable, freeCommander, useCommander } = require("../commander.js")
const { areasAround } = require("../../mapScan.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../../ggeBot.js")
const { statusReporter } = require("../../pluginStatus.js")
const { loadItem } = require("../../paths.js")

const difficultyRows = loadItem("eventAutoScalingDifficulties")
const dethroneCosts = loadItem("rerollCosts").filter(row => row.type == "alien").sort((a, b) => a.rerollCount - b.rerollCount)

const kingdomID = KingdomID.greatEmpire
/** `fnm` finds Foreign Lords and Bloodcrow camps under this owner id (BASIC_INVASION_CAMP_PLAYER_ID). */
const INVASION_CAMP_OWNER = -701
const MIN_TROOPS = 100
const DETHRONE_MIN_LEVEL = 70
const NO_CAMPS_RETRY_MS = 10 * 60 * 1000
const PROTECTION_RETRY_MS = 30 * 60 * 1000
const ATTACK_LIMIT_RETRY_MS = 30 * 60 * 1000
/** `uap` peace mode statuses that protect the account: before the peace starts, and during it. */
const PEACE_PROTECTS = [0, 1]

const DEFAULTS = Object.fromEntries(gloryOptions.map(def => [def.key, def.default]))
const SOLDIERS = [() => true, info => info.foodSupply, info => info.meadSupply]
const BANNER_ORDERS = ["listed", "highest", "lowest"]
const SIEGE_BONUS = { wall: "wallBonus", gate: "gateBonus", moat: "moatBonus", mantlet: "defRangeBonus" }
/** The siege tool each tool slot of a side takes, by wave template. A side has as many slots as the camp level opens. */
const TEMPLATES = [
    { flank: ["wall", "moat"], front: ["wall", "gate", "moat"] },
    { flank: ["wall", "mantlet"], front: ["wall", "gate", "mantlet"] },
]
/**
 * How each dethrone pays. The cost is the `rerollCosts` row at the player's dethrone count so far, capped at
 * `lastRow` (the client's own cap). The Fortify cap of 20 is one past the table, so that cost is unknown.
 */
const DETHRONES = [
    undefined,
    { rck: "C1", purse: "coin", count: "RCSC", lastRow: 19, cost: row => Number(row.c1Cost), currency: "gloryCoins" },
    { rck: "C2", purse: "rubies", count: "RCHC", lastRow: 20, cost: row => Number(row.c2Cost), currency: "gloryRubies" },
]

const rentCost = row => row.isLocked == "1" ? Number(row.rentC2Cost) : 0
const distance = (from, to) => (from.x - to.x) ** 2 + (from.y - to.y) ** 2
const totalOf = units => units.reduce((n, unit) => n + unit.amount, 0)
const firstWithAny = (...pools) => pools.find(pool => pool.some(unit => unit.amount > 0)) ?? []

/**
 * Farms one glory event while it runs. `event` is `{ eventID, areaType, difficultyIDs: [first, last] }`; the plugin's
 * settings and status go by the plugin file's name.
 */
module.exports = function farmGlory(filename, { eventID, areaType, difficultyIDs: [firstDifficulty, lastDifficulty] }) {
    const plugin = path.basename(filename, ".js")
    const pluginOptions = botConfig.plugins[plugin] ?? {}
    const setting = key => pluginOptions[key] ?? DEFAULTS[key]
    const autofill = parseAutofill(pluginOptions)
    const reportStatus = statusReporter(filename)
    const usableHere = info =>
        (!info.usageEventID || String(info.usageEventID).split(",").includes(String(eventID))) &&
        (!info.allowedToAttack || String(info.allowedToAttack).split("#").includes(`${kingdomID}+${areaType}`))
    const openCamp = area => area?.type == areaType && area.extraData.length > 1 && area.extraData[2] != 1

    /** @type {{ stopped: boolean, halted: Promise<void>, halt: () => void, endsAt: number, counts: object, spent: number, dethroneAllowed: boolean, considered: Set<string> }} */
    let run

    const stop = (target, state, reasonKey, params) => {
        if (target.stopped)
            return
        target.stopped = true
        target.halt()
        reportStatus(state, reasonKey, params)
    }
    const wait = (target, ms) => Promise.race([target.halted, new Promise(resolve => setTimeout(resolve, ms).unref?.())])

    const scoreTarget = () => Number(setting("scoreShutoff")) || Infinity
    xtHandler.on("pep", obj => {
        if (obj.EID != eventID)
            return
        const points = Number(obj.OP?.[0])
        console.log("gloryEventPoints", points)
        if (run && !run.stopped && points >= scoreTarget()) {
            console.log("gloryScoreReached", points)
            stop(run, "stopped", "statusScoreReached", { score: points })
        }
    })

    events.on("eventStop", eventInfo => {
        if (eventInfo.EID != eventID)
            return
        if (run) {
            run.stopped = true
            run.halt()
        }
        run = undefined
        reportStatus("waiting", "statusEventClosed")
    })

    events.on("eventStart", eventInfo => {
        if (eventInfo.EID != eventID)
            return
        let halt
        const current = run = {
            stopped: false, halted: new Promise(resolve => halt = resolve), halt,
            endsAt: Number(eventInfo.RS) > 0 ? Date.now() + Number(eventInfo.RS) * 1000 : Infinity,
            counts: { RCSC: Number(eventInfo.RCSC) || 0, RCHC: Number(eventInfo.RCHC) || 0 },
            spent: 0,
            dethroneAllowed: eventInfo.CRE == 1 && eventInfo.RCKS?.length > 0,
            considered: new Set(),
        }
        farm(current, eventInfo).catch(e => {
            console.error(e)
            stop(current, "error", "statusAttacksStopped")
        })
    })

    reportStatus("waiting", "statusEventClosed")

    /** Picks the difficulty when the event has none yet. Returns false when it stopped the run instead. */
    async function chooseDifficulty(target, eventInfo) {
        const chosen = Number(eventInfo.EDID)
        if (chosen >= firstDifficulty && chosen <= lastDifficulty)
            return true

        const tiers = difficultyRows
            .filter(row => row.eventID == eventID && row.difficultyID >= firstDifficulty && row.difficultyID <= lastDifficulty)
            .sort((a, b) => a.difficultyTypeID - b.difficultyTypeID)
        const wanted = Number(setting("gloryDifficulty"))
        const tier = wanted == 0 ? tiers.findLast(row => rentCost(row) == 0) : tiers.find(row => row.difficultyTypeID == wanted)
        if (!tier) {
            console.error("gloryDifficultyUnknown")
            stop(target, "error", "statusDifficultyUnknown")
            return false
        }
        const rent = rentCost(tier)
        if (rent > 0 && !(playerInfo.rubies >= rent)) {
            console.warn("gloryRentTooExpensive", rent)
            stop(target, "stopped", "statusRentTooExpensive", { cost: rent })
            return false
        }
        if (rent > 0)
            console.log("gloryRentDifficulty", rent)
        console.log("gloryDifficultyChosen", tier.difficultyTypeID)
        const reply = waitForResult("sede", 1000 * 10)
        await sendXT("sede", JSON.stringify({ EID: eventID, EDID: Number(tier.difficultyID), C2U: rent > 0 ? 1 : 0 }))
        await reply
        return true
    }

    /** Asks for the event score; the `pep` handler above reads the reply. */
    async function readPoints() {
        const reply = waitForResult("pep", 1000 * 10, obj => obj.EID == eventID)
        await sendXT("pep", JSON.stringify({ EID: eventID }))
        await reply.catch(() => {})
    }

    /** Whether the account has beginner protection in the Great Empire, or peace protection. An unanswered check counts as protected. */
    async function isProtected() {
        const reply = waitForResult("uap", 1000 * 10, obj => obj.KID == kingdomID)
        await sendXT("uap", JSON.stringify({ KID: kingdomID }))
        try {
            const [protection] = await reply
            return Number(protection.NS) > 0 || (Number(protection.PMT) > 0 && PEACE_PROTECTS.includes(Number(protection.PMS)))
        } catch {
            return true
        }
    }

    async function findCamps(castle) {
        const camps = (await areasAround(ClientCommands.getAreaInfo, kingdomID, castle.areaInfo, area => area.type == areaType)).filter(openCamp)
        if (camps.length == 0) {
            const { areaInfo } = await ClientCommands.getNextMapObject(areaType, kingdomID, INVASION_CAMP_OWNER)
            if (openCamp(areaInfo))
                camps.push(areaInfo)
        }
        return camps.sort((a, b) => distance(castle.areaInfo, a) - distance(castle.areaInfo, b))
    }

    /** The reason a dethrone at `cost` is refused, or undefined when every cap allows it. */
    function dethroneRefusal(cost, balance, spent) {
        const each = Number(setting("dethroneMaxEach")), total = Number(setting("dethroneMaxTotal")), keep = Number(setting("dethroneKeep"))
        if (!(cost > 0))
            return ["gloryDethroneCostUnknown"]
        if (!(each > 0 && total > 0))
            return ["gloryDethroneNoCap"]
        if (cost > each)
            return ["gloryDethroneOverEach", cost]
        if (spent + cost > total)
            return ["gloryDethroneOverTotal", spent + cost]
        if (!(balance - cost >= keep))
            return ["gloryDethroneReserve", cost]
    }

    /** Dethrones a camp once, before its first attack, when the settings and every cap allow it. */
    async function maybeDethrone(target, camp) {
        const mode = DETHRONES[Number(setting("dethrone"))]
        const key = `${camp.x}:${camp.y}`
        if (!mode || !target.dethroneAllowed || camp.extraData[6] == 1 || target.considered.has(key) || !(playerInfo.level >= DETHRONE_MIN_LEVEL))
            return
        // The client offers no dethrone while one of our armies is on its way to the camp.
        if (movements.some(m => m.kingdomID == kingdomID && m.targetAttack?.x == camp.x && m.targetAttack?.y == camp.y))
            return
        target.considered.add(key)

        const row = dethroneCosts[Math.min(target.counts[mode.count], mode.lastRow)]
        const cost = row ? mode.cost(row) : NaN
        const refusal = dethroneRefusal(cost, Number(playerInfo[mode.purse]), target.spent)
        if (refusal) {
            console.log("gloryDethroneRefused", key, " ", ...refusal)
            return
        }
        console.log("gloryDethroneCost", key, " ", cost, mode.currency)
        const request = { XPOS: camp.x, YPOS: camp.y, RCK: mode.rck }
        if (setting("dryRun")) {
            console.log("dryRunDethrone", JSON.stringify(request))
            return
        }
        const reply = waitForResult("rae", 1000 * 10)
        await sendXT("rae", JSON.stringify(request))
        const [, result] = await reply
        if (result != 0) {
            console.warn("gloryDethroneFailed", err[result] ?? result)
            return
        }
        target.spent += cost
        target.counts[mode.count]++
        playerInfo[mode.purse] -= cost
        camp.extraData[6] = 1
    }

    /** Builds the `cra` for `camp` from the castle's units, taking what it sends out of `inventory`. */
    function buildAttack(castle, camp, commander, inventory) {
        const level = Number(camp.extraData[0])
        const effects = commander.getEffects()
        const units = inventory.filter(unit => unit.amount > 0 && usableHere(unit.unitInfo))
        const soldierWanted = SOLDIERS[Number(setting("soldiers"))]
        const isSoldier = info => ["melee", "ranged"].includes(info.role) && info.fightType == 0 && !info.beefSupply && info.wodID != 277 && soldierWanted(info)
        const meleeTroops = units.filter(unit => isSoldier(unit.unitInfo) && unit.unitInfo.role == "melee")
        const rangedTroops = units.filter(unit => isSoldier(unit.unitInfo) && unit.unitInfo.role == "ranged")
        orderUnits(meleeTroops, autofill.unitOrder)
        orderUnits(rangedTroops, autofill.unitOrder)

        let budget = totalOf(meleeTroops) + totalOf(rangedTroops) - Number(setting("minTroopsHome"))
        if (budget < MIN_TROOPS)
            throw "NO_MORE_TROOPS"

        // Tools made for these camps go first, then the weakest of the rest.
        const siege = Object.fromEntries(Object.entries(SIEGE_BONUS).map(([role, field]) => [role, units
            .filter(unit => unit.unitInfo.typ == "Attack" && unit.unitInfo.toolCategory && !unit.unitInfo.khanTabletBooster && Number(unit.unitInfo[field]) > 0)
            .sort((a, b) => Number(!!b.unitInfo.allowedToAttack) - Number(!!a.unitInfo.allowedToAttack) || a.unitInfo[field] - b.unitInfo[field])]))

        const supportTools = setting("supportTools")
            .map(wodID => inventory.find(unit => unit.unitInfo.wodID == wodID && unit.amount > 0))
            .filter(Boolean).slice(0, 3)
        supportTools.forEach(unit => unit.amount--)

        const attackInfo = getAttackInfo(kingdomID, castle, camp, commander, level, undefined, HORSES[Number(setting("horse"))] ?? {},
            effects.additionalWaves, { supportTools: supportTools.map(unit => unit.unitInfo.wodID) })
        const maxTools = { flank: getTotalAmountToolsFlank(level, 0), front: getTotalAmountToolsFront(level) }
        const template = TEMPLATES[Number(setting("waveTemplate"))] ?? TEMPLATES[0]
        const toolWaves = Number(setting("toolWaves"))

        const fillSiege = (slots, roles, room) => slots.forEach((slot, i) =>
            room -= assignUnit(slot, siege[roles[i]], Math.ceil(room / (slots.length - i))))
        const fillSoldiers = (slots, pools, room) => slots.forEach(slot => {
            const sent = assignUnit(slot, firstWithAny(...pools), Math.min(room, budget))
            room -= sent
            budget -= sent
        })

        attackInfo.A.forEach((wave, i) => {
            if (i < toolWaves) {
                fillSiege(wave.L.T, template.flank, maxTools.flank)
                fillSiege(wave.R.T, template.flank, maxTools.flank)
                fillSiege(wave.M.T, template.front, maxTools.front)
            }
            const flank = getAmountSoldiersFlank(level, effects.attackUnitAmountFlank)
            fillSoldiers(wave.L.U, [meleeTroops, rangedTroops], flank)
            fillSoldiers(wave.R.U, [meleeTroops, rangedTroops], flank)
            fillSoldiers(wave.M.U, [rangedTroops, meleeTroops], getAmountSoldiersFront(level, effects.attackUnitAmountFront))
        })

        const banners = fillEventTools(attackInfo.A.slice(toolWaves), units, {
            maxTools,
            maxPerAttack: Number(setting("bannersPerAttack")) || Infinity,
            order: BANNER_ORDERS[Number(setting("bannerOrder"))] ?? "lowest",
            list: setting("bannerList")?.length ? setting("bannerList") : undefined,
        })
        console.log("gloryBannersUsed", banners)

        if (setting("courtyardWave")) {
            let room = getMaxUnitsInReinforcementWave(playerInfo.level, level) + Number(0 | effects.attackUnitAmountReinforcementBonus)
            attackInfo.RW.forEach((slot, i) => {
                const sent = assignUnit(slot, i & 1 ? firstWithAny(meleeTroops, rangedTroops) : firstWithAny(rangedTroops, meleeTroops),
                    Math.min(Math.ceil(room / (attackInfo.RW.length - i)), budget))
                room -= sent
                budget -= sent
            })
        }
        return { attackInfo, level }
    }

    /** Waits out the account's protection unless the player allowed attacking under it. Returns false once the run stopped. */
    async function waitOutProtection(target) {
        if (setting("attackUnderProtection"))
            return true
        while (!target.stopped && await isProtected()) {
            console.warn("gloryProtected")
            reportStatus("waiting", "statusProtected")
            await wait(target, PROTECTION_RETRY_MS)
        }
        return !target.stopped
    }

    const pastStopTime = target => Date.now() >= target.endsAt - Number(setting("stopMinutesBefore")) * 60 * 1000

    async function farm(target, eventInfo) {
        if (!await chooseDifficulty(target, eventInfo))
            return
        await readPoints()
        if (target.stopped || !await waitOutProtection(target))
            return

        const castle = castles.find(c => c.kingdomID == kingdomID && c.areaInfo.type == AreaType.mainCastle)
        let camps = await findCamps(castle)
        while (camps.length == 0 && !target.stopped) {
            console.warn("gloryNoCamps")
            reportStatus("waiting", "statusNoCamps")
            await wait(target, NO_CAMPS_RETRY_MS)
            camps = await findCamps(castle)
        }
        while (!target.stopped) {
            reportStatus("running")
            const commander = await waitForCommanderAvailable(setting("commanderWhiteList"))
            if (target.stopped || pastStopTime(target)) {
                freeCommander(commander.lordID)
                if (!target.stopped) {
                    console.log("gloryStopBeforeEnd")
                    stop(target, "stopped", "statusStopBeforeEnd", { minutes: Number(setting("stopMinutesBefore")) })
                }
                break
            }
            try {
                const sent = await waitToAttack(async () => {
                    const camp = camps.shift()
                    camps.push(camp)
                    console.log("gloryTargetFound", `${camp.x}:${camp.y}`)
                    await maybeDethrone(target, camp)
                    const dryRun = Boolean(setting("dryRun"))
                    const inventory = dryRun ? castle.unitInventory.map(unit => ({ ...unit })) : castle.unitInventory
                    const { attackInfo, level } = buildAttack(castle, camp, commander, inventory)
                    return await sendAttack(attackInfo, kingdomID, camp.x, camp.y, { level, extraData: camp.extraData, dryRun })
                })
                if (!sent || sent.dryRun) {
                    freeCommander(commander.lordID)
                    continue
                }
                console.info("gloryAttackSent", `${sent.AAM.M.TA[1]}:${sent.AAM.M.TA[2]}`, " ",
                    pretty(Math.round(1000000000 * Math.abs(Math.max(0, sent.AAM.M.TT - sent.AAM.M.PT))), "s"), "tillImpactAttack")
            } catch (e) {
                freeCommander(commander.lordID)
                switch (e) {
                    case "NO_MORE_TROOPS":
                        console.warn(e)
                        await Promise.race([target.halted, new Promise(resolve => movementEvents.on("return", function self(movement) {
                            if (movement.kingdomID != kingdomID || movement.targetAttack.extraData[0] != castle.id)
                                return
                            movementEvents.off("return", self)
                            resolve()
                        }))])
                        break
                    case "LORD_IS_USED":
                        useCommander(commander.lordID)
                        break
                    case "COOLING_DOWN":
                    case "TIMED_OUT":
                    case "MISSING_UNITS":
                    case "CASTLE_LOCKED":
                    case "CANT_START_NEW_ARMIES":
                        console.warn(e)
                        break
                    case "ATTACK_LIMIT_REACHED":
                        reportStatus("waiting", "statusDailyLimitWaiting")
                        await wait(target, ATTACK_LIMIT_RETRY_MS)
                        break
                    default:
                        console.error(e)
                        stop(target, "error", "statusAttacksStopped")
                }
            }
        }
    }
}
