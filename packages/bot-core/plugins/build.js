/**
 * Build: brings each castle of the player's plan to the buildings, levels and counts it names. In a castle it collects
 * an expansion's chest, finishes builds with time skips and buys expansions where the player ticked those, then
 * upgrades and builds, one step a look, reading the castle again before each step. It never pays with rubies: every
 * request goes through buildPlan.mayLeave first. The decisions live in buildPlan.js; this file reads the game and
 * sends. Ported from Lazy Lord's be/plugins/build.js (MIT). The requests are in docs/protocol/build.md.
 */
if (require("node:worker_threads").isMainThread) {
    const paths = require("../paths.js")
    const readOr = (read, fallback) => { try { return read() } catch { return fallback } }
    const lang = readOr(() => require(require("node:path").join(paths.lang, "en.json")), {})
    return module.exports = {
        pluginOptions: [
            // Without the game's data on disk, as when the docs are generated, the plan offers nothing.
            readOr(() => require("../buildPlan.js").buildPlanOption("plan", lang), { type: "BuildPlan", key: "plan", buildings: [], default: [] }),
            { type: "SkipTypes", key: "skipTypes" },
            { type: "Number", key: "coinFloor", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 100_000 },
            { type: "Number", key: "resourceFloor", min: 0, max: 2_147_483_647, step: 100, default: 0 },
            { type: "Checkbox", key: "dryRunBuilds", default: false },
        ],
    }
}

const path = require("node:path")
const { events, botConfig, playerInfo } = require("../ggeBot.js")
const err = require("../err.json")
const { castles, resources, setCastle, ClientCommands, AreaType } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { pause, boxMullerRandom } = require("../pacing.js")
const { refusalMemory } = require("../refusals.js")
const { spendSkip, skipRefused, MinuteSkipType } = require("./skips.js")
const { requests } = require("../castleBuilder.js")
const { statusReporter } = require("../pluginStatus.js")
const { MAIN_CASTLE } = require("../legacyOptions.js")
const { castleName } = require("../towers.js")
const plan = require("../buildPlan.js")

/** Read on every look, because the runner changes it in place when the player saves. */
const options = botConfig.plugins[path.basename(__filename, ".js")] ?? {}
const reportStatus = statusReporter(__filename)
reportStatus("waiting", "statusBuildStarting")

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE
/** A castle waiting for resources, blocked or done is looked at this often: each look is a request and resources come in slowly. */
const SLOW_WAIT = HOUR
const NO_DATA_WAIT = 10 * MINUTE
/** A step the game refused is left alone this long. */
const REFUSED_HOLD = HOUR
const SKIPS_OUT_HOLD = 30 * MINUTE
/** The castle is read again unless the bot read it this recently. */
const FRESH_MS = 5 * SECOND
const REPLY_TIMEOUT_MS = 10 * SECOND
const INVALID_OBJECT_ID = 5
const nextStepWait = () => boxMullerRandom(5 * SECOND, 10 * SECOND)
const afterRefusalWait = () => boxMullerRandom(30 * SECOND, 60 * SECOND)
const afterBuildEnds = seconds => seconds * SECOND + boxMullerRandom(10 * SECOND, 12 * SECOND)

const asNumber = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback
const dryRun = () => Boolean(options.dryRunBuilds)

// ---- What this run knows ----
/** Castles whose plan is all done, by key. They aren't looked at again until the plan changes. */
const completed = new Set()
const nextLook = new Map()
/** What the last look at each castle came to: "acted", "dry", "resources", "queue", "blocked", "noData" or "missing". */
const outcomes = new Map()
const held = refusalMemory({ round: REFUSED_HOLD, max: REFUSED_HOLD })
/** Chests the game refused, by castle key: not asked for again. */
const leftChests = new Map()
let skipsOutUntil = 0

const said = new Map()
/** A log line only when it is new for `key`, so a waiting castle doesn't repeat itself every look. */
function once(key, level, ...parts) {
    const text = JSON.stringify(parts)
    if (said.get(key) === text)
        return
    said.set(key, text)
    console[level](...parts)
}
const forget = key => said.delete(key)
const problemOf = result => result === undefined ? "TIMED_OUT" : err[result] ?? String(result)

/**
 * Sends `cmd` and waits 10 s for its reply: `{ reply, result }`, with no result when none came. Nothing leaves that
 * buildPlan.mayLeave refuses. A dry run logs a request that changes something and answers `{ dry: true }`.
 */
function send(cmd, payload) {
    if (!plan.mayLeave(cmd, payload)) {
        console.error("buildNotSent", cmd)
        return Promise.resolve({ result: "NOT_SENT" })
    }
    if (dryRun() && !plan.READS.has(cmd)) {
        once(`dry:${cmd}:${JSON.stringify(payload)}`, "log", "buildDryRun", cmd, " ", JSON.stringify(payload))
        return Promise.resolve({ dry: true })
    }
    return ask(cmd, payload, REPLY_TIMEOUT_MS)
}

// ---- Reading the castle ----
const MAIN_TYPES = [AreaType.mainCastle, AreaType.externalKingdom]
const castleOf = ref => castles.find(c => c.kingdomID == ref.kingdom && (ref.id == MAIN_CASTLE ? MAIN_TYPES.includes(c.areaInfo?.type) : c.id == ref.id))
const keyOf = ref => `${ref.kingdom}:${ref.id}`
const labelOf = castle => castle.areaInfo ? castleName(castle) : String(castle.id)

/** The castle as buildPlan.js reads it. @returns {import("../buildPlan.js").CastleView} */
const viewOf = castle => ({
    kingdomID: castle.kingdomID,
    areaType: castle.areaInfo?.type,
    layout: castle.layout,
    slots: castle.buildingSlots,
    stock: { wood: castle.wood, stone: castle.stone, coal: castle.coal, oil: castle.oil, glass: castle.glass, iron: castle.iron, aqua: castle.aqua },
    storage: {
        wood: castle.getProductionData?.maxAmountWood, stone: castle.getProductionData?.maxAmountStone, coal: castle.getProductionData?.maxAmountCoal,
        oil: castle.getProductionData?.maxAmountOil, glass: castle.getProductionData?.maxAmountGlass, iron: castle.getProductionData?.maxAmountIron,
        aqua: castle.getProductionData?.maxAmountAqua,
    },
})

/** @returns {import("../buildPlan.js").Context} */
const contextFor = key => ({
    player: { level: playerInfo.playerLevel, legendLevel: playerInfo.legendLevel },
    coins: resources.coins,
    currencies: resources,
    coinFloor: asNumber(options.coinFloor, 100_000),
    resourceFloor: asNumber(options.resourceFloor, 0),
    held: what => Boolean(held.holding(`${key}:${what}`)),
    leftChests: leftChests.get(key) ?? new Set(),
    skips: !dryRun() && Date.now() >= skipsOutUntil,
})

// ---- The steps ----
/**
 * Skips the build until it is done, one skip after another a few seconds apart, as a player clicks them. True when a
 * skip was used. Out of skips, none are tried again for half an hour.
 */
async function skipBuild(building, seconds) {
    let left = seconds, used = false
    while (left > 0) {
        const skip = spendSkip(left, options.skipTypes)
        // spendSkip says so itself when there is none left.
        if (skip == undefined) {
            skipsOutUntil = Date.now() + SKIPS_OUT_HOLD
            break
        }
        if (used)
            await pause(1500, 3000)
        const { result } = await send(...requests.skip(building, skip))
        if (result === 0) {
            used = true
            left -= MinuteSkipType[skip] * 60
            continue
        }
        if (skipRefused(skip, result))
            continue
        // INVALID_OBJECT_ID after a skip of ours: the game finished the build a little before the bot's count.
        if (!(used && result === INVALID_OBJECT_ID)) {
            console.debug("[build] msb refused", problemOf(result))
            skipsOutUntil = Date.now() + SKIPS_OUT_HOLD
        }
        break
    }
    return used
}

const REASON_KEY = {
    notPossible: "buildReasonNotPossible", needsLevel: "buildReasonNeedsLevel", needsLegendLevel: "buildReasonNeedsLegendLevel",
    notInKingdom: "buildReasonNotInKingdom", notInCastleType: "buildReasonNotInCastleType", upgradeOnlyMissing: "buildReasonUpgradeOnlyMissing",
    atLimit: "buildReasonAtLimit", overStorage: "buildReasonOverStorage", noSpace: "buildReasonNoSpace",
}

/** Says why each unfinished row of a resting castle didn't act, once until it changes. */
function sayNotes(key, label, rest) {
    for (const note of rest.notes) {
        const noteKey = `${key}:${note.building}`
        if (note.state == "blocked" && note.reason == "noSpace")
            once(noteKey, "warn", "buildNoRoom", note.building, "buildIn", label, "buildHas", note.have, "buildOf", note.want)
        else if (note.state == "blocked")
            once(noteKey, "warn", "buildBlocked", note.building, "buildIn", label, "buildBecause", REASON_KEY[note.reason])
        else if (note.state == "waiting")
            once(noteKey, "log", "buildWaitingForResources", note.building, "buildIn", label)
    }
    if (rest.expansion?.state == "blocked")
        once(`${key}:expansion`, "warn", "buildExpansionBlocked", label, "buildBecause", REASON_KEY[rest.expansion.reason])
}

/**
 * One look at a castle from inside it: at most one step. Resolves to `{ waitMs, outcome, rest? }`, the time until the
 * castle is worth another look and what the look came to. `rest` is buildPlan.lookAt's answer when nothing was sent.
 */
async function lookInside(castle, castlePlan, key) {
    if (!(Date.now() - (castle.layoutAt ?? 0) <= FRESH_MS) && await ClientCommands.joinCastle(castle.id, castle.kingdomID) != 0)
        return { waitMs: NO_DATA_WAIT, outcome: "noData" }
    const label = labelOf(castle)
    const step = plan.lookAt(viewOf(castle), castlePlan, contextFor(key))
    /** What the castle shows after a step of ours is always read again. */
    const stale = () => { castle.layoutAt = 0 }
    const dry = { waitMs: SLOW_WAIT, outcome: "dry" }

    switch (step.kind) {
        case "noData":
            return { waitMs: NO_DATA_WAIT, outcome: "noData" }
        case "chest": {
            await pause(1500, 3000)
            const sent = await send(...requests.chest(step.building))
            if (sent.dry)
                return dry
            stale()
            if (sent.result === 0)
                console.log("buildChestCollected", label)
            else {
                leftChests.set(key, (leftChests.get(key) ?? new Set()).add(step.building.objectID))
                console.debug("[build] etc refused", problemOf(sent.result))
            }
            return { waitMs: boxMullerRandom(3 * SECOND, 6 * SECOND), outcome: "acted" }
        }
        case "skip": {
            const used = await skipBuild(step.building, step.seconds)
            stale()
            if (used)
                console.log("buildSkipped", plan.nameOf(step.building), "buildIn", label)
            return { waitMs: boxMullerRandom(3 * SECOND, 6 * SECOND), outcome: "acted" }
        }
        case "expansion": {
            await pause(1500, 3000)
            const sent = await send(...requests.expansion(step.spot))
            if (sent.dry)
                return dry
            stale()
            if (sent.result !== 0) {
                held.refused(`${key}:expansion`, "refused")
                console.warn("buildExpansionRefused", label, " ", problemOf(sent.result))
                return { waitMs: afterRefusalWait(), outcome: "blocked" }
            }
            held.accepted(`${key}:expansion`)
            console.log("buildExpansionBought", label)
            return { waitMs: nextStepWait(), outcome: "acted" }
        }
        case "queueFull":
            return { waitMs: step.seconds === undefined ? NO_DATA_WAIT : afterBuildEnds(step.seconds), outcome: "queue" }
        case "build":
        case "upgrade": {
            const building = step.entry.building
            const sent = await send(...(step.kind == "build" ? requests.build(step.row, step.spot) : requests.upgrade(step.building, step.command)))
            if (sent.dry)
                return dry
            stale()
            if (sent.result !== 0) {
                held.refused(`${key}:${building}`, "refused")
                console.warn("buildRefused", building, "buildIn", label, " ", problemOf(sent.result))
                return { waitMs: afterRefusalWait(), outcome: "blocked" }
            }
            held.accepted(`${key}:${building}`)
            forget(`${key}:${building}`)
            if (step.kind == "build")
                console.log("buildStarted", building, "buildIn", label)
            else
                console.log("buildUpgradeStarted", building, "buildToLevel", Number(step.row.level), "buildIn", label)
            return { waitMs: nextStepWait(), outcome: "acted" }
        }
        case "rest": {
            sayNotes(key, label, step)
            if (step.done)
                return { outcome: "done", rest: step }
            const busy = step.busySeconds === undefined ? undefined : afterBuildEnds(step.busySeconds)
            return {
                waitMs: busy === undefined ? SLOW_WAIT : step.waiting ? Math.min(busy, SLOW_WAIT) : busy,
                outcome: step.waiting ? "resources" : busy === undefined ? "blocked" : "queue",
                rest: step,
            }
        }
    }
}

// ---- For Build Supply ----
/**
 * After a look that left the castle's plan unfinished, tells listeners of `buildLooked` on the bot's events what the
 * rest of the plan costs: `{ castle, need: { wood, stone }, nothingPayable, waiting, lookAgainIn }`. `waiting` is true
 * when a step waits for resources. A listener may call `lookAgainIn(ms)`, or pass it a promise of one, to bring the
 * castle's next look forward, such as to when the wood and stone it sent arrive. Resolves to the earliest one asked.
 */
async function announce(castle, castlePlan, key, look) {
    if (events.listenerCount("buildLooked") == 0)
        return Infinity
    const view = viewOf(castle), ctx = contextFor(key)
    if (!view.layout)
        return Infinity
    const asked = []
    events.emit("buildLooked", {
        castle, need: plan.supplyNeed(view, castlePlan, ctx), nothingPayable: plan.nothingPayable(view, castlePlan, ctx),
        waiting: look.outcome == "resources", lookAgainIn: ms => asked.push(ms),
    })
    const waits = (await Promise.all(asked)).filter(ms => Number.isFinite(ms) && ms > 0)
    return Math.min(Infinity, ...waits)
}

// ---- The round ----
const STATUS = {
    dry: ["waiting", "statusBuildDryRun"], acted: ["running", "statusBuildWorking"], resources: ["waiting", "statusBuildWaitingResources"],
    queue: ["waiting", "statusBuildWaitingQueue"],
}
function report(castlePlans) {
    const total = castlePlans.length
    const done = castlePlans.filter(p => completed.has(keyOf(p.ref))).length
    if (done == total)
        return reportStatus("stopped", "statusBuildAllDone", { done, total })
    const seen = castlePlans.filter(p => !completed.has(keyOf(p.ref))).map(p => outcomes.get(keyOf(p.ref)))
    const [state, reasonKey] = STATUS[Object.keys(STATUS).find(outcome => seen.includes(outcome))] ?? ["waiting", "statusBuildBlocked"]
    reportStatus(state, reasonKey, { done, total })
}

let planText
/** The saved plan as it is now. A plan that changed is started afresh: what was done or refused under the old one is forgotten. */
function currentPlan() {
    const text = JSON.stringify(options.plan ?? [])
    const read = plan.readPlan(options.plan)
    if (text !== planText) {
        planText = text
        completed.clear()
        nextLook.clear()
        outcomes.clear()
        said.clear()
        for (const row of read.dropped)
            console.warn("buildRowDropped", row.building)
    }
    return read.castles
}

async function cycle(active) {
    const castlePlans = currentPlan()
    if (castlePlans.length == 0) {
        once("plan", "warn", "buildNoPlan")
        reportStatus("waiting", "statusBuildNoPlan")
        return SLOW_WAIT
    }
    for (const castlePlan of castlePlans) {
        const key = keyOf(castlePlan.ref)
        if (!active())
            return
        if (completed.has(key) || (nextLook.get(key) ?? 0) > Date.now())
            continue
        const castle = castleOf(castlePlan.ref)
        if (!castle) {
            // A Berimond camp is new every event, so its rows are left alone once the event is over.
            if (castlePlan.ref.kingdom == plan.BERIMOND) {
                console.debug("[build] Berimond camp gone", key)
                completed.add(key)
                continue
            }
            once(`${key}:missing`, "warn", "buildCastleNotFound", key)
            outcomes.set(key, "missing")
            nextLook.set(key, Date.now() + SLOW_WAIT)
            continue
        }
        let look
        try {
            look = await setCastle(castle, () => lookInside(castle, castlePlan, key))
        } catch (error) {
            console.debug("[build] look failed", key, String(error?.message ?? error))
            look = { waitMs: NO_DATA_WAIT, outcome: "noData" }
        }
        if (look.outcome == "done") {
            completed.add(key)
            console.log("buildPlanDone", labelOf(castle))
            continue
        }
        outcomes.set(key, look.outcome)
        const asked = await announce(castle, castlePlan, key, look)
        nextLook.set(key, Date.now() + Math.min(SLOW_WAIT, look.waitMs, asked))
    }
    report(castlePlans)
    const open = castlePlans.map(p => keyOf(p.ref)).filter(key => !completed.has(key))
    if (open.length == 0) {
        once("plan", "log", "buildAllDone")
        return SLOW_WAIT
    }
    return Math.max(SECOND, Math.min(...open.map(key => nextLook.get(key) ?? 0)) - Date.now())
}

events.once("load", () => {
    const wake = chore("build", cycle, boxMullerRandom(30 * SECOND, 2 * MINUTE))
    // A saved plan is worked from the next look on, not after the hour a finished or waiting plan sleeps.
    const onSave = () => { if (JSON.stringify(options.plan ?? []) !== planText) wake(boxMullerRandom(5 * SECOND, 15 * SECOND)) }
    events.on("configModified", onSave)
    events.once("unload", () => events.off("configModified", onSave))
})

module.exports = { send }
