/**
 * Build Supply: when Build's plan for the Storm Islands castle can pay for nothing more, sends that castle wood and
 * stone from the castles the player lists. Build reports after each look (`buildLooked`, plugins/build.js); this asks
 * the Storm transfer arbiter (stormTransfer.js) for the one goods transfer into Storm. No troops eat wood or stone, so
 * mead and food that are running low go first. With skips on, the transfer is skipped until it lands. Never rubies.
 * Ported from Lazy Lord's be/plugins/buildSupply.js (MIT). The requests are in docs/protocol/storm-transfer.md.
 */
if (require("node:worker_threads").isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Rows",
                key: "buildSupplySources",
                columns: [
                    { key: "castle", type: "castle" },
                    { key: "keep", type: "number", min: 0, max: 100_000_000, default: 0 },
                ],
                default: []
            },
            { type: "Checkbox", key: "buildSupplyUseSkips", default: true },
            { type: "Checkbox", key: "buildSupplyDryRun", default: false },
        ]
    }

const { KingdomID } = require("../protocols.js")
const { events, botConfig } = require("../ggeBot.js")
const { boxMullerRandom } = require("../pacing.js")
const { castleName } = require("../towers.js")
const stormTransfer = require("../stormTransfer.js")

/** Read on every look, because the runner changes it in place when the player saves. */
const options = botConfig.plugins[require("node:path").basename(__filename, ".js")] ?? {}
const STORM = KingdomID.stormIslands
const GOODS = ["wood", "stone"]
const SECOND = 1000
/** Build waits this long at most for the arbiter's answer, so a slow look never holds up its other castles. */
const ANSWER_WAIT_MS = 90 * SECOND
const afterLanding = () => boxMullerRandom(30 * SECOND, 60 * SECOND)
const afterSkips = () => boxMullerRandom(5 * SECOND, 10 * SECOND)

/**
 * What Build's last look at the Storm castle still needs, while it wants a transfer. A send, or a look that sends
 * nothing, uses it up; a refusal or a busy slot keeps it for the arbiter's next look.
 * @type {{ wood: number, stone: number } | undefined}
 */
let need
/** Settles the next look Build waits on, with the ms until it. */
let answer = () => {}

/** Each of wood and stone: what fills the storehouse, plus a ninth for the loss, and no more than the plan lacks. */
function amounts(storm) {
    return Object.fromEntries(GOODS.map(goods => {
        const short = (Number(need[goods]) || 0) - (Number(storm[goods]) || 0)
        const lacking = Math.ceil(short / (1 - stormTransfer.GOODS[goods].loss))
        return [goods, short > 0 ? Math.min(stormTransfer.fillAmount(storm, goods), lacking) : 0]
    }))
}

/** The first listed castle that can spare any of the wood and stone wanted, and what it sends of each. */
function orderFor(amount, rows) {
    for (const row of rows) {
        let from
        const goods = {}
        for (const name of GOODS) {
            const pick = amount[name] > 0 && stormTransfer.firstSource([row], name)
            if (!pick)
                continue
            from = pick.castle
            goods[name] = Math.min(amount[name], pick.spare)
        }
        if (from)
            return { from, goods }
    }
}

function look(storm) {
    if (!need)
        return { hoursLeft: Infinity }
    const dryRun = Boolean(options.buildSupplyDryRun)
    const rows = Array.isArray(options.buildSupplySources) ? options.buildSupplySources : []
    const order = orderFor(amounts(storm), rows)
    if (!order || dryRun) {
        need = undefined
        answer(Infinity)
    }
    if (!order)
        return { hoursLeft: Infinity, note: rows.length ? ["buildSupplyNoSource"] : ["buildSupplyNoCastles"] }
    return { hoursLeft: Infinity, dryRun, landNow: options.buildSupplyUseSkips ?? true, order }
}

stormTransfer.register({
    name: "buildSupply",
    feedsTroops: false,
    look,
    busy: minutes => {
        console.log("buildSupplyTransferInFlight", minutes, "minutesMeadReplace")
        answer(minutes * 60 * SECOND + afterLanding())
    },
    sent: ({ from, goods }) => {
        need = undefined
        console.log("buildSupplySent", goods.wood ?? 0, "buildSupplyWood", goods.stone ?? 0, "buildSupplyStone", castleName(from))
        const left = stormTransfer.slotSecondsLeft()
        answer(left > 0 ? left * SECOND + afterLanding() : afterSkips())
    },
    refused: code => {
        console.log("buildSupplyRefused", code)
        answer(stormTransfer.BUSY_RETRY_MS + afterLanding())
    },
})

/** Build's report on a castle. Only the Storm castle with nothing payable and wood or stone still to pay asks for a transfer. */
events.on("buildLooked", report => {
    if (report.castle?.kingdomID != STORM)
        return
    need = undefined
    answer(Infinity)
    const inFlight = stormTransfer.slotSecondsLeft()
    if (inFlight > 0) {
        if (report.nothingPayable)
            report.lookAgainIn(inFlight * SECOND + afterLanding())
        return
    }
    if (!report.nothingPayable || !GOODS.some(goods => report.need?.[goods] > 0))
        return
    need = report.need
    report.lookAgainIn(new Promise(resolve => {
        const timer = setTimeout(() => answer(Infinity), ANSWER_WAIT_MS)
        timer.unref?.()
        answer = ms => {
            clearTimeout(timer)
            answer = () => {}
            resolve(ms)
        }
    }))
    stormTransfer.wake()
})
