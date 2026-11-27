const { commanderMapOption, isSet, assignedTo, writeRanges } = require('../commanderMap.js')

// Always on: the account's commander map is its one setting, which the Account settings tab edits.
if (require('node:worker_threads').isMainThread)
    return module.exports = { force: true, pluginOptions: [commanderMapOption()] }

const path = require('node:path')
const { xtHandler, playerInfo, waitForResult, botConfig, events } = require('../ggeBot.js')
const metrics = require('../metrics.js')
const { ClassTypes : { Lord }, movementEvents, movements, syncMovements } = require('../protocols.js')
const { statusReporter } = require('../pluginStatus.js')

const event = new EventTarget()
/** @type {Array<Number>} */
let usedCommanders = []
/** @type {Array<import("../protocols.js").ClassTypes.Lord>} */
let commanders = []

xtHandler.on("gli", (obj, r) => {
    if (r)
        return
    commanders = Array.from(obj.C).map(e => new Lord(e))
    reportMap()
})

/**
 * Who is offered a commander that comes home, in this order: a reservation, then a plugin its bucket serves first,
 * then every other waiting plugin. Within one tier the first to ask is the first served.
 */
const WAKE_TIERS = ["reserved", "first", "waiting"]

/** Commanders a plugin holds: handed out and neither sent nor freed yet. The safety net leaves them alone. */
const held = new Set()
/** lordID -> when it was marked busy. */
const busySince = new Map()
/** lordID -> when its army should be home, from the march the bot saw leave. */
const homeBy = new Map()
/** lordID -> until when it stays busy after the game refused it as busy (LORD_IS_USED). */
const refusedUntil = new Map()

function freeCommander(lordID) {
    held.delete(lordID)
    homeBy.delete(lordID)
    refusedUntil.delete(lordID)
    busySince.delete(lordID)
    const index = usedCommanders.findIndex(e => e == lordID)
    if (index == -1)
        return

    usedCommanders.splice(index, 1)
    for (const tier of WAKE_TIERS) {
        event.dispatchEvent(new CustomEvent(tier, { detail: lordID }))
        if (usedCommanders.some(e => e == lordID))
            return
    }
}
function useCommander(lordID) {
    if (!usedCommanders.includes(lordID)) {
        usedCommanders.push(lordID)
        busySince.set(lordID, Date.now())
    }

    return lordID
}
/** Marks a commander handed to a plugin, which frees it or sends it. */
function handOut(lordID) {
    useCommander(lordID)
    held.add(lordID)
    return lordID
}

/*
 * The safety net, after Lazy Lord's commander.js. A commander counts as free again only once the bot sees its army
 * come home, so a missed return left it busy until a restart and the plugins had fewer and fewer commanders. Every
 * SAFETY_NET_EVERY_MS a busy commander with no army of the player's out and no plugin holding it is freed:
 * - REFUSED_BUSY_MS after the game refused it as busy (LORD_IS_USED);
 * - HOME_GRACE_MS after its army should have been home, when the bot saw the march leave;
 * - RECLAIM_AFTER_MS after it was marked busy otherwise.
 * Unlike Lazy Lord's, a commander a plugin holds is never freed: our attack queue can hold one longer than 10 minutes
 * (the 30-minute CANT_START_NEW_ARMIES pause, the hourly limit), and freeing it would lend it to a second plugin.
 */
const SAFETY_NET_EVERY_MS = 15_000
const REFUSED_BUSY_MS = 3 * 60_000
const HOME_GRACE_MS = 60_000
const RECLAIM_AFTER_MS = 10 * 60_000
const armyOut = lordID => movements?.some(movement => movement.lord?.lordID == lordID && movement.owner?.ownerID == playerInfo.playerID)
setInterval(() => {
    const now = Date.now()
    for (const lordID of [...usedCommanders]) {
        if (held.has(lordID))
            continue
        if (armyOut(lordID)) {
            busySince.set(lordID, now)
            continue
        }
        const due = refusedUntil.get(lordID) ?? (homeBy.has(lordID) ? homeBy.get(lordID) + HOME_GRACE_MS : (busySince.get(lordID) ?? now) + RECLAIM_AFTER_MS)
        if (now < due)
            continue
        console.debug("commanderReclaimed", lordID)
        metrics.count("bot_commanders_reclaimed_total", {})
        freeCommander(lordID)
    }
}, SAFETY_NET_EVERY_MS).unref?.()

/**
 * After a refusal the bot's view of the marches is wrong, so it asks the game for the movement list (`gam`) this long
 * later, as the game frees a commander a few seconds after its march ends, and at most every MOVEMENT_SYNC_GAP_MS.
 */
const MOVEMENT_SYNC_AFTER_MS = 10_000
const MOVEMENT_SYNC_GAP_MS = 30_000
let movementSyncAt = -Infinity
function resyncMovements() {
    if (!syncMovements || Date.now() + MOVEMENT_SYNC_AFTER_MS - movementSyncAt < MOVEMENT_SYNC_GAP_MS)
        return
    movementSyncAt = Date.now() + MOVEMENT_SYNC_AFTER_MS
    setTimeout(() => syncMovements().catch(error => console.debug("syncMovements", error)), MOVEMENT_SYNC_AFTER_MS).unref?.()
}

/**
 * The plugin that got LORD_IS_USED reports its commander here instead of freeing it. Freed, it went straight to the
 * next waiting plugin, which was refused too, and so on through every plugin. It stays busy REFUSED_BUSY_MS unless
 * its march home frees it sooner.
 */
function commanderRefused(lordID) {
    useCommander(lordID)
    held.delete(lordID)
    refusedUntil.set(lordID, Date.now() + REFUSED_BUSY_MS)
    resyncMovements()
}

movementEvents.on("outgoing", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    const lordID = movement.lord.lordID
    // Market carts and other movements without a commander have no lord id. Marked used, it was never freed.
    if (movement.owner.ownerID != playerInfo.playerID || !Number.isFinite(lordID))
        return

    useCommander(lordID)
    held.delete(lordID)
    refusedUntil.delete(lordID)
    // A march home ends when it arrives; an attack's army is home after travelling as far again.
    if (Number.isFinite(movement.endsAt))
        homeBy.set(lordID, movement.endsAt + (movement.targetOwner.ownerID == movement.owner.ownerID ? 0 : Number(movement.totalTime) || 0))
})

movementEvents.on("return", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.targetOwner.ownerID != playerInfo.playerID)
        return

    // console.log(`freeing: ${movement.lord.lordID}`)

    freeCommander(movement.lord.lordID)
})
/** No account has more commanders than this, so a longer range picks no more. */
const MAX_COMMANDER_POSITION = 500

/**
 * The 0-based commander positions a whitelist like "1-5,9" or "1;2;3" picks, or the list unchanged when it is empty
 * or parsed already. Positions and ranges are set apart by commas or semicolons, and a part that isn't one is left
 * out, as @gge/contracts' commanderPositions reads the same list for the settings page.
 */
function parseWhitelist(commanderWhitelist) {
    if ([, 0, ""].includes(commanderWhitelist) || Array.isArray(commanderWhitelist))
        return commanderWhitelist
    return String(commanderWhitelist).split(/[,;]/).filter(part => part.trim() !== "").flatMap(part => {
        const [start, end = start] = part.split("-").map(Number)
        if (!Number.isInteger(start) || !Number.isInteger(end))
            return []
        return Array.from({ length: Math.max(0, Math.min(end, MAX_COMMANDER_POSITION) - start + 1) }, (_, i) => start + i - 1)
    })
}

/** Orders commanders by where a parsed whitelist names them, so "5;2;1" puts commander 5 first. */
const byWrittenOrder = whitelist => (a, b) => whitelist.indexOf(a.lordPosition) - whitelist.indexOf(b.lordPosition)
const byPosition = (a, b) => a.lordPosition - b.lordPosition

/** The settings page's tiles run from 1 to this, and picking all of them in order stores "1-50". */
const TILE_COUNT = 50
/**
 * Whether a parsed whitelist is every commander from the first, in order, as "1-50" and the old "1-99"
 * are. Such a list names no order of its own, so a plugin's own order still picks among its commanders.
 */
const isEveryCommander = whitelist => whitelist.length >= TILE_COUNT && whitelist.every((position, i) => position === i)

const mapOf = () => botConfig.plugins.commander?.commanderMap

/**
 * What `plugin` may send. With a commander map set it is the plugin's own commanders and its buckets', and `rank` puts
 * its own first. With no map, or for a caller that names no plugin, it is the commander list the caller gives.
 * @param {string} [plugin] the plugin's file
 */
function drawFor(commanderWhitelist, plugin) {
    const assigned = plugin ? assignedTo(mapOf(), path.basename(plugin, ".js")) : undefined
    if (assigned) {
        const rank = lord => assigned.own.includes(lord.lordPosition) ? 0 : assigned.shared.includes(lord.lordPosition) ? 1 : 2
        return { assigned, rank, allows: lord => rank(lord) < 2, tier: assigned.first ? "first" : "waiting" }
    }
    const whitelist = parseWhitelist(commanderWhitelist)
    return { whitelist, allows: lord => !whitelist || whitelist.includes(lord.lordPosition), tier: "waiting" }
}

/**
 * Why the commander map leaves `plugin` nothing to send, as a status reason: `{ reasonKey, params }`. Undefined with
 * no map, while the account's commanders aren't known yet, and when the plugin has a commander of the account.
 */
function mappedOut(plugin) {
    const { assigned, allows } = drawFor(undefined, plugin)
    if (!assigned || commanders.length == 0 || commanders.some(allows))
        return undefined
    const numbers = [...assigned.own, ...assigned.shared].map(position => position + 1)
    return numbers.length
        ? { reasonKey: "statusCommandersNotOwned", params: { list: writeRanges(numbers) } }
        : { reasonKey: "statusNoCommandersAssigned", params: {} }
}

/** Resolves when the settings or the account's commanders next change. Every waiting plugin shares the one promise. */
let change
const nextChange = () => change ??= new Promise(resolve => {
    const done = () => {
        events.off("configModified", done)
        xtHandler.off("gli", done)
        change = undefined
        resolve()
    }
    events.on("configModified", done)
    xtHandler.on("gli", done)
})

/**
 * Hands the first commander to come home that `draw` allows, and `filterCallback` when given, to `take`. Returns what
 * calls the claim off.
 */
function claimNextFreed(draw, filterCallback, take) {
    const onFreed = currentEvent => {
        const commander = commanders.find(e => e.lordID == currentEvent.detail)
        if (!draw.allows(commander))
            return
        if(!(!filterCallback || filterCallback(commander)))
            return

        event.removeEventListener(draw.tier, onFreed)
        currentEvent.stopImmediatePropagation()
        // Mark it in the same run as the hand-off, so a loop that asks again
        // before the claimant resumes can't take it too.
        handOut(currentEvent.detail)
        take(currentEvent.detail)
    }
    event.addEventListener(draw.tier, onFreed)
    return () => event.removeEventListener(draw.tier, onFreed)
}

/**
 * The first commander `plugin` may send that is free right now, marked used; undefined when none is. Never waits.
 * With no commander map it is the first free one of the whitelist, in the list's order.
 */
function takeFreeCommander(commanderWhitelist, plugin) {
    const draw = drawFor(commanderWhitelist, plugin)
    const free = commanders.filter(e => draw.allows(e) && !usedCommanders.includes(e.lordID))
    if (draw.rank)
        free.sort((a, b) => draw.rank(a) - draw.rank(b) || byPosition(a, b))
    else if (draw.whitelist)
        free.sort(byWrittenOrder(draw.whitelist))
    const lord = free[0]
    if (lord)
        handOut(lord.lordID)
    return lord
}

/** Whether `plugin` may send `lord`: by the commander map, or with no map by its commander list. Never takes it. */
const mayUse = (commanderWhitelist, plugin, lord) => drawFor(commanderWhitelist, plugin).allows(lord)

/** How many of the commanders `plugin` may send are free right now. Never takes one. */
function freeCommanderCount(commanderWhitelist, plugin) {
    const { allows } = drawFor(commanderWhitelist, plugin)
    return commanders.filter(e => allows(e) && !usedCommanders.includes(e.lordID)).length
}

/**
 * Holds a commander for `plugin` ahead of need: a free one now, else the first to come home, before any attack
 * waiting for it. `onHeld` gets the commander once it is held, and the caller frees it with `freeCommander`. Returns
 * what calls the reservation off while no commander is held yet.
 */
function reserveCommander(commanderWhitelist, plugin, onHeld) {
    const lord = takeFreeCommander(commanderWhitelist, plugin)
    if (lord) {
        onHeld(lord)
        return () => {}
    }
    const draw = { ...drawFor(commanderWhitelist, plugin), tier: "reserved" }
    return claimNextFreed(draw, undefined, lordID => onHeld(commanders.find(e => e.lordID == lordID)))
}

/**
 * A free commander `plugin` may send, marked used, waiting for one to come home when none is free.
 *
 * With no commander map it is one of the whitelist. Free commanders are taken in the order the list names them, so
 * "36;2;5" sends 36 first. `sortCallback` orders them only when the list names no order: empty, or every commander in
 * order like "1-50", the default included.
 *
 * With a commander map it is one of the plugin's own commanders, else one of its buckets', and `sortCallback` orders
 * each of the two. A plugin the map gives no commander of the account says so in its status and waits for the
 * settings to change.
 * @param {string} commanderWhitelist
 * @param {filterCallback} filterCallback
 * @param {sortCallback} sortCallback
 * @param {string} [plugin] the plugin's file, which the commander map and the status go by
 */
const waitForCommanderAvailable = async (commanderWhitelist, filterCallback, sortCallback, plugin) => {
    if (commanders.length == 0)
        commanders = Array.from((await waitForResult("gli", 1000 * 10))[0].C)
            .map(e => new Lord(e))

    for (let reason; (reason = mappedOut(plugin));) {
        const report = statusReporter(plugin)
        report("waiting", reason.reasonKey, reason.params)
        await nextChange()
        if (!mappedOut(plugin))
            report("running")
    }

    const draw = drawFor(commanderWhitelist, plugin)
    let usableCommanders = commanders.filter(e => draw.allows(e) && !usedCommanders.includes(e.lordID))

    const order = draw.rank ? (a, b) => draw.rank(a) - draw.rank(b) || (sortCallback ?? byPosition)(a, b)
        : draw.whitelist && !isEveryCommander(draw.whitelist) ? byWrittenOrder(draw.whitelist) : sortCallback
    if (order)
        usableCommanders.sort(order)
    if (filterCallback)
        usableCommanders = usableCommanders.filter(filterCallback)

    let lordID = usableCommanders[0]?.lordID

    const waitStarted = Date.now()
    lordID ??= await new Promise(resolve => claimNextFreed(draw, filterCallback, resolve))

    if (Date.now() > waitStarted)
        metrics.count("bot_attack_idle_seconds_total", { cause: "no_free_commander" }, (Date.now() - waitStarted) / 1000)
    handOut(lordID)
    return commanders.find(e => e.lordID == lordID)
}

const reportStatus = statusReporter(__filename)
let loggedSkipped
/**
 * The commander plugin's own status: whether a map is set, how many commanders it hands out, and which numbers it
 * names that the account doesn't have, which the bot skips.
 */
function reportMap() {
    const map = mapOf()
    if (!isSet(map))
        return reportStatus("running", "statusCommanderMapOff")
    const assigned = map.flatMap((owner, position) => owner ? [position] : [])
    const skipped = writeRanges(assigned.filter(position => !commanders.some(e => e.lordPosition == position)).map(position => position + 1))
    if (!skipped || commanders.length == 0)
        return reportStatus("running", "statusCommanderMapOn", { count: assigned.length })
    if (skipped != loggedSkipped)
        console.warn("commanderMapSkipped", skipped)
    loggedSkipped = skipped
    reportStatus("running", "statusCommanderMapSkipped", { list: skipped })
}
events.on("configModified", reportMap)
events.once("load", reportMap)

/**
 * @callback filterCallback
 * @param {import("../protocols.js").ClassTypes.Lord}
 * @callback sortCallback
 * @param {import("../protocols.js").ClassTypes.Lord}
 * @param {import("../protocols.js").ClassTypes.Lord}
 */

module.exports = {
    movementEvents,
    waitForCommanderAvailable,
    takeFreeCommander,
    reserveCommander,
    mayUse,
    freeCommanderCount,
    mappedOut,
    parseWhitelist,
    useCommander,
    commanderRefused,
    freeCommander
}
