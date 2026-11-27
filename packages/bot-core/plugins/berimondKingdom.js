/**
 * Berimond Kingdom (event 3): attacks the watchtowers of the Berimond kingdom (10) from the player's camp there, one
 * tower of the player's list after another, or the tower the game's own finder picks when the list is empty. It keeps
 * the camp stocked with the troops the player picks from the main castle and skips their two-hour trip. It never pays
 * with rubies: skips come from the player's skip items, and the only horses are the coin horse and feathers.
 * The decisions live in berimondKingdomPlan.js; this file reads the game and sends. Ported from Lazy Lord's
 * be/plugins/berimondKingdom.js (MIT). The requests and replies are in docs/protocol/berimond-kingdom.md.
 */
const EVENT = 3

if (require("node:worker_threads").isMainThread) {
    const { commanderOptions, commanderChecks } = require("../commanderOptions.js")
    const { armyOptions, horseOption } = require("../army.js")
    const { TOWER_BOXES, TARGET } = require("../berimondKingdomPlan.js")
    return module.exports = {
        eventOnly: EVENT,
        targets: [TARGET],
        checks: commanderChecks,
        pluginOptions: [
            ...TOWER_BOXES.map(key => ({ type: "Text", key, default: "" })),
            ...commanderOptions(),
            horseOption(0),
            ...armyOptions({ sides: { left: true, front: true, right: true }, waves: 1, tools: [], whenNoTools: "berimondSiegeTools" }),
            { type: "OrderedList", key: "berimondResupplyTroops", catalog: "troops", default: [] },
            { type: "Number", key: "berimondResupplyAt", min: 1, max: 100_000, unit: "troops", default: 100 },
            { type: "Checkbox", key: "berimondUseSkips", default: true },
            { type: "Checkbox", key: "dryRun", default: false },
        ],
    }
}

const path = require("node:path")
const { events, botConfig, xtHandler } = require("../ggeBot.js")
const err = require("../err.json")
const { castles, movementEvents, ClientCommands, ClassTypes, KingdomSkipType, AreaType } = require("../protocols.js")
const { waitToAttack, waitOutDailyLimit, getAttackInfo, courtyardRoom, sendAttack, openAttackScreen, waitForTroops } = require("./attack/attack.js")
const { waitForCommanderAvailable, freeCommander, commanderRefused } = require("./commander.js")
const { readArmy, fillFromPlan, choice, HORSES } = require("../army.js")
const { presetsListed } = require("../gamePresets.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, sleep, pause } = require("../pacing.js")
const eventGate = require("../eventGate.js")
const { spendSkip, skipRefused, MinuteSkipType } = require("./skips.js")
const { statusReporter, finishPlugin } = require("../pluginStatus.js")
const { pluginMemory } = require("../pluginMemory.js")
const plan = require("../berimondKingdomPlan.js")

const { KINGDOM } = plan
const options = botConfig.plugins[path.basename(__filename, ".js")] ?? {}
const dryRun = Boolean(options.dryRun)
const useSkips = options.berimondUseSkips !== false && !dryRun
const threshold = Math.max(1, Math.floor(Number(options.berimondResupplyAt) || 100))
const resupplyTroops = (Array.isArray(options.berimondResupplyTroops) ? options.berimondResupplyTroops : []).map(Number)
const horse = choice(HORSES, options.horse, HORSES[0])

const reportStatus = statusReporter(__filename)
const memory = pluginMemory(__filename)

const SECOND = 1000, MINUTE = 60 * SECOND
/** The courtyard and the wave slots are worked out for a target of this level, as Lazy Lord's plugin does. */
const SLOT_LEVEL = 70
const jitter = ms => boxMullerRandom(0.8 * ms, 1.2 * ms)

/** The event ended or the plugin stopped for this event: nothing more is sent. */
let over = false
let queue = plan.newQueue([])
/** Commander -> its cut after too many units; `allCut` is what every commander loses. */
const cuts = new Map()
let allCut = 0
let attacks = 0
let points
/** The camp's free space as `fuc` last said, undefined until asked. */
let freeSpace

const camp = () => castles.find(c => c.kingdomID == KINGDOM && c.areaInfo?.type == AreaType.beriCastle)
const mainCastle = () => castles.find(c => c.kingdomID == 0 && c.areaInfo?.type == AreaType.mainCastle)

xtHandler.on("pep", (obj, result) => {
    if (Number(result) != 0 || Number(obj?.EID) != EVENT)
        return
    const read = Number(Array.isArray(obj.OP) ? obj.OP[0] : obj.OP)
    if (Number.isFinite(read))
        points = read
})

/**
 * When the account last started an army. Two army starts close together can get the connection closed
 * (CANT_START_NEW_ARMIES), so an attack or a transfer keeps 3.5 to 6 seconds after the last one, whichever plugin sent it.
 */
let lastArmyAt = 0
for (const cmd of ["cra", "cat", "cds", "kut"])
    xtHandler.on(cmd, (_, result) => Number(result) == 0 && (lastArmyAt = Date.now()))
async function armyGap() {
    const wait = boxMullerRandom(3500, 6000) - (Date.now() - lastArmyAt)
    if (wait > 0)
        await sleep(wait)
    lastArmyAt = Date.now()
}

// ---- Memory across restarts ----
/** Takes the event's end in: towers dropped earlier this event stay dropped, and a new event forgets them. */
function noteEvent(info) {
    const endsAt = Date.now() + (Number(info?.RS) > 0 ? Number(info.RS) * SECOND : 7 * 24 * 60 * MINUTE)
    const kept = Number(memory.get("eventEndsAt")) > Date.now() ? memory.get("dropped") : undefined
    memory.set("eventEndsAt", endsAt)
    memory.set("dropped", Array.isArray(kept) ? kept : [])
    return memory.get("dropped")
}

// ---- The tower list ----
const DROP_LOGS = {
    destroyed: ["log", "berimondTowerDestroyed"],
    notFound: ["warn", "berimondTowerNotFound"],
    wrongCoordinates: ["warn", "berimondTowerWrongPlace"],
    lookFailed: ["warn", "berimondTowerLookFailed"],
    refused: ["warn", "berimondTowerRefused"],
}
function noteDrop({ drop, reason }) {
    const [level, key] = DROP_LOGS[reason]
    console[level](key, drop, queue.towers.length)
    memory.set("dropped", [...memory.get("dropped") ?? [], drop])
}

/** The tower to attack next, looked at first, or undefined after a wait or once the plugin stops. */
async function nextTower() {
    if (queue.find)
        return findTower()
    while (!over && !queue.stop) {
        const free = plan.firstFree(queue, Date.now())
        queue = free.queue
        if (free.waitMs > 0) {
            await sleep(free.waitMs)
            return undefined
        }
        const tower = queue.towers[0]
        const { areaInfo, result } = await ClientCommands.preSpyInfo(tower.x, tower.y, KINGDOM, false).catch(() => ({ result: -1 }))
        const look = result == 0 ? (Number(areaInfo?.type) == AreaType.watchTower ? "tower" : "notTower")
            : err[result] == "INVALID_POSITION" ? "empty" : "failed"
        const step = plan.afterLook(queue, look)
        queue = step.queue
        if (step.effect.use)
            return areaInfo
        if (step.effect.drop) {
            noteDrop(step.effect)
            continue
        }
        console.debug("[berimond] look failed", tower.key, err[result] ?? result)
        await sleep(jitter(step.effect.waitMs))
        return undefined
    }
    return undefined
}

/** The tower the game's finder (`fnt`) picks, as the client's own "next tower" button asks for it. */
async function findTower() {
    const { reply, result } = await ask("fnt", {})
    const record = reply?.gaa?.AI?.[0]
    if (result === 0 && Number(record?.[0]) == AreaType.watchTower)
        return new ClassTypes.ServerGetAreaInfo(reply.gaa).areaInfo[0]
    console.debug("[berimond] fnt", err[result] ?? result)
    reportStatus("waiting", "statusBerimondNoTowerFound", { minutes: 10 })
    await sleep(jitter(10 * MINUTE))
    return undefined
}

// ---- Attacks ----
function stopFor(reason) {
    over = true
    if (reason == "twoRefusals") {
        console.error("berimondTwoRefusals")
        reportStatus("stopped", "statusBerimondTwoRefusals")
    } else {
        console.warn("berimondTowersDone")
        reportStatus("stopped", "statusBerimondTowersDone")
    }
}

/** The event is over, or ends before an attack could land: the runner switches the plugin off until the next one. */
function eventOver() {
    if (finishedSaid)
        return
    finishedSaid = true
    over = true
    console.log("berimondEventOver")
    reportStatus("stopped", "statusBerimondEventOver")
    finishPlugin(__filename, "eventOver")
}
let finishedSaid = false

const reportAttacking = tower => reportStatus("running", "statusBerimondAttacking", { tower: `${tower.x}:${tower.y}`, attacks, points: points ?? 0 })

/**
 * One attack on `towerInfo` from the camp, inside the account's attack queue: the attack screen (`aci`), which
 * reads the camp's troops and the commander's bonuses there, then the army and the `cra`. Undefined once the plugin
 * stopped. Throws the game's error, or "NO_MORE_TROOPS" while the camp can't fill it.
 */
async function attackOnce(beri, towerInfo, commander, army) {
    if (over)
        return undefined
    const lord = await openAttackScreen(beri, towerInfo, KINGDOM, commander, { dryRun })
    const effects = lord.getEffects(towerInfo.type)
    const troops = plan.troopRoom(plan.towerLevel(towerInfo), effects, { cut: cuts.get(lord.lordID) ?? 0, allCut })
    const room = { flankUnits: troops.flank, frontUnits: troops.front, flankTools: plan.TOOL_ROOM.flank, frontTools: plan.TOOL_ROOM.front, courtyard: courtyardRoom(SLOT_LEVEL, effects) }
    const attackInfo = getAttackInfo(KINGDOM, beri, towerInfo, lord, SLOT_LEVEL, army.mode == "waves" ? undefined : 1, horse, effects.additionalWaves)
    // The client ticks "share view" against a Berimond target (capture of 26 Nov 2026).
    attackInfo.AV = 1
    if (army.mode == "waves")
        fillFromPlan(attackInfo, army.waves, beri.unitInventory, room, plan.TARGET)
    else
        plan.autofillWave(attackInfo.A[0], beri.unitInventory, room, { campFull: freeSpace < threshold })
    if (plan.waveOneSoldiers(attackInfo) < plan.WAVE_ONE_MIN)
        throw "WAVE_ONE_SMALL"
    await pause(500, 1200)
    await armyGap()
    if (over)
        return undefined
    return sendAttack(attackInfo, KINGDOM, towerInfo.x, towerInfo.y, { dryRun, level: plan.towerLevel(towerInfo) })
}

/** What the plugin does after `error` from an attack on `towerInfo` with `lordID`. */
async function afterError(error, towerInfo, lordID) {
    const outcome = error == "WAVE_ONE_SMALL" ? "waveOneSmall" : plan.attackOutcome(error)
    console.debug("[berimond] attack", `${towerInfo.x}:${towerInfo.y}`, error, outcome)
    switch (outcome) {
        case "refused": {
            const step = plan.afterAttack(queue, `${towerInfo.x}:${towerInfo.y}`, "refused")
            queue = step.queue
            if (step.effect.drop)
                noteDrop(step.effect)
            if (queue.stop)
                stopFor(queue.stop)
            return pause(10 * SECOND, 20 * SECOND)
        }
        case "cooling":
            if (!queue.find)
                queue = plan.holdTower(queue, `${towerInfo.x}:${towerInfo.y}`, Date.now())
            console.debug("[berimond] not ready, held", `${towerInfo.x}:${towerInfo.y}`)
            return pause(10 * SECOND, 20 * SECOND)
        case "tooMany": {
            const next = plan.cutAfterTooMany({ cut: cuts.get(lordID) ?? 0, allCut })
            cuts.set(lordID, next.cut)
            allCut = next.allCut
            console.debug("[berimond] too many units", lordID, next.cut, allCut)
            return pause(4 * SECOND, 6 * SECOND)
        }
        case "eventOver":
            return eventOver()
        case "coins":
            console.warn("berimondNoCoins")
            return sleep(jitter(10 * MINUTE))
        case "dailyLimit":
            return waitOutDailyLimit(reportStatus)
        case "troops":
            reportStatus("waiting", "statusBerimondWaitingTroops")
            return waitForTroops(movement => movement.kingdomID == KINGDOM)
        case "waveOneSmall":
            over = true
            console.error("berimondWaveOneSmall", plan.WAVE_ONE_MIN)
            return reportStatus("error", "statusBerimondWaveOneSmall", { min: plan.WAVE_ONE_MIN })
        default:
            return pause(10 * SECOND, 20 * SECOND)
    }
}

async function attackLoop() {
    const army = readArmy(options, reportStatus)
    if (!army || !await presetsListed(army, reportStatus))
        return
    while (!over) {
        const beri = camp()
        if (!beri) {
            reportStatus("waiting", "statusBerimondNoCamp")
            await sleep(jitter(MINUTE))
            continue
        }
        const towerInfo = await nextTower()
        if (queue.stop && !over)
            stopFor(queue.stop)
        if (!towerInfo || over)
            continue
        const commander = await waitForCommanderAvailable(options.commanderWhiteList, undefined, undefined, __filename)
        try {
            const sent = await waitToAttack(() => attackOnce(beri, towerInfo, commander, army), __filename)
            if (!sent || sent.dryRun)
                freeCommander(commander.lordID)
            if (!sent)
                continue
            queue = plan.afterAttack(queue, `${towerInfo.x}:${towerInfo.y}`, "sent").queue
            attacks++
            if (!sent.dryRun)
                console.log("berimondAttacked", `${towerInfo.x}:${towerInfo.y}`)
            reportAttacking(towerInfo)
            // A dry run changes nothing in the game, so it looks again only after a while.
            if (sent.dryRun)
                await sleep(jitter(5 * MINUTE))
        } catch (error) {
            error == "LORD_IS_USED" ? commanderRefused(commander.lordID) : freeCommander(commander.lordID)
            await afterError(error, towerInfo, commander.lordID)
        }
    }
}

// ---- Keeping the camp stocked ----
/** When each transfer timer was seen: `troopTransfer.remainingTime` is the seconds left when the game sent it. */
const seenAt = new WeakMap()
function transferLeftMs(castle) {
    const transfer = castle.troopTransfer
    if (!(transfer?.remainingTime > 0))
        return 0
    if (!seenAt.has(transfer))
        seenAt.set(transfer, Date.now())
    return Math.max(0, transfer.remainingTime * SECOND - (Date.now() - seenAt.get(transfer)))
}

/** Skips the transfer on its way into the camp (`msk` TT 1). A reply without a new timer counts the skip down on the old one. */
async function skipTransfer(beri) {
    while (transferLeftMs(beri) > 0 && !over) {
        const before = beri.troopTransfer
        const skip = spendSkip(transferLeftMs(beri) / SECOND)
        if (skip == undefined)
            return
        await pause(1000, 3000)
        const result = await ClientCommands.skipResourceTransfer(skip, KINGDOM, KingdomSkipType.sendTroops).catch(() => undefined)
        if (result != 0) {
            if (skipRefused(skip, result))
                continue
            return
        }
        if (beri.troopTransfer === before)
            before.remainingTime -= MinuteSkipType[skip] * 60
    }
}

let resupplyFailures = 0
function backOff(...parts) {
    resupplyFailures++
    const ms = plan.resupplyBackoffMs(resupplyFailures)
    console.warn(...parts, Math.round(ms / MINUTE))
    return jitter(ms)
}

/**
 * One check of the camp: skip a transfer still on its way, else ask the camp's free space (`fuc`) and, once it reaches
 * the threshold, send the listed troops from the main castle (`kut`). Returns the wait before the next check.
 */
async function resupply() {
    if (over)
        return undefined
    const beri = camp()
    if (!beri)
        return 2 * MINUTE
    if (transferLeftMs(beri) > 0) {
        if (useSkips)
            await skipTransfer(beri)
        const left = transferLeftMs(beri)
        return left > 0 ? Math.min(left + 15 * SECOND, 30 * MINUTE) : 15 * SECOND
    }
    const { reply, result } = await ask("fuc", { CID: beri.id })
    if (err[result] == "INVALID_AREA") {
        console.error("berimondFreeSpaceRefused")
        return undefined
    }
    if (result !== 0 || !(Number(reply?.FUC) >= 0))
        return 2 * MINUTE
    freeSpace = Number(reply.FUC)
    if (freeSpace < threshold)
        return boxMullerRandom(MINUTE, 2 * MINUTE)
    const main = mainCastle()
    if (!main)
        return backOff("berimondNoMainCastle")
    // The game's own count of the main castle, read right before the transfer: the bot's lags behind attacks that left.
    await ask("dcl", { CD: 1 })
    const held = resupplyTroops.flatMap(wodID => (main.unitInventory ?? [])
        .filter(u => Number(u.unitInfo?.wodID) == wodID && u.amount > 0 && plan.isSendable(u.unitInfo))
        .map(u => [wodID, u.amount]))
    const step = plan.resupplyPlan({ freeSpace, threshold, held })
    if (step.short !== undefined)
        return backOff("berimondResupplyShort", step.short, freeSpace)
    if (step.noRoom)
        return boxMullerRandom(MINUTE, 2 * MINUTE)
    const request = { SCID: main.id, SKID: main.kingdomID, TKID: KINGDOM, CID: -1, A: step.units }
    if (dryRun) {
        console.log("berimondDryRunKut", JSON.stringify(request))
        return 30 * MINUTE
    }
    await armyGap()
    if (over)
        return undefined
    const sent = await ClientCommands.kingdomTroopTransfer(main.id, main.kingdomID, KINGDOM, step.units).catch(error => error)
    if (sent !== 0)
        return backOff("berimondResupplyRefused", err[sent] ?? sent)
    resupplyFailures = 0
    console.log("berimondResupplySent", JSON.stringify(step.units))
    return 15 * SECOND
}

/** Fresh castle data after troops come home to the camp, at most one request a few seconds after the return. */
let refreshing = false
movementEvents.on("return", movement => {
    if (over || refreshing || movement?.kingdomID != KINGDOM)
        return
    refreshing = true
    sleep(boxMullerRandom(1500, 3000)).then(() => ask("dcl", { CD: 1 })).catch(() => undefined).finally(() => refreshing = false)
})

// ---- Start and stop ----
function start(info) {
    const { towers, bad } = plan.readTowers(options, noteEvent(info))
    if (bad > 0)
        console.warn("berimondBadTowers", bad)
    const listed = plan.TOWER_BOXES.some(box => String(options[box] ?? "").trim())
    queue = plan.newQueue(towers, { find: !listed })
    if (queue.stop)
        return stopFor(queue.stop)
    reportStatus("running", "statusBerimondStarting")
    ask("pep", { EID: EVENT }, 15_000, reply => Number(reply.EID) == EVENT).catch(() => undefined)
    attackLoop().catch(error => {
        console.error(error)
        reportStatus("error", "statusBerimondFailed")
    })
    if (resupplyTroops.length)
        chore("berimondKingdom", resupply, boxMullerRandom(20 * SECOND, 40 * SECOND))
}

eventGate.onStop(EVENT, eventOver)

reportStatus("waiting", "statusBerimondWaitingForEvent")
events.once("load", () => eventGate.whenActive(EVENT).then(info => {
    if (!over)
        start(info)
}))
