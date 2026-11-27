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
const { resources, ClassTypes, movementEvents } = require('../../protocols')
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

/**
 * The courtyard's room for a commander with `effects`: the flat bonus is added to the base and the % boost applies to
 * both, as Lazy Lord's attack.js does. Before, plugins added the flat bonus after the formula and left out the boost.
 */
const courtyardRoom = (targetLevel, effects = {}) => getMaxUnitsInReinforcementWave(playerInfo.level, targetLevel,
    effects.attackUnitAmountReinforcementBonus, effects.attackUnitAmountReinforcementBoost)

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

/** The castle's fastest horse paid in coins alone, or -1 when its stables have none. */
function coinHorse(castle) {
    let bestHorse = -1
    let maxSpeed = -Infinity
    for (const id of castle.unlockedHorses ?? []) {
        const horse = stables.find(a => id == a.wodID)
        if (horse && Number(horse.costFactorC1) > 0 && Number(horse.costFactorC2) == 0 && Number(horse.unitBoost) > maxSpeed) {
            maxSpeed = Number(horse.unitBoost)
            bestHorse = id
        }
    }
    return bestHorse
}

/** Out of feathers is warned at most this often, not on every attack (as Lazy Lord's attack.js chooseHorse). */
const OUT_OF_FEATHERS_WARN_MS = 10 * 60_000
let outOfFeathersWarnedAt = -Infinity

/** HBW and PTT for the cra. A feather with none left rides the coin horse instead of walking. */
function chooseHorse(castle, options) {
    if (options.useFeather) {
        if (resources.pegasusTicket > 0) {
            outOfFeathersWarnedAt = -Infinity
            return { HBW: -1, PTT: 1 }
        }
        const HBW = coinHorse(castle)
        if (Date.now() - outOfFeathersWarnedAt >= OUT_OF_FEATHERS_WARN_MS) {
            outOfFeathersWarnedAt = Date.now()
            console.warn(HBW == -1 ? "outOfFeathers" : "outOfFeathersCoinHorse")
        }
        return { HBW, PTT: 0 }
    }
    if (options.useCoin) {
        const HBW = coinHorse(castle)
        if (HBW == -1)
            console.debug("noStablesCoinHorse")
        return { HBW, PTT: 0 }
    }
    return { HBW: -1, PTT: 0 }
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
    Object.assign(attackTarget, chooseHorse(castle, options))
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

/**
 * Today's count is the game's own (`gai`, sent at login) plus every attack the game accepted since, and starts again at
 * zero on a new UTC day. Where the game's own day ends is unconfirmed; the next `gai` corrects the count either way.
 */
const utcDay = time => new Date(time).toISOString().slice(0, 10)
let countDay = utcDay(Date.now())
function startNewDayIfDue() {
    const today = utcDay(Date.now())
    if (today == countDay)
        return
    countDay = today
    if (attackCount !== undefined)
        attackCount = 0
}

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
    startNewDayIfDue()
    if (!Number.isFinite(Number(obj.AC)))
        return
    attackCount = Number(obj.AC)
    attackThreshold = obj.ACTH
    if (!botConfig.externalEvent)
        reportUsage()
})
// Without this the count moved only at login, so the daily limit was overshot or never released (Lazy Lord's attack.js).
xtHandler.on("cra", (_, result) => {
    if (Number(result) != 0)
        return
    startNewDayIfDue()
    attackCount = (attackCount ?? 0) + 1
    if (!botConfig.externalEvent && attackCount % USAGE_STEP == 0)
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
function accountLimits() {
    startNewDayIfDue()
    return {
        used: botConfig.externalEvent ? undefined : attackCount,
        limit: dailyLimit(),
        hourly: SHARED_HOURLY_ATTACKS,
        hourlyLeft: limiter.getTokensRemaining() >= 1,
    }
}

/** How often a plugin stopped by the account's daily limit asks again. The limit rolls over 24 hours, so room returns gradually. */
const DAILY_LIMIT_RECHECK_MS = 5 * 60_000
/** For a plugin whose attack was refused with ATTACK_LIMIT_REACHED: reports the wait, then sleeps before it tries again. */
async function waitOutDailyLimit(reportStatus) {
    reportStatus("waiting", "statusTowersLimitAccount", { cap: dailyLimit(), minutes: DAILY_LIMIT_RECHECK_MS / 60_000 })
    await sleep(DAILY_LIMIT_RECHECK_MS)
    metrics.count("bot_attack_idle_seconds_total", { cause: "daily_cap" }, DAILY_LIMIT_RECHECK_MS / 1000)
}

const err = require("../../err.json")

/**
 * The same error again from one plugin makes that plugin wait this much longer before its next attack, the longest
 * from then on, and a success clears it. The other plugins go on meanwhile. Before, any 3 refusals from any plugin
 * paused every plugin (Lazy Lord's attack.js REPEATED_ERROR_WAITS_MS).
 */
const REPEATED_ERROR_WAITS_MS = [30, 60, 120, 300].map(seconds => seconds * 1000)
/** Thrown before anything is sent to the game, so they need neither a gap nor a wait. */
const LOCAL_ERRORS = new Set(["NO_MORE_TROOPS", "NOT_ENOUGH_TOOLS", "CASTLE_LOCKED"])
/** Plugin -> its last error, how often it came in a row, and when the plugin may attack again. */
const pluginErrors = new Map()

function noteError(plugin, error) {
    const last = pluginErrors.get(plugin)
    const count = last?.error === error ? last.count + 1 : 0
    const wait = count > 0 ? REPEATED_ERROR_WAITS_MS[Math.min(count, REPEATED_ERROR_WAITS_MS.length) - 1] : 0
    pluginErrors.set(plugin, { error, count, until: Date.now() + wait })
    if (wait > 0)
        console.log("attackErrorRepeated", String(error), wait / 1000)
}

/**
 * CANT_START_NEW_ARMIES is the game refusing the account any new army, so every plugin waits this long. Lazy Lord saw
 * it after attacks 1.5 s apart, and the game held the account about 30 minutes.
 */
const NEW_ARMIES_PAUSE_MS = 30 * 60_000
let pausedUntil = 0

let turnRejected = false
xtHandler.on("cra", (_, result) => {
    if (Number(result) != 0)
        turnRejected = true
})

/**
 * Runs `callback` in the account's shared attack queue, one attack at a time with a gap between them. `plugin` names
 * the caller, whose repeated errors make it alone wait longer (see REPEATED_ERROR_WAITS_MS).
 */
const waitToAttack = (callback, plugin = "attack") => new Promise(async (resolve, reject) => {
    startNewDayIfDue()
    if(!botConfig.externalEvent && attackCount >= dailyLimit()) {
        if(!announced) {
            announced = true
            console.log("maxAttacksReached")
        }
        metrics.count("bot_attacks_total", { result: "limit_reached", kingdom: "all" })
        return reject("ATTACK_LIMIT_REACHED")
    }
    announced = false

    const until = pluginErrors.get(plugin)?.until ?? 0
    if (until > Date.now()) {
        const waitMs = until - Date.now()
        await sleep(waitMs)
        metrics.count("bot_attack_idle_seconds_total", { cause: "repeated_error" }, waitMs / 1000)
    }

    const queuedAt = Date.now()
    attacks.push({
        plugin,
        run: () => {
            metrics.observe("bot_attack_queue_wait_seconds", {}, (Date.now() - queuedAt) / 1000)
            const ret = Promise.resolve().then(callback)
            resolve(ret)
            return ret
        },
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
            continue
        }
        const job = attacks.shift()
        const baseDelay = parseFloat(pluginOptions.attackDelaySeconds)
        const variance = parseFloat(pluginOptions.attackDelayRandomizationSeconds)
        const naturalDelay = (humanize.lognormal_delays ? lognormalDelay : boxMullerRandom)(baseDelay * 1000, (baseDelay + variance) * 1000)

        turnRejected = false
        let ret, error
        try {
            ret = await job.run()
        } catch (e) {
            error = e ?? "UNKNOWN"
        }
        if (error === undefined && ret)
            pluginErrors.delete(job.plugin)
        if (LOCAL_ERRORS.has(error) || (error === undefined && !ret && !turnRejected))
            continue
        if (error !== undefined)
            noteError(job.plugin, error)
        if (error == "CANT_START_NEW_ARMIES") {
            pausedUntil = Date.now() + NEW_ARMIES_PAUSE_MS
            metrics.count("bot_attack_pauses_total", { reason: error })
            console.warn("attacksPaused", NEW_ARMIES_PAUSE_MS / 60_000, "attacksPausedMinutes", error)
        }

        if (ret || turnRejected)
            await limiter.removeTokens(1)
        const delay = turnRejected || error !== undefined ? naturalDelay * 2 : naturalDelay
        console.debug("attackDelayAttack", delay)
        await sleep(delay)
    }
    alreadyRunning = false
})

/** Out of troops: waits until `isOurReturn` picks a march coming home, or this long at most, so troops recruited meanwhile are used too. */
const TROOPS_RECHECK_MS = 5 * 60_000
/**
 * Resolves when a march `isOurReturn` accepts comes home, or after `timeout`. Before, a plugin out of troops waited for
 * a return with no timeout, and with no army out it waited for ever (Lazy Lord's attack.js waitForTroops).
 */
function waitForTroops(isOurReturn, timeout = TROOPS_RECHECK_MS) {
    return new Promise(resolve => {
        const onReturn = movement => {
            if (isOurReturn(movement))
                done()
        }
        const done = () => {
            clearTimeout(timer)
            movementEvents.off("return", onReturn)
            resolve()
        }
        const timer = setTimeout(done, timeout)
        timer.unref?.()
        movementEvents.on("return", onReturn)
    })
}


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
 * What the client sends while a player sets an attack up, after the attack screen (openAttackScreen): `gas` as the
 * army screen loads, and `gdi` when the travel dialog opens. Nothing here waits for a reply; gamePresets.js keeps the
 * presets `gas` lists.
 */
async function openAttackDialog() {
    await pause(800, 2500)
    await sendXT("gas", JSON.stringify({}))
    await pause(3000, 9000)
    await sendXT("gdi", JSON.stringify({ PID: playerInfo.playerID }))
    await pause(1500, 5000)
}

/**
 * The request the client sends when the player opens the attack screen on a target of `areaType`. Fortresses have
 * their own, and a storm resource island's names no source castle, so it has none (Lazy Lord's attack.js
 * attackScreenCommand; medium confidence, their code only).
 */
const screenCommand = areaType => areaType == 11 ? "abi" : areaType == 17 ? "aci" : areaType == 24 ? undefined : "adi"

/**
 * Opens the attack screen from `castle` on `areaInfo`, as the client does before every attack, and reads what the
 * server says there: the castle's troops and tools (`gui.I`), the target as it is now (`gaa.AI`), and each commander's
 * bonuses for this castle and target (`gli.C` plus `AE`). The castle's unit count and the target's extraData are
 * replaced in place. Our own count lags after an attack leaves, and an army built on it is refused with MISSING_UNITS.
 *
 * Returns the commander as the server sees it, or `commander` when the reply has no data for it. Throws
 * "ATTACK_SCREEN_REFUSED" when the game refuses the screen, which means the target is not ready, and "TIMED_OUT" when
 * it does not answer. A dry run opens no screen.
 */
async function openAttackScreen(castle, areaInfo, kingdomID, commander, { dryRun } = {}) {
    const command = screenCommand(Number(areaInfo?.type))
    if (dryRun || !command || !castle?.areaInfo)
        return commander
    await sendXT(command, JSON.stringify({ SX: castle.areaInfo.x, SY: castle.areaInfo.y, TX: areaInfo.x, TY: areaInfo.y, KID: kingdomID }))
    const [screen, result] = await waitForResult(command, 1000 * 10, (obj, result) =>
        result != 0 || (obj.gaa?.AI?.[1] == areaInfo.x && obj.gaa?.AI?.[2] == areaInfo.y), Object.values(err))
    if (result != 0) {
        const reason = err[result] ?? String(result)
        metrics.count("bot_attack_screen_refusals_total", { reason })
        // COOLING_DOWN is another player's hit landing between the look and the screen, which a person can lose too.
        ;(reason == "COOLING_DOWN" ? console.debug : console.warn)("attackScreenRefused", reason, `${areaInfo.x}:${areaInfo.y}`)
        throw "ATTACK_SCREEN_REFUSED"
    }
    if (Array.isArray(screen.gui?.I) && Number(screen.SCID) == Number(castle.id))
        Object.assign(castle, new ClassTypes.UnitInventory(screen.gui))
    if (Array.isArray(screen.gaa?.AI) && screen.gaa.AI.length > 3)
        Object.assign(areaInfo, { extraData: screen.gaa.AI.slice(3), timeSinceRequest: Date.now() })
    const raw = screen.gli?.C?.find?.(lord => Number(lord.ID) == Number(commander.lordID))
    if (!raw)
        return commander
    try {
        return new ClassTypes.Lord(Array.isArray(screen.AE) ? { ...raw, AE: screen.AE } : raw)
    } catch (e) {
        console.debug("attackScreenCommanderUnread", e)
        return commander
    }
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
        await openAttackDialog()
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
    openAttackScreen,
    assignUnit,
    fillEventTools,
    waitToAttack,
    waitForTroops,
    waitOutDailyLimit,
    getTotalAmountToolsFlank,
    getTotalAmountToolsFront,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    courtyardRoom,
    accountLimits,
    boxMullerRandom
}
