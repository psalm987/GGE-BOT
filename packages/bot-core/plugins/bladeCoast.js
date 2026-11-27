/**
 * Blade Coast (event 4): joins with resources, builds the camp (storehouses, tents, decorations, expansions), fills it
 * with the chosen troop and three tools from one castle, upgrades the warship and attacks the islands one at a time,
 * map after map (22, 27, 28). It never pays with rubies: every request goes through bladeCoastPlan.mayLeave first.
 * The decisions live in bladeCoastPlan.js; this file reads the game and sends. Ported from Lazy Lord's
 * be/plugins/bladeCoast.js (MIT). The requests and replies are in docs/protocol/blade-coast.md.
 */
const EVENT = 4

if (require("node:worker_threads").isMainThread) {
    const { bladeCoastSetupOption } = require("../unitCatalog.js")
    const paths = require("../paths.js")
    const readOr = (read, fallback) => { try { return read() } catch { return fallback } }
    const units = readOr(() => paths.loadItem("units"), [])
    const lang = readOr(() => require(require("node:path").join(paths.lang, "en.json")), {})
    return module.exports = {
        eventOnly: EVENT,
        pluginOptions: [
            bladeCoastSetupOption("bladeSetup", units, lang),
            { type: "Checkbox", key: "useSkips", default: true },
            { type: "Checkbox", key: "shortestRoute", default: false },
            { type: "Number", key: "coinFloor", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 100_000 },
            { type: "Checkbox", key: "dryRun", default: false },
        ],
    }
}

const path = require("node:path")
const { parentPort } = require("node:worker_threads")
const { events, botConfig, playerInfo, status, xtHandler, sendXT } = require("../ggeBot.js")
const ActionType = require("../actions.json")
const err = require("../err.json")
const { loadItem } = require("../paths.js")
const { castles, resources, setCastle, forgetCurrentCastle, troopTransferTurn, goodsTransferTurn, AreaType } = require("../protocols.js")
const { chore } = require("../chores.js")
const { pause, boxMullerRandom } = require("../pacing.js")
const eventGate = require("../eventGate.js")
const { spendSkip, skipRefused, MinuteSkipType } = require("./skips.js")
const layoutKit = require("../castleLayout.js")
const { requests: builder } = require("../castleBuilder.js")
const { bladeCoastWods, slotsOf, isTroop } = require("../unitCatalog.js")
const bladeMovements = require("../bladeMovements.js")
const { finishPlugin, statusReporter } = require("../pluginStatus.js")
const { pluginMemory } = require("../pluginMemory.js")
const { MAIN_CASTLE } = require("../legacyOptions.js")
const plan = require("../bladeCoastPlan.js")

const options = botConfig.plugins[path.basename(__filename, ".js")] ?? {}
const dryRun = Boolean(options.dryRun)
const useSkips = options.useSkips !== false && !dryRun
const shortest = Boolean(options.shortestRoute)
const coinFloor = Number.isFinite(Number(options.coinFloor)) && options.coinFloor !== "" && options.coinFloor !== null ? Number(options.coinFloor) : 100_000

const units = loadItem("units")
const unitByWod = new Map(units.map(u => [Number(u.wodID), u]))
const tmaps = loadItem("tmaps"), tmapnodes = loadItem("tmapnodes"), partpay = loadItem("partpayprices")
const campCost = loadItem("prebuiltcastles").find(p => Number(p.preBuiltCastleID) == plan.CAMP_ID)
const coastMaps = new Map(plan.MAP_ORDER.map(mid => [mid, plan.coastMap(mid, tmaps, tmapnodes)]))

const reportStatus = statusReporter(__filename)
const memory = pluginMemory(__filename)

const SECOND = 1000, MINUTE = 60 * SECOND
const STEP_WAIT = 30 * SECOND, MIN_WAIT = MINUTE, MAX_WAIT = 10 * MINUTE, HOUR = 60 * MINUTE
const quickWait = () => boxMullerRandom(4 * SECOND, 8 * SECOND)
const REPLY_TIMEOUT_MS = 10 * SECOND

// ---- What this run knows ----
/** Lost an island twice, or the event ends before an attack could land: no more attacks this event. */
let stopped = false
/** The event stopped, or every map is done: nothing more is sent. */
let over = false
/** The attack this run sent: `{ island, level, kraken, movementID, sentAt, endsAt }`. */
let attackOut
const losses = new Map()
const toolsSentOnce = new Set()
const leftChests = new Set()
let transfersRefusedUntil = 0, skipsOutUntil = 0
/** Requests a dry run logged instead of sending. Nothing changed, so it looks again only after the longest wait. */
let dryWrites = 0
/** Maps closed (`tfm`) this event, kept in plugin memory with the event's end so a restart knows them. */
const closed = new Set()

// ---- Talking to the game ----
const said = new Map()
/** A log line only when it is new for `key`, so a waiting plugin doesn't repeat itself every run. */
function once(key, level, ...parts) {
    const text = JSON.stringify(parts)
    if (said.get(key) === text)
        return
    said.set(key, text)
    console[level](...parts)
}
const forget = key => said.delete(key)
/** A line saying a change was made. A dry run made none, and its "not sent" line already says what it would have done. */
const logDone = (...parts) => dryRun || console.log(...parts)
const problemOf = result => result === 0 ? undefined : err[result] ?? String(result)

/**
 * Sends `cmd` and waits for its reply (`replyCmd`) for 10 s: `{ reply, result }`, result "TIMED_OUT" when none came.
 * Nothing leaves that bladeCoastPlan.mayLeave refuses, or after the event stopped. A dry run logs every request that
 * changes something and answers it as accepted; reads still go out.
 */
function send(cmd, payload, replyCmd = cmd) {
    if (over)
        return Promise.resolve({ result: "STOPPED" })
    if (!plan.mayLeave(cmd, payload)) {
        console.error("bladeNotSent", cmd)
        return Promise.resolve({ result: "NOT_SENT" })
    }
    if (dryRun && !plan.READS.has(cmd)) {
        dryWrites++
        once(`dry:${cmd}:${JSON.stringify(payload)}`, "log", "bladeDryRun", cmd, " ", JSON.stringify(payload))
        return Promise.resolve({ reply: {}, result: 0, dry: true })
    }
    return new Promise(resolve => {
        const done = answer => {
            clearTimeout(timer)
            xtHandler.off(replyCmd, onReply)
            resolve(answer)
        }
        const onReply = (reply, result) => done({ reply: Object(reply), result: Number(result) })
        const timer = setTimeout(() => done({ result: "TIMED_OUT" }), REPLY_TIMEOUT_MS)
        timer.unref?.()
        xtHandler.on(replyCmd, onReply)
        console.debug("[blade] send", cmd, JSON.stringify(payload))
        Promise.resolve(sendXT(cmd, JSON.stringify(payload))).catch(error => done({ result: String(error?.message ?? error) }))
    })
}

/** The camp on map `mid` (`tmp`): `{ camp }`, `{}` when the player hasn't joined it, `{ problem }` when refused. */
async function readMap(mid) {
    const { reply, result } = await send("tmp", { MID: mid })
    if (result !== 0)
        return { problem: problemOf(result) }
    return { camp: plan.readCamp((reply?.TM ?? []).find(m => Number(m.MID) == mid)) }
}

/** Enters the camp (`jea`, answered by `jaa`): its layout and the goods the camp holds for building. */
async function enterCamp(mid) {
    const { reply, result } = await send("jea", { MID: mid }, "jaa")
    if (result !== 0 || !reply?.gca)
        return { problem: problemOf(result) }
    return { layout: layoutKit.parseCastleLayout(reply.gca), wood: Number(reply.grc?.W) || 0, stone: Number(reply.grc?.S) || 0 }
}

// ---- The setup ----
const MAIN_TYPES = [AreaType.mainCastle, AreaType.externalKingdom]
const castleOf = ref => castles.find(c => c.kingdomID == ref.kingdom && (ref.id == MAIN_CASTLE ? MAIN_TYPES.includes(c.areaInfo?.type) : c.id == ref.id))

/** The supply castle and what goes to the camp, or the status key of what the setup still lacks. */
function readSetup() {
    const setup = options.bladeSetup
    if (!setup?.castle || setup.castle.kingdom == 10)
        return { problem: "statusBladeSetCastle" }
    const castle = castleOf(setup.castle)
    if (!castle)
        return { problem: "statusBladeCastleGone" }
    const troopWods = bladeCoastWods(units, setup.troop)
    if (!troopWods.length)
        return { problem: "statusBladeSetTroop" }
    const tools = ["wall", "gate", "ranged"].map(role => ({ role, wods: bladeCoastWods(units, setup.tools?.[role]) }))
    if (tools.some(t => !t.wods.length))
        return { problem: "statusBladeSetTools" }
    return { castle, loadout: { troopWods, tools: tools.map(t => ({ ...t, slots: slotsOf(unitByWod.get(t.wods[0])) })) } }
}

/** What `castle` holds of `wods`, best level first. */
const heldIn = castle => wods => (castle.unitInventory ?? [])
    .filter(u => wods.includes(Number(u.unitInfo?.wodID)) && u.amount > 0)
    .map(u => [Number(u.unitInfo.wodID), Number(u.amount)])
    .sort((a, b) => (Number(unitByWod.get(b[0])?.level) || 0) - (Number(unitByWod.get(a[0])?.level) || 0))
const castleLabel = castle => String(castle.name ?? castle.id)
const unitLabel = wod => String(unitByWod.get(wod)?.type ?? wod)
const listOf = I => I.map(([wod, n]) => `${n} ${unitLabel(wod)}`).join(", ")

// ---- Memory across restarts ----
/** Takes the event's end in: a different event forgets the maps closed in the last one. */
function noteEvent(info) {
    const endsAt = Date.now() + (Number(info?.RS) > 0 ? Number(info.RS) * SECOND : 7 * 24 * HOUR)
    const kept = Number(memory.get("eventEndsAt")) > Date.now() ? memory.get("closedMaps") : undefined
    for (const mid of Array.isArray(kept) ? kept : [])
        if (plan.MAP_ORDER.includes(Number(mid)))
            closed.add(Number(mid))
    memory.set("eventEndsAt", endsAt)
    memory.set("closedMaps", [...closed])
}

// ---- Status ----
function showCard(card) {
    status.bladeCoast = card
    parentPort.postMessage([ActionType.StatusUser, status])
}
function clearCard() {
    if (status.bladeCoast === undefined)
        return
    status.bladeCoast = undefined
    parentPort.postMessage([ActionType.StatusUser, status])
}
const cardAttack = () => attackOut && { island: attackOut.island, level: attackOut.level, kraken: attackOut.kraken, sentAt: attackOut.sentAt, endsAt: attackOut.endsAt }
function report(mid, camp, loadout, phase) {
    const map = coastMaps.get(mid)
    phase ??= plan.phaseOf({ mid, map, camp, loadout, attackOut, stopped, shortest, unitByWod })
    showCard(plan.statusOf({ mid, map, camp, phase, attackOut: cardAttack(), shortest }))
    reportStatus(stopped ? "stopped" : "running", stopped ? "statusBladeStopped" : "statusBladePlaying", { level: plan.MAP_ORDER.indexOf(mid) + 1 })
}

/** Every map is done, or the game says the event is over for this player: the runner switches the plugin off. */
function finish(logKey, reason) {
    over = true
    console.log(logKey)
    clearCard()
    reportStatus("stopped", "statusBladeDone")
    finishPlugin(__filename, reason)
    return undefined
}

// ---- Joining a map ----
async function join(mid) {
    const main = castles.find(c => c.kingdomID == 0 && c.areaInfo?.type == AreaType.mainCastle)
    const needs = []
    const minLevel = Number(campCost?.minLevel ?? 30)
    if (!(Number(playerInfo.level) >= minLevel))
        needs.push("bladeNeedsLevel", minLevel)
    for (const [field, key, have] of [["costWood", "bladeWood", main?.wood], ["costStone", "bladeStone", main?.stone], ["costFood", "bladeFood", main?.food]])
        if (!(Number(have) >= Number(campCost?.[field] ?? 0)))
            needs.push(key, Number(campCost?.[field] ?? 0))
    if (!(Number(resources.coins) - Number(campCost?.costC1 ?? 0) >= coinFloor))
        needs.push("bladeCoins", Number(campCost?.costC1 ?? 0) + coinFloor)
    if (needs.length) {
        once("join", "warn", "bladeNotReadyToJoin", ...needs)
        return false
    }
    await pause(2500, 6000)
    // Choosing the camp and travelling move the player, so they wait their turn with the other plugins' castle work.
    const outcome = await setCastle(undefined, () => chooseAndTravel(mid)).catch(error => ({ problem: String(error?.message ?? error) }))
    forgetCurrentCastle()
    if (outcome.problem == "EVENT_ALREADY_ENDED")
        return finish("bladeEventOver", "eventOver")
    if (outcome.problem) {
        console.debug("[blade] csc refused", outcome.problem)
        once("join", "warn", "bladeJoinRefused")
        return false
    }
    forget("join")
    logDone("bladeJoined")
    return true
}

async function chooseAndTravel(mid) {
    const chosen = await send("csc", { ID: plan.CAMP_ID, PWR: 0, OC2: 0, SID: mid })
    if (chosen.result !== 0)
        return { problem: problemOf(chosen.result) }
    // The game opens the player's next level itself (asked for 28 after 22 it opened 27, per Lazy Lord), so the
    // travel goes to the map it opened.
    for (const m of plan.MAP_ORDER.filter(m => !closed.has(m))) {
        const read = await readMap(m)
        if (read.camp && !read.camp.won.has(coastMaps.get(m).end)) {
            await pause(2500, 6000)
            const travelled = await send("sje", { MID: m })
            if (travelled.result !== 0)
                console.debug("[blade] sje refused", problemOf(travelled.result))
            break
        }
    }
    return {}
}

async function closeMap(mid) {
    await pause(2500, 6000)
    const outcome = await setCastle(undefined, () => send("tfm", { MID: mid })).catch(error => ({ result: String(error?.message ?? error) }))
    forgetCurrentCastle()
    if (problemOf(outcome.result) == "EVENT_ALREADY_ENDED")
        return finish("bladeEventOver", "eventOver") ?? false
    if (outcome.result !== 0) {
        console.debug("[blade] tfm refused", problemOf(outcome.result))
        once("close", "warn", "bladeCloseRefused")
        return false
    }
    forget("close")
    closed.add(mid)
    if (!dryRun)
        memory.set("closedMaps", [...closed])
    attackOut = undefined
    logDone("bladeMapClosed", plan.MAP_ORDER.indexOf(mid) + 1)
    return true
}

// ---- Skips ----
/** Spends skips on a trip still at sea (`msm`, TT 1 troops, 2 goods). True when one went. */
async function skipTrip(mid, seconds, troops) {
    if (!useSkips || !(seconds > 0) || Date.now() < skipsOutUntil)
        return false
    let left = seconds, used = false
    while (left > 0) {
        const skip = spendSkip(left)
        if (skip == undefined) {
            skipsOutUntil = Date.now() + 30 * MINUTE
            return used
        }
        if (used)
            await pause(1500, 3000)
        const { result } = await send("msm", { MID: mid, TT: troops ? 1 : 2, MST: skip })
        if (result !== 0) {
            if (skipRefused(skip, result))
                continue
            console.debug("[blade] msm refused", problemOf(result))
            return used
        }
        used = true
        left -= MinuteSkipType[skip] * 60
    }
    return used
}

/** One skip on a building under way (`msb`). True when it went. */
async function skipBuilding(building) {
    const left = layoutKit.timeLeft(building)
    if (!useSkips || !(left > 0) || Date.now() < skipsOutUntil)
        return false
    for (let tries = 0; tries < 3; tries++) {
        const skip = spendSkip(left)
        if (skip == undefined) {
            skipsOutUntil = Date.now() + 30 * MINUTE
            return false
        }
        const { result } = await send(...builder.skip(building, skip))
        if (result === 0)
            return true
        if (!skipRefused(skip, result))
            return false
    }
    return false
}

// ---- The camp ----
/**
 * One camp step inside the camp: `{ built }` after a step, `{ waitSeconds }` while a building is under way,
 * `{ needGoods }` when the camp can't pay, `{ blocked }` when it can't go on.
 */
async function buildInCamp(mid, need) {
    const entered = await enterCamp(mid)
    if (entered.problem)
        return { blocked: "bladeCampRefused" }
    const step = plan.campStep(need, entered.layout, mid, layoutKit, leftChests)
    if (step.kind == "chest") {
        await pause(2500, 6000)
        const { result } = await send(...builder.chest(step.building))
        if (result === 0) {
            logDone("bladeChestCollected")
            return { built: true }
        }
        leftChests.add(step.building.objectID)
        return { built: false, again: true }
    }
    if (step.kind == "busy") {
        // Skips one after another a few seconds apart, as a player clicks them, reading the building again after each.
        let busy = step.building, skipped = false
        for (let clicks = 0; busy && clicks < 40; clicks++) {
            await pause(800, 1500)
            if (!await skipBuilding(busy))
                break
            skipped = true
            const again = await enterCamp(mid)
            if (again.problem)
                break
            busy = again.layout.buildings.find(b => b.objectID == busy.objectID && (b.state == layoutKit.BUILD_IN_PROGRESS || b.state == layoutKit.UPGRADE_IN_PROGRESS))
        }
        if (!busy || skipped)
            return { built: true }
        return { waitSeconds: layoutKit.timeLeft(busy) }
    }
    if (step.kind == "noRoom")
        return { blocked: "bladeNoRoom" }
    const row = step.row
    const cost = plan.costOf(row)
    if (entered.wood < cost.wood || entered.stone < cost.stone)
        return { needGoods: cost }
    await pause(2500, 6000)
    const sent = await send(...(step.kind == "expansion" ? builder.expansion(step.spot) :
        step.kind == "build" ? builder.build(row, step.spot) : builder.upgrade(step.building)))
    if (sent.result !== 0) {
        console.debug("[blade] build refused", problemOf(sent.result))
        return { blocked: "bladeBuildRefused" }
    }
    if (step.kind == "expansion") logDone("bladeExpansionBought")
    else if (step.kind == "upgrade") logDone("bladeUpgraded", String(row.name), " ", Number(row.level))
    else logDone("bladeBuilt", String(row.name))
    return { built: true }
}

// ---- Goods, troops and tools ----
async function sendGoods(mid, camp, supply, opts) {
    const others = castles.filter(c => c !== supply && c.kingdomID != 10 && c.getProductionData)
    const trip = plan.goodsPlan(camp, [supply, ...others], opts)
    if (!trip)
        return false
    if (!trip.castle) {
        once("goods", "warn", "bladeNoGoodsToSend")
        return false
    }
    await pause(2500, 6000)
    const { result } = await goodsTransferTurn(() => send("tgt", { MID: mid, SCID: trip.castle.id, KID: trip.castle.kingdomID, G: trip.G }))
    if (result !== 0) {
        console.debug("[blade] tgt refused", problemOf(result))
        once("goods", "warn", "bladeGoodsRefused")
        return false
    }
    forget("goods")
    logDone("bladeGoodsSent", castleLabel(trip.castle), " ", trip.G.map(([k, n]) => `${n} ${k}`).join(", "))
    return true
}

/** One `tut` trip from the supply castle. `{ tools }` when it went, false when nothing did. */
async function sendTroopsAndTools(mid, setup, refill) {
    await send("dcl", { CD: 1 })
    const { I, short } = plan.loadTrip(refill, setup.loadout, heldIn(setup.castle))
    for (const gap of short)
        once(`short:${gap.wod ?? "troops"}`, "warn", "troops" in gap ? "bladeShortTroops" : "bladeShortTools", castleLabel(setup.castle), " ", "troops" in gap ? gap.troops : `${gap.tool} ${unitLabel(gap.wod)}`)
    if (!I.length)
        return false
    const fee = plan.travelFee(I, unitByWod)
    if (!(Number(resources.coins) - fee >= coinFloor)) {
        once("troops", "warn", "bladeCoinFloor", fee + coinFloor)
        return false
    }
    await pause(2500, 6000)
    const { result } = await troopTransferTurn(() => send("tut", { MID: mid, SCID: setup.castle.id, KID: setup.castle.kingdomID, I }))
    if (result !== 0) {
        // A refused transfer isn't asked again for an hour.
        transfersRefusedUntil = Date.now() + HOUR
        console.debug("[blade] tut refused", problemOf(result))
        once("troops", "warn", "bladeTroopsRefused")
        return false
    }
    forget("troops")
    logDone("bladeTroopsSent", listOf(I))
    return { tools: I.some(([wod]) => !isTroop(unitByWod.get(wod))) }
}

// ---- The warship ----
async function payPort(mid, port) {
    await pause(2500, 6000)
    // The game answers a paid port with the map's new state, or with ule when it refuses (Lazy Lord). No ule in time is
    // read from the next map state, so nothing is sent twice blindly.
    const { result } = await send("ule", { SCID: -1, SKID: 0, W: port.wood, S: port.stone, F: 0, C1: 0, IID: port.port.priceID, SC: 0 })
    if (result === 0) {
        forget("ship")
        logDone("bladeShipUpgraded")
        return STEP_WAIT
    }
    if (result !== "TIMED_OUT")
        once("ship", "warn", "bladeShipRefused")
    return MIN_WAIT
}

// ---- Attacks ----
xtHandler.on("mrm", obj => {
    if (attackOut && Number(obj?.MID) == attackOut.movementID)
        attackOut.endsAt = Math.min(attackOut.endsAt, Date.now())
})

async function attack(mid, node, setup) {
    const map = coastMaps.get(mid)
    const outcome = await setCastle(undefined, async () => {
        await pause(2500, 6000)
        const info = await send("tai", { MID: mid, NID: node.id })
        if (info.result !== 0)
            return { problem: problemOf(info.result) }
        if (Number(info.reply?.CD) > 0)
            return { cooldown: Number(info.reply.CD) }
        await send("gas", {})
        await pause(2500, 6000)
        const inventory = new Map((info.reply?.gui?.I ?? []).map(([wod, n]) => [Number(wod), Number(n) || 0]))
        const A = plan.buildWaves(node.level, inventory, setup.loadout, { playerLevel: Number(playerInfo.level) || 0, unitByWod })
        return send("thm", { LID: plan.BUILT_IN_COMMANDER, BT: 2, BPC: 0, MID: mid, NID: node.id, PTT: 0, A })
    }).catch(error => ({ problem: String(error?.message ?? error) }))
    if (outcome.cooldown)
        return Math.max(MIN_WAIT, outcome.cooldown * SECOND + 15 * SECOND)
    if (outcome.dry)
        return MAX_WAIT
    const kraken = node.id == map.end
    const sentAt = Date.now()
    if (outcome.result == "TIMED_OUT") {
        // It may well be on its way, so no second one for a while: one attack at a time.
        attackOut = { island: node.id, level: node.level, kraken, movementID: NaN, sentAt, endsAt: sentAt + MAX_WAIT }
        return MAX_WAIT
    }
    const problem = outcome.problem ?? problemOf(outcome.result)
    if (problem) {
        console.debug("[blade] attack refused", problem)
        if (problem == "WONT_REACH_IN_TIME") {
            stopped = true
            console.log("bladeEventEnding")
            return HOUR
        }
        once("attack", "warn", "bladeAttackRefused", problem)
        return MAX_WAIT
    }
    forget("attack")
    const M = outcome.reply?.TM?.M
    const travel = M ? (Number(M.TT) - Number(M.PT)) * SECOND : 5 * MINUTE
    attackOut = { island: node.id, level: node.level, kraken, movementID: Number(M?.MID), sentAt, endsAt: sentAt + travel + 10 * SECOND }
    if (Number.isFinite(attackOut.movementID))
        bladeMovements.note(attackOut.movementID, sentAt + travel)
    logDone(kraken ? "bladeAttackedKraken" : "bladeAttacked", node.id)
    return Math.max(MIN_WAIT, Math.min(MAX_WAIT, travel + 20 * SECOND))
}

/** The attack this run sent is over: won, or lost (twice on one island stops the plugin for the event). */
function attackResult(mid, camp) {
    const { island, kraken } = attackOut
    attackOut = undefined
    if (camp.won.has(island)) {
        losses.delete(island)
        console.log(kraken ? "bladeKrakenWon" : "bladeIslandWon", island)
        return
    }
    const lost = (losses.get(island) ?? 0) + 1
    losses.set(island, lost)
    if (lost < 2)
        return console.warn("bladeIslandLost", island)
    stopped = true
    console.error("bladeDefeatedTwice", island)
}

// ---- One pass ----
async function cycle() {
    const before = dryWrites
    const wait = await pass()
    if (over || wait === undefined)
        return undefined
    return dryWrites > before ? Math.max(wait, MAX_WAIT) : wait
}

async function pass() {
    if (over || !eventGate.isActive(EVENT))
        return undefined
    if (stopped)
        return HOUR
    const setup = readSetup()
    if (setup.problem) {
        reportStatus("waiting", setup.problem)
        return MAX_WAIT
    }

    // The map being played: the first open one whose Kraken isn't beaten. A beaten one is closed and the next level
    // joined; on the last map the plugin is done.
    let mid, camp
    for (const m of plan.MAP_ORDER) {
        if (closed.has(m))
            continue
        const read = await readMap(m)
        if (read.problem) {
            console.debug("[blade] tmp refused", m, read.problem)
            return MAX_WAIT
        }
        if (!read.camp)
            continue
        if (!read.camp.won.has(coastMaps.get(m).end)) {
            mid = m
            camp = read.camp
            break
        }
        if (m == plan.MAP_ORDER.at(-1))
            return finish("bladeMapsDone", "done")
        if (!await closeMap(m))
            return over ? undefined : MAX_WAIT
    }
    if (!camp) {
        const next = plan.MAP_ORDER[Math.max(-1, ...[...closed].map(m => plan.MAP_ORDER.indexOf(m))) + 1]
        if (next === undefined)
            return finish("bladeMapsDone", "done")
        reportStatus("running", "statusBladeJoining", { level: plan.MAP_ORDER.indexOf(next) + 1 })
        const joined = await join(next)
        return over ? undefined : joined ? STEP_WAIT : 3 * MAX_WAIT
    }
    const map = coastMaps.get(mid)
    report(mid, camp, setup.loadout)

    if (camp.troopTrip.seconds > 0 && await skipTrip(mid, camp.troopTrip.seconds, true))
        return STEP_WAIT
    if (camp.goodsTrip.seconds > 0 && await skipTrip(mid, camp.goodsTrip.seconds, false))
        return STEP_WAIT

    // 1. The camp: storehouses, tents, decorations, and expansions for room.
    const need = plan.campNeed(camp, mid)
    if (need) {
        const outcome = await setCastle(undefined, () => buildInCamp(mid, need)).catch(error => ({ blocked: "bladeCampRefused", error }))
        if (outcome.built || outcome.again) {
            forget("build")
            return quickWait()
        }
        if (outcome.blocked)
            once("build", "warn", outcome.blocked)
        if (outcome.needGoods && camp.goodsTrip.seconds == 0) {
            await sendGoods(mid, camp, setup.castle, { need: outcome.needGoods })
            return STEP_WAIT
        }
        if (outcome.waitSeconds && camp.goodsTrip.seconds == 0 && await sendGoods(mid, camp, setup.castle))
            return STEP_WAIT
        return Math.max(MIN_WAIT, outcome.waitSeconds ? Math.min(MAX_WAIT, outcome.waitSeconds * SECOND + 30 * SECOND) : MAX_WAIT)
    }

    // 2. Goods while the warship still needs them; food always, since troops eat it. Then the next port, paid in full.
    const port = plan.nextPort(map, camp, partpay)
    if (camp.goodsTrip.seconds == 0 && await sendGoods(mid, camp, setup.castle, { foodOnly: !port }))
        return STEP_WAIT
    if (port && !attackOut && camp.wood >= port.wood && camp.stone >= port.stone)
        return payPort(mid, port)

    // 3. One attack at a time: one from before a restart shows as soldiers counted but not in the camp.
    const soldiers = plan.soldiersIn(camp.inventory, unitByWod)
    if (!attackOut && camp.soldiersCounted - soldiers > 0) {
        const landsAt = Math.min(...bladeMovements.underway().map(m => m.landsAt))
        once("attack", "log", "bladeAttackUnderWayWait")
        return Number.isFinite(landsAt) ? Math.max(MIN_WAIT, Math.min(MAX_WAIT, landsAt - Date.now() + 15 * SECOND)) : MIN_WAIT
    }
    if (attackOut) {
        if (Date.now() < attackOut.endsAt)
            return Math.min(MAX_WAIT, Math.max(MIN_WAIT, attackOut.endsAt - Date.now() + 15 * SECOND))
        attackResult(mid, camp)
        if (stopped) {
            report(mid, camp, setup.loadout, "stopped")
            return HOUR
        }
    }

    // 4. Troops and tools, when below the minimum or short of tools for the next island.
    const islands = plan.attackable(map, camp, shortest)
    const toolsNeeded = islands[0] ? plan.toolsForIsland(islands[0].level, setup.loadout.tools) : setup.loadout.tools.map(() => 0)
    const toolsHave = setup.loadout.tools.map(t => plan.amountOf(camp.inventory, t.wods))
    // After a restart a camp already holding a first lot of each tool has had it.
    if (toolsHave.every(n => n >= plan.FIRST_TOOLS))
        toolsSentOnce.add(mid)
    const refill = plan.refillPlan({ camp, mid, soldiers, toolsHave, toolsNeeded, firstLot: !toolsSentOnce.has(mid) })
    if (refill.short) {
        if (refill.campFull)
            once("troops", "warn", "bladeCampFullNoTools")
        if (camp.troopTrip.seconds == 0 && Date.now() >= transfersRefusedUntil && (refill.soldiers > 0 || refill.tools.some(n => n > 0))) {
            const sent = await sendTroopsAndTools(mid, setup, refill)
            if (sent) {
                if (sent.tools)
                    toolsSentOnce.add(mid)
                return STEP_WAIT
            }
        }
        once("attack", "log", "bladeWaitingForTroops")
        return camp.troopTrip.seconds > 0 ? Math.max(MIN_WAIT, Math.min(MAX_WAIT, camp.troopTrip.seconds * SECOND + 15 * SECOND)) : MAX_WAIT
    }

    // 5. The first island open now.
    const node = islands[0]
    if (!node) {
        const cooling = [...camp.cooldowns.values()]
        once("attack", "log", "bladeNothingToAttack")
        return cooling.length ? Math.max(MIN_WAIT, Math.min(MAX_WAIT, Math.min(...cooling) * SECOND + 15 * SECOND)) : MAX_WAIT
    }
    const wait = await attack(mid, node, setup)
    report(mid, camp, setup.loadout)
    return wait
}

eventGate.onStop(EVENT, () => {
    over = true
    clearCard()
})

reportStatus("waiting", "statusBladeWaitingForEvent")
events.once("load", () => eventGate.whenActive(EVENT).then(info => {
    if (over)
        return
    noteEvent(info)
    chore("bladeCoast", cycle, boxMullerRandom(MINUTE, 90 * SECOND))
}))
