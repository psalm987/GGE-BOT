if (require('node:worker_threads').isMainThread) {
    return module.exports = {
        force: true,
        pluginOptions: [
            {
                type: "Text",
                key: "attackDelaySeconds",
                default: "20",
                min: 15,
                max: 600
            },
            {
                type: "Text",
                key: "attackDelayRandomizationSeconds",
                default: "15",
                min: 10,
                max: 600
            },
            {
                type: "Text",
                key: "attackLimit",
                min: 1
            }
        ]
    }
}

const { RateLimiter } = require('limiter')
const { resources } = require('../../protocols')
const { botConfig, playerInfo, xtHandler, sendXT, waitForResult } = require('../../ggeBot')
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
function getAttackInfo(kid, castle, AI, commander, level, waves, options, additionalWaves) {
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
        AST: [
            -1,
            -1,
            -1
        ],
        RW: [ //TODO: SET THIS UP PROPERLY
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ],
                [
                    -1,
                    0
                ]
            ],
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
        let minSpeed = Infinity

        unlockedHorses?.forEach(e => {
            let horse = stables.find(a => e == a.wodID)
            if (horse && Number(horse.costFactorC1) > 0 && Number(horse.costFactorC2) == 0) {
                 if (Number(horse.unitBoost) < minSpeed) {
                    minSpeed = Number(horse.unitBoost)
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
            console.warn("Ran out of fast feathers.")
            attackTarget.PTT = 0
        }
    }
    
    return attackTarget
}

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
    
xtHandler.on("gai", obj => {
    attackCount = obj.AC
    attackThreshold = obj.ACTH
})
let announced = false

const limiter = new RateLimiter({ tokensPerInterval: 120, interval: "hour" })

const err = require("../../err.json")
const MAX_REJECTIONS_IN_A_ROW = 3
let rejectionsInARow = 0
let turnRejected = false
let haltReason

// A rejected attack means the bot's view of the game is wrong. Sending more
// on the same view repeats the request the server just refused.
function halt(reason) {
    if (haltReason)
        return
    haltReason = reason
    console.error("attacksHalted", reason)
}

xtHandler.on("cra", (_, result) => {
    if (Number(result) == 0) {
        rejectionsInARow = 0
        return
    }
    turnRejected = true
    rejectionsInARow++
    if (err[result] == "ATTACK_TOO_MANY_UNITS")
        halt("ATTACK_TOO_MANY_UNITS")
    else if (rejectionsInARow >= MAX_REJECTIONS_IN_A_ROW)
        halt("REJECTIONS_IN_A_ROW")
})

const waitToAttack = callback => new Promise(async (resolve, reject) => {
    if (haltReason)
        return reject("ATTACKS_HALTED")

    if(!botConfig.externalEvent && attackCount >= Number(pluginOptions.attackLimit || attackThreshold)) {
        if(!announced) {
            announced = true
            console.log("Max attacks reached")
        }
        return reject("ATTACK_LIMIT_REACHED")
    }

    attacks.push({
        run: () => {
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
        const job = attacks.shift()
        if (haltReason) {
            job.reject("ATTACKS_HALTED")
            continue
        }
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

/**
 * Sends one attack and waits for its reply. After a rejection or a timeout it
 * waits for a fresh castle list before returning, so the next attack in the
 * queue never builds on unit counts the server has already contradicted.
 * Throws the server's error name, as plugins expect.
 */
const slotTotal = slots => (slots ?? []).reduce((n, slot) => n + (Number(slot?.[1]) || 0), 0)
const attackShape = attackInfo => ({
    waves: (attackInfo.A ?? []).map(wave => Object.fromEntries(["L", "M", "R"].map(side =>
        [side, { units: slotTotal(wave[side]?.U), tools: slotTotal(wave[side]?.T) }]))),
    courtyard: slotTotal(attackInfo.RW),
})

/**
 * What the client sends while a player sets an attack up: `adi` when the army
 * screen opens, `gas` as it loads, and `gdi` when the travel dialog opens. The
 * 2026-11-13 capture holds no server frames, so nothing here waits for a reply.
 */
async function openAttackDialog({ SX, SY, TX, TY, KID }) {
    await sendXT("adi", JSON.stringify({ SX, SY, TX, TY, KID }))
    await pause(800, 2500)
    await sendXT("gas", JSON.stringify({}))
    await pause(3000, 9000)
    await sendXT("gdi", JSON.stringify({ PID: playerInfo.playerID }))
    await pause(1500, 5000)
}

async function sendAttack(attackInfo, kingdomID, x, y, context = {}) {
    if (humanize.attack_dialog)
        await openAttackDialog(attackInfo)
    await sendXT("cra", JSON.stringify(attackInfo))
    let obj, result
    try {
        [obj, result] = await waitForResult("cra", 1000 * 10, (obj, result) =>
            result != 0 || (obj.AAM.M.KID == kingdomID && obj.AAM.M.TA[1] == x && obj.AAM.M.TA[2] == y))
    } catch (e) {
        await resyncUnits()
        throw e
    }
    if (result != 0) {
        if (err[result] == "ATTACK_TOO_MANY_UNITS")
            console.error("attackRejectedDetails", JSON.stringify({
                kingdomID, x, y, lordID: attackInfo.LID, ...context, ...attackShape(attackInfo),
            }))
        await resyncUnits()
        throw err[result]
    }
    return obj
}

module.exports = {
    getAttackInfo,
    sendAttack,
    assignUnit,
    waitToAttack,
    getTotalAmountToolsFlank,
    getTotalAmountToolsFront,
    getAmountSoldiersFlank,
    getAmountSoldiersFront,
    getMaxUnitsInReinforcementWave,
    boxMullerRandom
}
