const optionDefs = [
    {
        type: "Rows",
        key: "colossusCastles",
        columns: [
            { key: "castle", type: "castle" },
            { key: "donateAt", type: "number", min: 1, max: 100, default: 90 },
            { key: "storageKeep", type: "number", min: 0, max: 100, default: 50 },
        ],
        default: []
    },
    { type: "Checkbox", key: "dryRunDonations", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig } = require("../ggeBot.js")
const { KingdomID, castles } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const eventGate = require("../eventGate.js")
const stock = require("./stock.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusColossusStarting")

/** Kingdoms whose castles may give to the Colossus. */
const KINGDOMS = [KingdomID.greatEmpire, KingdomID.burningSands, KingdomID.everWinterGlacier, KingdomID.firePeaks]
/** SPECIALEVENT_NOT_RUNNING. */
const NOT_RUNNING = 209
/**
 * The Colossus event ids Lazy Lord saw, though not every time it ran. The game's refusal is the sign the plugin
 * trusts. Either id starting ends the wait early, once: an id that turns out not to be the Colossus can't make the
 * plugin ask every round.
 */
const COLOSSUS_EVENTS = [44, 57]
/** After the game says no Colossus is running, how long before the plugin asks again. */
const NO_EVENT_WAIT_MS = 6 * 60 * 60_000
/** How long a castle the game refused for another reason is left out. */
const REFUSED_WAIT_MS = 60 * 60_000

let noEventUntil = 0
for (const eventID of COLOSSUS_EVENTS)
    eventGate.onStart(eventID, () => noEventUntil = 0)

/** Castles held back after a refusal, by "kingdom:id", until the time it holds. */
const heldBack = new Map()

const asRows = value => Array.isArray(value) ? value : []

/** The listed castles that exist in the home kingdoms, with the shares (0 to 1) at which they give and down to which they keep. */
const donors = () => asRows(pluginOptions.colossusCastles)
    .map(row => ({ castle: castles.find(c => c.kingdomID == row.castle?.kingdom && c.id == row.castle?.id), at: Number(row.donateAt), keep: Number(row.storageKeep) }))
    .filter(({ castle, at, keep }) => castle && KINGDOMS.includes(castle.kingdomID) && at > 0 && at <= 100 && keep >= 0 && keep <= 100)
    .map(({ castle, at, keep }) => ({ castle, at: at / 100, keep: keep / 100 }))

/** What the castle gives of a resource: nothing below `at` of its storage, else everything above `keep` of it. */
function share(have, max, at, keep) {
    if (!(max > 0) || !(have >= max * at))
        return 0
    return Math.max(0, Math.floor(have - max * keep))
}

const BLOCKERS = ["refused", "belowThreshold"]
const STATUS_KEY = { refused: "statusColossusRefused", belowThreshold: "statusColossusBelowThreshold" }
const nextRound = () => boxMullerRandom(9.5 * 60_000, 10.5 * 60_000)

async function cycle(active) {
    const givers = donors()
    if (givers.length == 0) {
        reportStatus("waiting", "statusColossusNoCastles")
        return 60 * 60_000
    }
    if (Date.now() < noEventUntil) {
        reportStatus("waiting", "statusColossusNoEvent")
        return nextRound()
    }
    const dryRun = Boolean(pluginOptions.dryRunDonations)
    await stock.refreshHome()

    const outcomes = []
    let wood = 0, stone = 0
    for (const { castle, at, keep } of givers) {
        const key = `${castle.kingdomID}:${castle.id}`
        if (heldBack.get(key) > Date.now()) {
            outcomes.push("refused")
            continue
        }
        const storage = castle.getProductionData ?? {}
        const request = {
            DW: share(Number(castle.wood), storage.maxAmountWood, at, keep),
            DS: share(Number(castle.stone), storage.maxAmountStone, at, keep),
            SCID: castle.id, SKID: castle.kingdomID,
        }
        if (request.DW == 0 && request.DS == 0) {
            outcomes.push("belowThreshold")
            continue
        }
        if (!active())
            return
        if (dryRun)
            console.log("dryRunCde", JSON.stringify(request))
        else {
            const { result } = await ask("cde", request)
            if (result === NOT_RUNNING) {
                noEventUntil = Date.now() + NO_EVENT_WAIT_MS
                reportStatus("waiting", "statusColossusNoEvent")
                return nextRound()
            }
            if (result !== 0) {
                heldBack.set(key, Date.now() + REFUSED_WAIT_MS)
                console.warn("colossusDonationRefused", JSON.stringify(request), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
                outcomes.push("refused")
                continue
            }
            castle.wood -= request.DW
            castle.stone -= request.DS
            console.log("colossusDonated", JSON.stringify(request))
        }
        wood += request.DW
        stone += request.DS
        outcomes.push("donated")
        await pause(3000, 5000)
    }

    if (outcomes.includes("donated"))
        reportStatus("running", "statusColossusDonated", { wood, stone })
    else
        reportStatus("waiting", STATUS_KEY[BLOCKERS.find(b => outcomes.includes(b))])
    return nextRound()
}

events.once("load", () => chore("colossusEventDonate", cycle, boxMullerRandom(60_000, 3 * 60_000)))
