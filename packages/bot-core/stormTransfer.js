/**
 * The one goods transfer into the Storm Islands castle. The game takes one kingdom transfer of goods into Storm at a
 * time, so mead, food and Build Supply's wood and stone share it. Each sender registers here and reports, at each
 * look, a Want: how long its goods lasts and what it would send. This module refreshes the castles, decides who gets
 * the slot (`decide`, pure), skips a transfer in flight when one must land sooner, sends, and looks again.
 *
 * Priority: the goods that runs out soonest (stock ÷ what is eaten each hour) goes first. A goods nothing eats has
 * Infinity hours and waits behind one that is being eaten; among equals, goods troops eat go before goods they don't.
 * A transfer in flight is skipped when it would land after a goods that may skip has run out.
 */
const { ClientCommands, KingdomID, KingdomSkipType, AreaType, castles, unlockInfoList } = require("./protocols.js")
const { events, xtHandler } = require("./ggeBot.js")
const { ask, chore } = require("./chores.js")
const { spendSkip, skipRefused, MinuteSkipType } = require("./plugins/skips.js")

/**
 * The goods a kingdom transfer brings to Storm: the game's code, the storehouse size field, and the share lost on the
 * way. Lazy Lord saw about a tenth of wood and stone lost (2026-11-16) and loses food the same way. Mead was never
 * measured and fills to the space left, as the mead sender always has.
 */
const GOODS = Object.freeze({
    mead: { code: "MEAD", max: "maxAmountMead", loss: 0 },
    food: { code: "F", max: "maxAmountFood", loss: 0.1 },
    wood: { code: "W", max: "maxAmountWood", loss: 0.1 },
    stone: { code: "S", max: "maxAmountStone", loss: 0.1 },
})

const MINUTE = 60 * 1000
/** A sender that wants the slot while it is taken, or was refused, looks again this soon. */
const BUSY_RETRY_MS = 5 * MINUTE
/** After a send, the sender looks again this much later. */
const SENT_LOOK_MS = 29 * 30 * 1000
const NO_STORM_RETRY_MS = 60 * MINUTE
/** setTimeout fires at once for a longer delay. */
const TIMER_MAX = 2 ** 31 - 1
const STORM = KingdomID.stormIslands

/**
 * @typedef {{ from: object, goods: Partial<Record<keyof typeof GOODS, number>> }} Order
 * @typedef {{
 *   name: string,
 *   hoursLeft: number,
 *   maySkip?: boolean,
 *   feedsTroops?: boolean,
 *   dryRun?: boolean,
 *   order?: Order,
 *   waitMs?: number,
 *   note?: unknown[],
 * }} Want
 *   One sender's view at one look. With `order` it wants the slot now; without, it looks again after `waitMs` and
 *   `note` is what it writes to the log.
 * @typedef {{
 *   name: string,
 *   feedsTroops?: boolean,
 *   look: (storm: object) => Omit<Want, "name" | "feedsTroops">,
 *   busy?: (minutes: number) => void,
 *   sent?: (order: Order) => void,
 *   refused?: (code: number) => void,
 * }} Requester
 */

const byUrgency = (a, b) => (a.hoursLeft - b.hoursLeft) || (Number(Boolean(b.feedsTroops)) - Number(Boolean(a.feedsTroops)))

/**
 * Who gets the slot. `secondsLeft` is the transfer in flight, 0 for none. `skipped` is true once this look has
 * skipped. Returns `{ act: "skip" }`, `{ act: "send", want, ms }` with the next look after a send that goes through,
 * or `{ act: "wait", ms }`.
 * @param {number} secondsLeft
 * @param {Want[]} wants
 */
function decide(secondsLeft, wants, { skipped = false } = {}) {
    const orders = wants.filter(want => want.order).sort(byUrgency)
    const waits = wants.filter(want => !want.order).map(want => want.waitMs ?? Infinity)
    if (secondsLeft > 0) {
        if (!skipped && wants.some(want => want.maySkip && !want.dryRun && want.hoursLeft * 3600 <= secondsLeft))
            return { act: "skip" }
        return { act: "wait", ms: Math.min(...waits, ...orders.length ? [BUSY_RETRY_MS] : []) }
    }
    if (orders.length)
        return { act: "send", want: orders[0], ms: Math.min(SENT_LOOK_MS, ...waits, ...orders.length > 1 ? [BUSY_RETRY_MS] : []) }
    return { act: "wait", ms: Math.min(...waits) }
}

/** What to send to fill `storm`'s storehouse of `goods`, counting what is lost on the way. */
function fillAmount(storm, goods) {
    const { max, loss } = GOODS[goods]
    const space = (Number(storm.getProductionData?.[max]) || 0) - (Number(storm[goods]) || 0)
    return space > 0 ? Math.floor(space / (1 - loss)) : 0
}

const stormCastle = () => castles.find(castle => castle.kingdomID == STORM && castle.areaInfo.type == AreaType.externalKingdom)

/**
 * When each transfer timer was read. The game's RS is the seconds left at that moment and is never updated in
 * between, so a timer read an hour ago has an hour less left.
 */
const timerReadAt = new WeakMap()
function secondsLeft(transfer) {
    if (!(transfer?.remainingTime > 0))
        return 0
    if (!timerReadAt.has(transfer))
        timerReadAt.set(transfer, Date.now())
    return Math.max(0, transfer.remainingTime - (Date.now() - timerReadAt.get(transfer)) / 1000)
}
for (const cmd of ["kpi", "fjf", "kgt", "msk", "kut"])
    xtHandler.on(cmd, () => secondsLeft(stormCastle()?.resourceTransfer))

/** Seconds until the transfer on its way to Storm lands, 0 for none. */
const slotSecondsLeft = () => secondsLeft(stormCastle()?.resourceTransfer)

/**
 * Skips the transfer in flight. An msk reply with the kingdom info replaces the timer; one without it leaves the old
 * timer, so the skip is counted down on it here, or the next look would skip the same time again.
 */
async function skipTransfer(storm) {
    while (secondsLeft(storm.resourceTransfer) > 0) {
        const before = storm.resourceTransfer
        const skip = spendSkip(secondsLeft(before))
        if (skip == undefined)
            return

        const result = await ClientCommands.skipResourceTransfer(skip, STORM, KingdomSkipType.sendResource)
        if (result != 0) {
            if (skipRefused(skip, result))
                continue
            return
        }
        if (storm.resourceTransfer === before)
            before.remainingTime -= MinuteSkipType[skip] * 60
    }
}

/** Goods that landed through the skips: the castle counts them only from the game's next update. */
function land(storm, resources) {
    for (const [goods, { max, loss }] of Object.entries(GOODS))
        if (resources?.[goods] > 0)
            storm[goods] = Math.min(storm[goods] + resources[goods] * (1 - loss), storm.getProductionData[max])
}

/** @type {Requester[]} */
const requesters = []

/** @returns {{ requester: Requester, want: Want }[]} */
function lookAll(storm) {
    return requesters.map(requester => {
        try {
            return { requester, want: { ...requester.look(storm), name: requester.name, feedsTroops: requester.feedsTroops } }
        } catch (error) {
            console.warn(requester.name, error)
            return { requester, want: { name: requester.name, hoursLeft: Infinity, waitMs: BUSY_RETRY_MS } }
        }
    })
}

/** Sends `order` to Storm, or writes it to the log on a dry run. Resolves to the game's code. */
async function send({ from, goods }, dryRun) {
    const G = Object.entries(goods).filter(([, n]) => n > 0).map(([name, n]) => [GOODS[name].code, n])
    if (dryRun) {
        console.log("dryRunKgt", JSON.stringify({ SCID: from.id, SKID: from.kingdomID, TKID: STORM, G }))
        return 0
    }
    const result = await ClientCommands.kingdomUnitTransfer(from.id, from.kingdomID, STORM, G)
    if (result == 0)
        for (const [name, n] of Object.entries(goods))
            from[name] -= n
    return result
}

/** One look at the Storm castle. Resolves to the delay before the next look. */
async function look() {
    // The castles' figures don't drop locally as troops eat. If the refresh fails, the figures held are used.
    const { result } = await ask("dcl", { CD: 1 })
    if (result !== 0)
        console.warn("stormLevelsNotRefreshed")

    const storm = stormCastle()
    if (!storm) {
        console.warn("stormCastleNotFound")
        return NO_STORM_RETRY_MS
    }
    let looks = lookAll(storm)
    let plan = decide(secondsLeft(storm.resourceTransfer), looks.map(l => l.want))
    if (plan.act == "skip") {
        const inFlight = storm.resourceTransfer
        await skipTransfer(storm)
        if (!(secondsLeft(storm.resourceTransfer) > 0))
            land(storm, inFlight.resources)
        looks = lookAll(storm)
        plan = decide(secondsLeft(storm.resourceTransfer), looks.map(l => l.want), { skipped: true })
    }

    const busy = () => {
        const minutes = Math.ceil(secondsLeft(storm.resourceTransfer) / 60)
        for (const { requester, want } of looks)
            if (want.order && want !== plan.want)
                requester.busy?.(minutes)
    }
    for (const { want } of looks)
        if (!want.order && want.note)
            console.log(...want.note)
    if (plan.act == "wait") {
        busy()
        return plan.ms
    }

    const { requester } = looks.find(l => l.want === plan.want)
    const code = await send(plan.want.order, plan.want.dryRun)
    if (code != 0) {
        requester.refused?.(code)
        return BUSY_RETRY_MS
    }
    if (!plan.want.dryRun) {
        requester.sent?.(plan.want.order)
        busy()
    }
    return plan.ms
}

let wakeLook
/**
 * A sender's way in. Register at load; the first one starts the looks once the bot has loaded, if Storm is unlocked.
 * @param {Requester} requester
 */
function register(requester) {
    requesters.push(requester)
}

/** Brings the next look forward to now, as Build Supply does once Build can pay for nothing more. */
const wake = () => wakeLook?.(0)

events.once("load", () => {
    if (!unlockInfoList.find(e => e.kingdomID == STORM)?.isUnlocked)
        return console.warn("wontRunWithoutStormUnlocked")
    wakeLook = chore("stormTransfer", async () => Math.min(await look(), TIMER_MAX), 0)
})

module.exports = { register, wake, decide, fillAmount, slotSecondsLeft, GOODS, BUSY_RETRY_MS, SENT_LOOK_MS }
