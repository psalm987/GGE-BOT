/** Castle resources a player may give the alliance: the option that ticks it, the castle field, the game's key and the storage field. Food can't be given. */
const RESOURCES = [
    { option: "donateWood", field: "wood", key: "W", max: "maxAmountWood" },
    { option: "donateStone", field: "stone", key: "S", max: "maxAmountStone" },
    { option: "donateIron", field: "iron", key: "I", max: "maxAmountIron" },
    { option: "donateOil", field: "oil", key: "O", max: "maxAmountOil" },
    { option: "donateGlass", field: "glass", key: "G", max: "maxAmountGlass" },
    { option: "donateCoal", field: "coal", key: "C", max: "maxAmountCoal" },
]
/** The account's coins a player may give: the option that ticks it, the option holding what to keep, the field in `resources` and the game's key. */
const CURRENCIES = [
    { option: "donateAllianceCoins", keep: "allianceCoinsKeep", field: "allianceCoin", key: "AC" },
    { option: "donateRiftCoins", keep: "riftCoinsKeep", field: "riftCoin", key: "RC" },
    { option: "donateLegendaryRiftCoins", keep: "legendaryRiftCoinsKeep", field: "legendaryRiftCoin", key: "LRC" },
]

const optionDefs = [
    {
        type: "Rows",
        key: "donateCastles",
        columns: [
            { key: "castle", type: "castle" },
            { key: "storageKeep", type: "number", min: 0, max: 100, default: 80 },
        ],
        default: []
    },
    ...RESOURCES.map(({ option }) => ({ type: "Checkbox", key: option, default: true })),
    ...CURRENCIES.flatMap(({ option, keep }) => [
        { type: "Checkbox", key: option, default: false },
        { type: "Number", key: keep, min: 0, max: 2_147_483_647, step: 100, default: 0 },
    ]),
    { type: "Checkbox", key: "dryRunDonations", default: false },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig, playerInfo } = require("../ggeBot.js")
const { KingdomID, AreaType, castles, resources } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const stock = require("./stock.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusAllianceDonationStarting")

/** Kingdoms whose castles may give. */
const KINGDOMS = [KingdomID.greatEmpire, KingdomID.burningSands, KingdomID.everWinterGlacier, KingdomID.firePeaks]
/** Refusals that would come for every castle, so they end the round: no alliance, joined too recently, the funds are full. */
const STOPS = { 270: "noAlliance", 124: "justJoined", 398: "fundsFull" }
/** Refusals that say this castle or these coins are short: said once for each castle, and the next castle is still tried. */
const SHORT = [55, 117, 327]

const asRows = value => Array.isArray(value) ? value : []
const ticked = option => pluginOptions[option] ?? true

/** The ticked castles that exist on the account, with the share of storage each keeps (0 to 1). */
const donors = () => asRows(pluginOptions.donateCastles)
    .map(row => ({ castle: castles.find(c => c.kingdomID == row.castle?.kingdom && c.id == row.castle?.id), keep: Number(row.storageKeep) }))
    .filter(({ castle, keep }) => castle && KINGDOMS.includes(castle.kingdomID) && keep >= 0 && keep <= 100)
    .map(({ castle, keep }) => ({ castle, keep: keep / 100 }))

const tickedCurrencies = () => CURRENCIES.filter(({ option }) => pluginOptions[option])

/** What `have` (a gdr `grc`) holds above `keep` of the castle's storage, by the game's key, for each ticked resource. */
function aboveKeep(castle, have, keep) {
    const amounts = {}
    for (const r of RESOURCES.filter(({ option }) => ticked(option))) {
        const max = Number(castle.getProductionData?.[r.max]) || 0
        const give = Math.floor((Number(have[r.key] ?? castle[r.field]) || 0) - max * keep)
        if (max > 0 && give > 0)
            amounts[r.key] = give
    }
    return amounts
}

/** Castles whose shortage was already logged, so it is said once until a donation from there works. */
const saidShort = new Set()

/**
 * Sends one `ado` and says what came of it: "donated", one of STOPS' outcomes, "short" or "refused". A dry run logs
 * the request and counts as donated.
 */
async function donate(request, dryRun, who) {
    if (dryRun) {
        console.log("dryRunAdo", JSON.stringify(request))
        return "donated"
    }
    const { result } = await ask("ado", request)
    if (result === 0) {
        saidShort.delete(who)
        console.log("allianceDonated", JSON.stringify(request))
        return "donated"
    }
    if (STOPS[result])
        return STOPS[result]
    if (SHORT.includes(result)) {
        if (!saidShort.has(who)) {
            saidShort.add(who)
            console.log("allianceDonationShort", JSON.stringify(request))
        }
        return "short"
    }
    console.warn("allianceDonationRefused", JSON.stringify(request), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
    return "refused"
}

const BLOCKERS = ["noAlliance", "justJoined", "fundsFull", "refused", "short", "belowKeep"]
const STATUS_KEY = {
    noAlliance: "statusAllianceDonationNoAlliance", justJoined: "statusAllianceDonationJustJoined", fundsFull: "statusAllianceDonationFundsFull",
    refused: "statusAllianceDonationRefused", short: "statusAllianceDonationShort", belowKeep: "statusAllianceDonationBelowKeep",
}
const nextRound = () => boxMullerRandom(9.5 * 60_000, 10.5 * 60_000)

async function cycle(active) {
    if (!(Number(playerInfo.alliance?.id) > 0)) {
        reportStatus("waiting", "statusAllianceDonationNoAlliance")
        return nextRound()
    }
    const givers = donors(), coins = tickedCurrencies()
    if (givers.length == 0 && coins.length == 0) {
        reportStatus("waiting", "statusAllianceDonationNoCastles")
        return 60 * 60_000
    }
    const dryRun = Boolean(pluginOptions.dryRunDonations)
    await stock.refreshHome()

    const outcomes = []
    const stops = new Set(Object.values(STOPS))
    for (const { castle, keep } of givers) {
        if (!active())
            return
        const { reply, result } = await ask("gdr", { AID: castle.id, KID: castle.kingdomID })
        let outcome = result === 0 ? undefined : STOPS[result] ?? "refused"
        const amounts = outcome ? {} : aboveKeep(castle, reply.grc ?? {}, keep)
        if (!outcome && Object.keys(amounts).length == 0)
            outcome = "belowKeep"
        if (!outcome) {
            await pause(1500, 4000)
            outcome = await donate({ AID: castle.id, KID: castle.kingdomID, RV: amounts }, dryRun, `${castle.kingdomID}:${castle.id}`)
        }
        outcomes.push(outcome)
        if (stops.has(outcome))
            break
        await pause(3000, 5000)
    }

    const main = castles.find(c => c.kingdomID == KingdomID.greatEmpire && c.areaInfo?.type == AreaType.mainCastle)
    if (!outcomes.some(outcome => stops.has(outcome)) && coins.length > 0 && main && active()) {
        const amounts = {}
        for (const c of coins) {
            const give = Math.floor((Number(resources[c.field]) || 0) - Math.max(0, Number(pluginOptions[c.keep]) || 0))
            if (give > 0)
                amounts[c.key] = give
        }
        outcomes.push(Object.keys(amounts).length == 0 ? "belowKeep" : await donate({ AID: main.id, KID: KingdomID.greatEmpire, RV: amounts }, dryRun, "coins"))
    }

    const donations = outcomes.filter(outcome => outcome == "donated").length
    if (donations > 0)
        reportStatus("running", "statusAllianceDonationDonated", { donations })
    else
        reportStatus("waiting", STATUS_KEY[BLOCKERS.find(b => outcomes.includes(b)) ?? "belowKeep"])
    return nextRound()
}

events.once("load", () => chore("allianceDonation", cycle, boxMullerRandom(60_000, 3 * 60_000)))
