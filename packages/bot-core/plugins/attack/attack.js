if (require('node:worker_threads').isMainThread) {
    return module.exports = {
        force: true,
        pluginOptions: [
            {
                type: "Text",
                key: "attackDelaySeconds",
                default: "4.5",
                min: 3,
                max: 600
            },
            {
                type: "Text",
                key: "attackDelayRandomizationSeconds",
                default: "2.5",
                min: 1,
                max: 600
            },
            {
                type: "Text",
                key: "attackLimit",
                default: "3500",
                min: 1,
                max: 4000
            }
        ]
    }
}

const { RateLimiter } = require('limiter')
const { resources } = require('../../protocols')
const { botConfig, playerInfo, xtHandler, sendXT, waitForResult } = require('../../ggeBot')
const { isCastleLocked } = require("../../castleLock.js")
const stables = require("../../paths.js").loadItem("horses")

const getTotalAmountTools = (e, t, n) =>
    1 === e ? t < 11 ? 10 :
        t < 37 ? 20 :
            t < 50 ? 30 :
                t < 69 ? 40 : 50 : //TODO: WTF
        t < 37 ? 10 :
            t < 50 ? 20 :
                t < 69 ? 30 : 0 | Math.ceil(40 + n)

const getTotalAmountToolsFlank = (e, t) => getTotalAmountTools(0, e, 0 | t)
const getTotalAmountToolsFront = e => getTotalAmountTools(1, e, 0)

const getMaxAttackers = targetLevel =>
    targetLevel <= 69 ? Math.min(260, 5 * targetLevel + 8) : 320
const getAmountSoldiersFlank = (level, multiplier) => 
    Math.ceil(.2 * getMaxAttackers(level) * (1 + (0 | multiplier) / 100))
const getAmountSoldiersFront = (level, multiplier) => 
    Math.ceil((getMaxAttackers(level) - 2 * getAmountSoldiersFlank(level)) * (1 + (0 | multiplier) / 100))
const getMaxUnitsInReinforcementWave = (playerLevel, targetLevel, additionalUnits, additionalUnitsMultiplyer) =>
    Math.round((20 * Math.sqrt(Math.min(playerLevel, 70)) + 50 + 20 * targetLevel + (0 | additionalUnits)) * 
        (1 + (0 | additionalUnitsMultiplyer) / 100))

function getMaxWaveCount(e) {
    const waveUnlockLevelList = [0, 13, 26, 51]
    let n = 1
    for (let i = waveUnlockLevelList.length - 1; i >= 0; i--) {
        if (e < waveUnlockLevelList[i])
            continue
        n = i + 1
        break
    }
    return n
}

function assignUnit(unitSlot, units, maxUnits) {
    let unit = units.find(e => e.amount > 0)
    if (!unit)
        return 0

    const unitAmount = Math.floor(Math.max(Math.min(unit.amount, maxUnits), 0))

    unit.amount -= unitAmount

    if (unit.amount <= 0)
        units.shift()

    if (unitAmount > 0) {
        unitSlot[0] = unit.unitInfo.wodID
        unitSlot[1] = unitAmount
    }

    return unitAmount
}

const fitsSide = (unit, side) =>
    unit.unitInfo.slotTypes?.split(",").includes(side == "M" ? "1" : "2") ?? true

/**
 * Places event tools, such as glory or rage banners, in the free tool slots of
 * `waves`: the left flank, the right flank and then the front of each wave in
 * turn. A side takes tools up to its `maxTools` limit, counting the tools
 * already in it, and only tools whose `slotTypes` allow it (1 front, 2 flank).
 * Placed tools are taken out of `owned`.
 *
 * `order` "listed" follows `list` (wodIDs) when given, else the order of
 * `owned`. "highest" and "lowest" sort by `bonusField`.
 * @returns {Number} how many tools it placed
 */
function fillEventTools(waves, owned, { maxTools, maxPerAttack = Infinity, order = "listed", list, bonusField = "fameBonus" }) {
    const bonus = unit => Number(unit.unitInfo[bonusField])
    let tools = owned.filter(unit => bonus(unit) > 0)
    if (order == "listed" && list)
        tools = list.flatMap(wodID => tools.filter(unit => unit.unitInfo.wodID == wodID))
    else if (order == "highest")
        tools.sort((a, b) => bonus(b) - bonus(a))
    else if (order == "lowest")
        tools.sort((a, b) => bonus(a) - bonus(b))

    let placed = 0
    for (const wave of waves)
        for (const side of ["L", "R", "M"]) {
            const fitting = tools.filter(unit => fitsSide(unit, side))
            let room = (side == "M" ? maxTools.front : maxTools.flank) - wave[side].T.reduce((total, [, amount]) => total + amount, 0)
            for (const slot of wave[side].T) {
                if (slot[0] != -1)
                    continue
                const amount = assignUnit(slot, fitting, Math.min(room, maxPerAttack - placed))
                room -= amount
                placed += amount
            }
        }
    return placed
}

const SUPPORT_TOOL_SLOTS = 3
const COURTYARD_SLOTS = 8

/**
 * Builds the `cra` for one attack with empty wave slots for the plugin to fill.
 * `supportTools` are up to 3 offence support tool wodIDs for `AST`, and
 * `courtyard` is up to 8 `[wodID, amount]` slots for the courtyard wave `RW`.
 */
function getAttackInfo(kid, castle, AI, commander, level, waves, options, additionalWaves, { supportTools = [], courtyard = [] } = {}) {
    const attackTarget = {
        SX: castle.areaInfo.x,
        SY: castle.areaInfo.y,
        TX: AI.x,
        TY: AI.y,
        KID: kid,
        LID: commander.lordID,
        WT: 0,
        HBW: -1,
        BPC: 0,
        ATT: 0,
        AV: 0,
        LP: 0,
        FC: 0,
        PTT: 0,
        SD: 0,
        ICA: 0,
        CD: 99,
        A: [],
        BKS: [],
        AST: Array.from({ length: SUPPORT_TOOL_SLOTS }, (_, i) => supportTools[i] ?? -1),
        RW: Array.from({ length: COURTYARD_SLOTS }, (_, i) => [...courtyard[i] ?? [-1, 0]]),
        ASCT: 0
    }

    if (isNaN(waves) || waves <= 0)
        waves = Infinity

    waves = Math.max(Math.min(waves, getMaxWaveCount(playerInfo.level) + (0 | additionalWaves)), 1)

    for (let i = 0; i < waves; i++) {
        const wave = {
            L: {
                T: [],
                U: []
            },
            R: {
                T: [],
                U: []
            },
            M: {
                T: [],
                U: []
            }
        }
        const setupWave = (wallLevelRequirement, row) =>
            wallLevelRequirement.every(e =>
                e <= level ? row.push([-1, 0]) : false)

        setupWave([0, 37], wave.L.T)
        setupWave([0, 13], wave.L.U)
        setupWave([0, 11, 37], wave.M.T)
        setupWave([0, 0, 13, 13, 26, 26], wave.M.U)
        setupWave([0, 37], wave.R.T)
        setupWave([0, 13], wave.R.U)
        attackTarget.A.push(wave)
    }
    const unlockedHorses = castle.unlockedHorses

    if (options.useCoin && !options.useFeather) {
        let bestHorse = -1
        let maxSpeed = -Infinity

        unlockedHorses?.forEach(e => {
            let horse = stables.find(a => e == a.wodID)
            if (horse && Number(horse.costFactorC1) > 0 && Number(horse.costFactorC2) == 0) {
                 if (Number(horse.unitBoost) > maxSpeed) {
                    maxSpeed = Number(horse.unitBoost)
                    bestHorse = e
                }
            }
        })
        
        if (bestHorse != -1) {
            attackTarget.HBW = bestHorse
            attackTarget.PTT = 0
        } else {
            console.debug("noStablesCoinHorse")
            attackTarget.HBW = -1
            attackTarget.PTT = 0
        }
    }
    else {
        attackTarget.HBW = -1
        if(resources.pegasusTicket > 0) {
            attackTarget.PTT = options.useFeather ? 1 : 0
        } else {
            console.warn("outOfFeathers")
            attackTarget.PTT = 0
        }
    }
    
    return attackTarget
}

const metrics = require("../../metrics.js")
const { boxMullerRandom, sleep, pause } = require("../../pacing.js")
const { lognormalDelay } = require("../../timing.js")
const humanize = require("../../config.js").humanize ?? {}

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const attacks = []
let alreadyRunning = false
let attackCount = undefined
let attackThreshold = undefined

if([,""].includes(pluginOptions.attackLimit))
    pluginOptions.attackLimit = 3500

/** The game sends no more than this many attacks for an account in any 24 hours, so no setting may ask for more. */
const GAME_DAILY_ATTACKS = 4000
/**
 * The attacks the account may send today: the player's limit (or, with none, the game's ACTH), never above the game's hard
 * limit. ACTH's exact meaning is unconfirmed, so it does not undercut a limit the player set.
 */
const dailyLimit = () => Math.min(Number(pluginOptions.attackLimit || attackThreshold) || GAME_DAILY_ATTACKS, GAME_DAILY_ATTACKS)

const reportStatus = require("../../pluginStatus.js").statusReporter(__filename)
/** Attacks used today are reported in steps of this many, so the status isn't rewritten after every attack. */
const USAGE_STEP = 50
function reportUsage() {
    const limit = dailyLimit()
    if (attackCount >= limit)
        return reportStatus("waiting", "statusDailyLimitReached", { limit })
    reportStatus("running", "statusAttacksToday", { used: Math.floor(attackCount / USAGE_STEP) * USAGE_STEP, limit })
}

xtHandler.on("gai", obj => {
    attackCount = obj.AC
    attackThreshold = obj.ACTH
    if (!botConfig.externalEvent)
        reportUsage()
})
let announced = false

/** Every attack plugin of an account shares this hourly limit. It sits above the pace the default delay gives (one attack about
 * every 6 seconds), so the delay sets the pace and the game's own limits (50 attacks out, 4,000 a day) bound the rest. */
const SHARED_HOURLY_ATTACKS = 600
const limiter = new RateLimiter({ tokensPerInterval: SHARED_HOURLY_ATTACKS, interval: "hour" })

/**
 * What the account's own limits leave: the attacks counted today against the daily limit (`used` is undefined until
 * the game has said), and whether the hourly limit every attack plugin shares has an attack left.
 */
const accountLimits = () => ({
    used: botConfig.externalEvent ? undefined : attackCount,
    limit: dailyLimit(),
    hourly: SHARED_HOURLY_ATTACKS,
    hourlyLeft: limiter.getTokensRemaining() >= 1,
})

/** How often a plugin stopped by the account's daily limit asks again. The limit rolls over 24 hours, so room returns gradually. */
const DAILY_LIMIT_RECHECK_MS = 5 * 60_000
/** For a plugin whose attack was refused with ATTACK_LIMIT_REACHED: reports the wait, then sleeps before it tries again. */
async function waitOutDailyLimit(reportStatus) {
    reportStatus("waiting", "statusTowersLimitAccount", { cap: dailyLimit(), minutes: DAILY_LIMIT_RECHECK_MS / 60_000 })
    await sleep(DAILY_LIMIT_RECHECK_MS)
    metrics.count("bot_attack_idle_seconds_total", { cause: "daily_cap" }, DAILY_LIMIT_RECHECK_MS / 1000)
}

const err = require("../../err.json")
const MAX_REJECTIONS_IN_A_ROW = 3
const FIRST_PAUSE_MS = 5 * 60_000
const LONGEST_PAUSE_MS = 60 * 60_000
let rejectionsInARow = 0
let turnRejected = false
let pausesInARow = 0
let pausedUntil = 0

// A rejected attack means the bot's view of the game is wrong. Sending more
// on the same view repeats the request the server just refused, so the queue
// stops for a while and reads the castles again before it goes on.
function pauseAttacks(reason) {
    if (Date.now() < pausedUntil)
        return
    pausesInARow++
    const ms = Math.min(FIRST_PAUSE_MS * 2 ** (pausesInARow - 1), LONGEST_PAUSE_MS)
    pausedUntil = Date.now() + ms
    metrics.count("bot_attack_pauses_total", { reason })
    console.warn("attacksPaused", ms / 60_000, "attacksPausedMinutes", reason)
}

xtHandler.on("cra", (_, result) => {
    if (Number(result) == 0) {
        rejectionsInARow = 0
        pausesInARow = 0
        return
    }
    turnRejected = true
    rejectionsInARow++
    if (err[result] == "ATTACK_TOO_MANY_UNITS")
        pauseAttacks("ATTACK_TOO_MANY_UNITS")
    else if (rejectionsInARow >= MAX_REJECTIONS_IN_A_ROW)
        pauseAttacks("REJECTIONS_IN_A_ROW")
})

const waitToAttack = callback => new Promise(async (resolve, reject) => {
    if(!botConfig.externalEvent && attackCount >= dailyLimit()) {
        if(!announced) {
            announced = true
            console.log("maxAttacksReached")
        }
        metrics.count("bot_attacks_total", { result: "limit_reached", kingdom: "all" })
        return reject("ATTACK_LIMIT_REACHED")
    }

    const queuedAt = Date.now()
    attacks.push({
        run: () => {
            metrics.observe("bot_attack_queue_wait_seconds", {}, (Date.now() - queuedAt) / 1000)
            try {
                const ret = callback()
                resolve(ret)
                return ret
            }
            catch (e) {
                reject(e)
                return true
            }
        },
        reject,
    })

    if (alreadyRunning)
        return
    alreadyRunning = true
    while (attacks.length > 0) {
        if (Date.now() < pausedUntil) {
            const pausedMs = pausedUntil - Date.now()
            await sleep(pausedMs)
            metrics.count("bot_attack_idle_seconds_total", { cause: "refusal_pause" }, pausedMs / 1000)
            await resyncUnits()
            rejectionsInARow = 0
            continue
        }
        const job = attacks.shift()
        const baseDelay = parseFloat(pluginOptions.attackDelaySeconds)
        const variance = parseFloat(pluginOptions.attackDelayRandomizationSeconds)
        const naturalDelay = (humanize.lognormal_delays ? lognormalDelay : boxMullerRandom)(baseDelay * 1000, (baseDelay + variance) * 1000)

        turnRejected = false
        let ret, threw = false
        try {
            ret = await job.run()
        } catch {
            threw = true
        }
        if (!ret && !threw && !turnRejected)
            continue

        if (ret || turnRejected)
            await limiter.removeTokens(1)
        const delay = turnRejected || threw ? naturalDelay * 2 : naturalDelay
        console.debug("attackDelayAttack", delay)
        await sleep(delay)
    }
    alreadyRunning = false
})


/** Fetches the castle list so local unit counts match the server's again. */
async function resyncUnits() {
    const snapshot = waitForResult("dcl", 1000 * 10)
    await sendXT("dcl", JSON.stringify({ CD: 1 }))
    await snapshot.catch(() => {})
}

const slotTotal = slots => (slots ?? []).reduce((n, slot) => n + (Number(slot?.[1]) || 0), 0)
const attackShape = attackInfo => ({
    waves: (attackInfo.A ?? []).map(wave => Object.fromEntries(["L", "M", "R"].map(side =>
        [side, { units: slotTotal(wave[side]?.U), tools: slotTotal(wave[side]?.T) }]))),
    courtyard: slotTotal(attackInfo.RW),
})

/**
 * What the client sends while a player sets an attack up: `adi` when the army
 * screen opens, `gas` as it loads, and `gdi` when the travel dialog opens.
 * Nothing here waits for a reply; gamePresets.js keeps the presets `gas` lists.
 */
async function openAttackDialog({ SX, SY, TX, TY, KID }) {
    await sendXT("adi", JSON.stringify({ SX, SY, TX, TY, KID }))
    await pause(800, 2500)
    await sendXT("gas", JSON.stringify({}))
    await pause(3000, 9000)
    await sendXT("gdi", JSON.stringify({ PID: playerInfo.playerID }))
    await pause(1500, 5000)
}

/** Watches `sne` for the plugin's reports, started by the plugin's first attack that asks for deletion. */
let reportCleanup

/**
 * Sends one attack and waits for its reply. After a rejection or a timeout it
 * waits for a fresh castle list before returning, so the next attack in the
 * queue never builds on unit counts the server has already contradicted.
 * Throws the server's error name, as plugins expect.
 *
 * With `context.dryRun` it logs the `cra` instead, sends nothing and returns
 * `{ dryRun: true }`. No march will free the commander, so the caller must.
 *
 * Throws "CASTLE_LOCKED", sending nothing, while Auto Station is moving the
 * source castle's troops out (castleLock.js).
 *
 * With `context.deleteReports` the plugin's own report of this attack is deleted when it comes in won (reportCleanup.js).
 */
async function sendAttack(attackInfo, kingdomID, x, y, { dryRun, deleteReports, ...context } = {}) {
    const kingdom = String(kingdomID)
    if (isCastleLocked(kingdomID, attackInfo.SX, attackInfo.SY)) {
        metrics.count("bot_attacks_total", { result: "castle_locked", kingdom })
        throw "CASTLE_LOCKED"
    }
    if (dryRun) {
        console.log("dryRunAttack", JSON.stringify(attackInfo))
        return { dryRun: true }
    }
    if (humanize.attack_dialog)
        await openAttackDialog(attackInfo)
    await sendXT("cra", JSON.stringify(attackInfo))
    let obj, result
    try {
        [obj, result] = await waitForResult("cra", 1000 * 10, (obj, result) =>
            result != 0 || (obj.AAM.M.KID == kingdomID && obj.AAM.M.TA[1] == x && obj.AAM.M.TA[2] == y))
    } catch (e) {
        metrics.count("bot_attacks_total", { result: "timed_out", kingdom })
        await resyncUnits()
        throw e
    }
    if (result != 0) {
        metrics.count("bot_attacks_total", { result: "refused", kingdom })
        metrics.count("bot_attack_refusals_total", { reason: err[result] ?? "UNKNOWN" })
        if (err[result] == "ATTACK_TOO_MANY_UNITS")
            console.error("attackRejectedDetails", JSON.stringify({
                kingdomID, x, y, lordID: attackInfo.LID, ...context, ...attackShape(attackInfo),
            }))
        await resyncUnits()
        throw err[result]
    }
    metrics.count("bot_attacks_total", { result: "sent", kingdom })
    const oneWaySeconds = Number(obj.AAM?.M?.TT)
    if (oneWaySeconds > 0)
        metrics.observe("bot_attack_round_trip_seconds", { kingdom }, 2 * oneWaySeconds)
    if (deleteReports) {
        reportCleanup ??= require("../../reportCleanup.js").createReportCleanup({ xtHandler, sendXT })
        reportCleanup.track(obj.AAM.M)
    }
    return obj
}

module.exports = {
    getAttackInfo,
    sendAttack,
    assignUnit,
    fillEventTools,
    waitToAttack,
    waitOutDailyLimit,
    getTotalAmountToolsFlank,
    getTotalAmountToolsFront,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    accountLimits,
    boxMullerRandom
}
