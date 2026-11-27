/** What a row may send, in the order its choice column lists them: the bot-locale key and the game's code. */
const RESOURCES = [["cartWood", "W"], ["cartStone", "S"], ["cartFood", "F"]]

const optionDefs = [
    {
        type: "Rows", key: "cartSends", default: [], columns: [
            { key: "castle", type: "castle" },
            { key: "targetX", type: "number", min: 0, max: 10_000 },
            { key: "targetY", type: "number", min: 0, max: 10_000 },
            { key: "cartResource", type: "choice", selection: RESOURCES.map(([key]) => key) },
            { key: "cartTotal", type: "number", min: 1, max: 2_000_000_000, default: 100_000 },
            { key: "keep", type: "number", min: 0, max: 2_000_000_000, default: 0 },
        ],
    },
    { type: "Checkbox", key: "cartCoinHorse", default: true },
    { type: "Checkbox", key: "dryRunCarts", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig, playerInfo } = require("../ggeBot.js")
const { ClientCommands, AreaType, castles, movementEvents } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { armyGap } = require("../armyGap.js")
const { boxMullerRandom } = require("../pacing.js")
const { pluginMemory } = require("../pluginMemory.js")
const horses = require("../paths.js").loadItem("horses")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
const memory = pluginMemory(__filename)
reportStatus("waiting", "statusSendResourcesStarting")

// Waits, from Lazy Lord's sendResources.js.
const AFTER_RETURN_MS = 10_000
const NO_FREE_CARTS_MS = 60_000
const RETRY_MS = 10 * 60_000
/** Carts whose way back the bot didn't see are taken as home after twice the way there and this much more. */
const RETURN_FALLBACK_EXTRA_MS = 60_000
/** A castle with no marketplace, a target that can't take resources, or a castle the account lacks: looked at again this often. */
const BLOCKED_MS = 60 * 60_000

/** One cart carries 100 plus the capacity boost, effect 90, in %. Bonuses cmi doesn't list can add more, so each send teaches the real load. */
const BASE_CART_CAPACITY = 100
const CART_CAPACITY_EFFECT = 90
/** The game's movement type of market carts (the client's MOVEMENTTYPE_MARKET). */
const MARKET_MOVEMENT = 4
/** Castles that take resources: a main castle, a capital, an outpost or a kingdom castle. */
const RECEIVING = new Set([AreaType.mainCastle, AreaType.capital, AreaType.outpost, AreaType.externalKingdom])

/**
 * Every usable row as `{ key, ref, x, y, code, total, keep }`, and the problems with the rest. `key` names the row in
 * the plugin's memory: its castle, target and resource. A second row with the same key is left out.
 */
function readRows() {
    const rows = [], problems = new Set(), keys = new Set()
    for (const row of Array.isArray(pluginOptions.cartSends) ? pluginOptions.cartSends : []) {
        const resource = RESOURCES[row?.cartResource]
        const line = { ref: row?.castle, x: Number(row?.targetX), y: Number(row?.targetY), code: resource?.[1], total: Number(row?.cartTotal), keep: Math.max(0, Number(row?.keep) || 0) }
        if (!line.ref || !resource || !Number.isInteger(line.x) || !Number.isInteger(line.y) || !(line.total >= 1)) {
            problems.add("badRow")
            continue
        }
        line.key = `${line.ref.kingdom}:${line.ref.id}>${line.x}:${line.y}:${line.code}`
        if (keys.has(line.key)) {
            problems.add("duplicate")
            continue
        }
        keys.add(line.key)
        rows.push(line)
    }
    return { rows, problems }
}

/** What each row has sent so far, by row key, as the plugin's memory keeps it across runs. */
const sentSoFar = () => memory.get("sent") ?? {}
const sentOf = row => Math.max(0, Number(sentSoFar()[row.key]) || 0)
function addSent(row, amount) {
    memory.set("sent", { ...sentSoFar(), [row.key]: sentOf(row) + amount })
}
/** Forgets the count of a row taken off the plan, so adding it back starts from nothing. */
function forgetRemoved(rows) {
    const kept = sentSoFar()
    const live = Object.fromEntries(Object.entries(kept).filter(([key]) => rows.some(row => row.key == key)))
    if (Object.keys(live).length != Object.keys(kept).length)
        memory.set("sent", live)
}

const castleOf = ref => castles.find(c => c.kingdomID == ref.kingdom && c.id == ref.id && c.areaInfo)
const targetText = row => `${row.x}:${row.y}`

/** When each row may send next, by row key. Unset is now. */
const nextAt = new Map()

/**
 * Cart capacity by castle id, learned from sends. A load that fills every cart only shows a cart takes at least that
 * much, so after one the next send tries one more per cart (`probe`). The first refusal of a try settles it (`settled`).
 */
const learned = new Map()
const settled = new Set()
const probe = new Set()
function cartCapacity(castle, info) {
    const boost = Number(info?.AE?.find(effect => Number(effect?.[0]) == CART_CAPACITY_EFFECT)?.[1]?.[0]) || 0
    return Math.max(learned.get(castle.id) ?? 0, Math.floor(BASE_CART_CAPACITY * (1 + boost / 100)))
}

/** The coin horse that speeds market carts the most, never one paid with rubies, or -1. */
function cartHorse(castle) {
    if (pluginOptions.cartCoinHorse === false)
        return -1
    let best = -1, boost = -Infinity
    for (const id of castle.unlockedHorses ?? []) {
        const horse = horses.find(h => h.wodID == id)
        if (horse && Number(horse.costFactorC1) > 0 && !(Number(horse.costFactorC2) > 0) && Number(horse.marketBoost) > boost) {
            boost = Number(horse.marketBoost)
            best = Number(id)
        }
    }
    return best
}

/** Every castle's carts and goods (cmi), by castle id, or undefined when the game didn't answer. */
async function marketInfo() {
    const { reply, result } = await ask("cmi", { S: 1, KID: -1 })
    if (result !== 0 || !Array.isArray(reply?.C))
        return undefined
    return new Map(reply.C.map(c => [Number(c.CID), c]))
}

/**
 * What stands at the row's target: "ok" for a castle that takes resources, "wrong" for nothing, something else, or the
 * sending castle itself, "unknown" when the map didn't answer. A small square around it is asked for, since the game
 * may not answer for a single empty tile.
 */
async function checkTarget(castle, row) {
    if (row.x == castle.areaInfo?.x && row.y == castle.areaInfo?.y)
        return "wrong"
    try {
        const { areaInfo, result } = await ClientCommands.getAreaInfo(castle.kingdomID, row.x - 3, row.y - 3, row.x + 3, row.y + 3, false, true)
        if (result != 0)
            return "unknown"
        const target = (areaInfo ?? []).find(ai => ai.x == row.x && ai.y == row.y)
        return target && RECEIVING.has(target.type) ? "ok" : "wrong"
    } catch (error) {
        console.debug("sendResourcesTargetCheckFailed", targetText(row), String(error?.message ?? error))
        return "unknown"
    }
}

/**
 * One row's turn: sends a load if it can, and sets when it may send next. A send takes its carts and goods off its
 * castle's line in `market`, so a second row of the castle sees what is left. Resolves to the outcome.
 */
async function sendRow(row, market, dryRun) {
    const later = ms => nextAt.set(row.key, Date.now() + ms)
    const castle = castleOf(row.ref)
    if (!castle) {
        later(BLOCKED_MS)
        return { kind: "noCastle" }
    }
    if (!market) {
        later(RETRY_MS)
        return { kind: "noAnswer" }
    }
    const info = market.get(castle.id)
    if (!(Number(info?.TC) > 0)) {
        later(BLOCKED_MS)
        return { kind: "noMarket" }
    }
    const freeCarts = Number(info.AC) || 0
    if (freeCarts <= 0) {
        later(NO_FREE_CARTS_MS)
        return { kind: "noCarts" }
    }
    const remaining = row.total - sentOf(row)
    const available = Math.floor(Number(info[row.code]) || 0) - row.keep
    const perCart = cartCapacity(castle, info)
    const needed = Math.min(freeCarts * perCart, remaining)
    const probing = probe.has(castle.id) && !settled.has(castle.id) && remaining > freeCarts * perCart && available >= freeCarts * (perCart + 1)
    const amount = probing ? Math.min(freeCarts * (perCart + 1), remaining) : needed
    if (available < needed) {
        later(RETRY_MS)
        return { kind: "short", row }
    }
    const target = await checkTarget(castle, row)
    if (target != "ok") {
        later(target == "wrong" ? BLOCKED_MS : RETRY_MS)
        return { kind: target == "wrong" ? "wrongTarget" : "noAnswer", row }
    }
    const goods = [[row.code, amount]]
    const horse = cartHorse(castle)
    if (dryRun) {
        console.log("dryRunCrm", JSON.stringify({ KID: castle.kingdomID, SID: castle.id, TX: row.x, TY: row.y, HBW: horse, PTT: 0, SD: 0, G: goods }))
        later(boxMullerRandom(28 * 60_000, 32 * 60_000))
        return { kind: "dryRun", row, amount }
    }
    await armyGap()
    const { result, carts, seconds } = await ClientCommands.sendCarts(castle, row.x, row.y, horse, goods).catch(error => ({ result: String(error?.message ?? error) }))
    if (result !== 0 && probing) {
        settled.add(castle.id)
        probe.delete(castle.id)
        later(0)
        return { kind: "probed" }
    }
    if (result !== 0) {
        console.warn("sendResourcesRefused", JSON.stringify({ SID: castle.id, TX: row.x, TY: row.y, G: goods }), " ", err[result] ?? result)
        later(RETRY_MS)
        return { kind: "refused" }
    }
    console.log("sendResourcesSent", JSON.stringify({ SID: castle.id, TX: row.x, TY: row.y, G: goods }))
    if (carts > 0)
        learned.set(castle.id, Math.max(learned.get(castle.id) ?? 0, Math.ceil(amount / carts)))
    if (carts >= freeCarts && !settled.has(castle.id))
        probe.add(castle.id)
    info.AC = freeCarts - (carts || freeCarts)
    info[row.code] = Number(info[row.code]) - amount
    addSent(row, amount)
    later(2 * (seconds || 1800) * 1000 + RETURN_FALLBACK_EXTRA_MS)
    return { kind: sentOf(row) >= row.total ? "rowDone" : "sent", row, amount }
}

/** What the status names when nothing was sent, first first: what the player can fix, then carts on the way, then waits that pass. */
const BLOCKERS = ["noCastle", "noMarket", "wrongTarget", "refused", "short"]
const PASSING = ["noAnswer", "noCarts"]
const STATUS_KEY = {
    noCastle: "statusSendResourcesNoCastle", noMarket: "statusSendResourcesNoMarket", wrongTarget: "statusSendResourcesWrongTarget",
    refused: "statusSendResourcesRefused", short: "statusSendResourcesShort", noAnswer: "statusSendResourcesNoAnswer", noCarts: "statusSendResourcesNoCarts",
}

/** Problems with the rows already logged, so each is said once a session. */
const logged = new Set()
let wake

async function cycle(active) {
    const { rows, problems } = readRows()
    for (const problem of problems)
        if (!logged.has(problem)) {
            logged.add(problem)
            console.warn(problem == "duplicate" ? "sendResourcesDuplicateRow" : "sendResourcesBadRow")
        }
    forgetRemoved(rows)
    if (rows.length == 0) {
        reportStatus("waiting", problems.size ? "statusSendResourcesBadRow" : "statusSendResourcesNoRows")
        return BLOCKED_MS
    }
    const pending = rows.filter(row => sentOf(row) < row.total)
    if (pending.length == 0) {
        reportStatus("stopped", "statusSendResourcesAllDone", { rows: rows.length })
        return BLOCKED_MS
    }

    const due = pending.filter(row => (nextAt.get(row.key) ?? 0) <= Date.now())
    const market = due.length ? await marketInfo() : undefined
    const outcomes = []
    for (const row of due) {
        if (!active())
            return
        outcomes.push(await sendRow(row, market, Boolean(pluginOptions.dryRunCarts)))
    }

    const sent = outcomes.findLast(o => o.kind == "sent" || o.kind == "rowDone")
    const dry = outcomes.find(o => o.kind == "dryRun")
    const blocker = BLOCKERS.map(kind => outcomes.find(o => o.kind == kind)).find(Boolean)
    const passing = PASSING.map(kind => outcomes.find(o => o.kind == kind)).find(Boolean)
    const out = pending.find(row => sentOf(row) > 0 && (nextAt.get(row.key) ?? 0) > Date.now() && !outcomes.some(o => o.row == row))
    if (sent?.kind == "rowDone" && pending.every(row => sentOf(row) >= row.total))
        reportStatus("stopped", "statusSendResourcesAllDone", { rows: rows.length })
    else if (sent?.kind == "rowDone")
        reportStatus("running", "statusSendResourcesRowDone", { target: targetText(sent.row), total: sent.row.total })
    else if (sent)
        reportStatus("running", "statusSendResourcesSent", { amount: sent.amount, target: targetText(sent.row), sent: sentOf(sent.row), total: sent.row.total })
    else if (dry)
        reportStatus("running", "statusSendResourcesDryRun", { amount: dry.amount, target: targetText(dry.row) })
    else if (blocker)
        reportStatus("waiting", STATUS_KEY[blocker.kind], blocker.row ? { target: targetText(blocker.row) } : {})
    else if (out)
        reportStatus("waiting", "statusSendResourcesOnTheWay", { target: targetText(out), sent: sentOf(out), total: out.total })
    else if (passing)
        reportStatus("waiting", STATUS_KEY[passing.kind], {})

    const left = pending.filter(row => sentOf(row) < row.total)
    if (left.length == 0)
        return BLOCKED_MS
    return Math.max(1000, Math.min(...left.map(row => nextAt.get(row.key) ?? 0)) - Date.now())
}

/**
 * The game pushes the carts' way back when they reach their target (crm, docs/protocol/carts.md). A row whose castle
 * the carts head home to, from the row's target, sends again 10 seconds after they arrive.
 */
movementEvents.on("outgoing", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.type != MARKET_MOVEMENT || movement.owner?.ownerID != playerInfo.playerID)
        return
    const home = Number(movement.targetAttack?.extraData?.[0])
    for (const row of readRows().rows) {
        if (castleOf(row.ref)?.id != home || movement.sourceAttack?.x != row.x || movement.sourceAttack?.y != row.y)
            continue
        nextAt.set(row.key, movement.arrivesAt + AFTER_RETURN_MS)
        wake?.(Math.max(0, movement.arrivesAt + AFTER_RETURN_MS - Date.now()))
    }
})

events.once("load", () => {
    wake = chore("sendResources", cycle, boxMullerRandom(2 * 60_000, 4 * 60_000))
    events.on("configModified", () => wake(boxMullerRandom(5000, 10_000)))
})
