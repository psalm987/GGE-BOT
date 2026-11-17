if (require('node:worker_threads').isMainThread)
    return module.exports = {
        checks: [{ type: "rows", options: ["targets"] }],
        pluginOptions: [
            {
                type: "Rows",
                key: "targets",
                columns: [
                    { key: "kingdom", type: "number", min: 0, max: 10, default: 0 },
                    { key: "tool", type: "tool" },
                    { key: "stock", type: "number", min: 1, max: 2_000_000_000, default: 10_000 },
                ],
                default: []
            },
            {
                type: "Number",
                key: "margin",
                min: 0,
                max: 1_000_000,
                step: 100,
                default: 4000
            },
            {
                type: "Number",
                key: "coinFloor",
                min: 0,
                max: 2_147_483_647,
                step: 1000,
                unit: "coins",
                default: 0
            },
            {
                type: "Number",
                key: "spendCap",
                min: 1000,
                max: 2_147_483_647,
                step: 1000,
                unit: "coins",
                default: 500_000
            },
            {
                type: "Checkbox",
                key: "burnOverflow",
                default: false,
                advanced: true
            },
            {
                type: "Number",
                key: "overflowThreshold",
                min: 1_000_000,
                max: 2_147_483_647,
                step: 1_000_000,
                unit: "coins",
                default: 2_000_000_000,
                advanced: true
            },
            {
                type: "Checkbox",
                key: "dryRunOrders",
                default: false,
                advanced: true
            }
        ]
    }

const err = require("../err.json")
const { events, botConfig, xtHandler } = require("../ggeBot.js")
const { resources, activeEvent } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const stock = require("./stock.js")
const loadItem = require("../paths.js").loadItem

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusBuyToolsStarting")

const ARMOURER_EVENT = 27
const NOT_ENOUGH_COINS = 10
const STORAGE_FULL = 154
/** The most packages the overflow burn buys in one run, so a refusal it can't read ends it. */
const MAX_BURN_ORDERS = 20

const units = new Map(loadItem("units").map(unit => [Number(unit.wodID), unit]))
const packages = new Map(loadItem("packages").map(pack => [Number(pack.packageID), pack]))

const option = (key, fallback) => Number.isFinite(Number(pluginOptions[key])) && pluginOptions[key] !== "" && pluginOptions[key] !== null ? Number(pluginOptions[key]) : fallback

/** The package ids the armourer lists in the latest `sei`, whether the game sends an array or a comma list. */
function livePackageIDs() {
    const listed = activeEvent(ARMOURER_EVENT)?.PIDS
    return (Array.isArray(listed) ? listed : String(listed ?? "").split(",")).map(Number).filter(Number.isInteger)
}

/** The cheapest live coin package for each tool, as `{ pid, price, perPackage, maxPerClick }`. */
function liveOffers() {
    const offers = new Map()
    for (const pid of livePackageIDs()) {
        const pack = packages.get(pid)
        const tool = Number(pack?.unitID), price = Number(pack?.packagePriceC1)
        if (!pack || !units.has(tool) || !(price > 0))
            continue
        const cap = Number(pack.maxBuyPerClick) > 0 ? Number(pack.maxBuyPerClick) : Infinity
        if (!offers.has(tool) || price < offers.get(tool).price)
            offers.set(tool, { pid, price, perPackage: Number(pack.unitAmount) || 1, maxPerClick: cap })
    }
    return offers
}

const targetRows = () => (Array.isArray(pluginOptions.targets) ? pluginOptions.targets : [])
    .map(row => ({ kingdom: Number(row.kingdom), tool: Number(row.tool), stock: Number(row.stock) }))
    .filter(row => units.has(row.tool) && row.stock > 0 && Number.isInteger(row.kingdom))

/** Outcomes of one target, best first. */
const OUTCOMES = ["bought", "met", "refused", "storageFull", "capReached", "coinFloor", "noOffer"]
const BLOCKERS = ["noOffer", "coinFloor", "capReached", "storageFull", "refused"]
const STATUS_KEY = { noOffer: "statusBuyToolsNoOffer", coinFloor: "statusBuyToolsCoinFloor", capReached: "statusBuyToolsCapReached", storageFull: "statusBuyToolsStorageFull", refused: "statusBuyToolsRefused" }

/**
 * Buys `packagesToBuy` of `offer` for kingdom `kingdom`. Resolves to the game's result (0 when the buy went
 * through), after taking the new coin count from the reply. With `dryRun` it logs the order and sends nothing.
 */
async function buy(offer, packagesToBuy, kingdom, dryRun) {
    const order = { PID: offer.pid, BT: 0, TID: ARMOURER_EVENT, AMT: packagesToBuy, KID: kingdom, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }
    if (dryRun) {
        console.log("dryRunSbp", JSON.stringify(order))
        return 0
    }
    const { reply, result } = await ask("sbp", order)
    if (result === 0 && reply.gcu)
        xtHandler.emit("gcu", reply.gcu)
    if (result !== 0)
        console.warn("buyToolsRefused", JSON.stringify(order), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
    return result
}

/** Spends the coins above the threshold on the targeted tools, in row order, until the next package doesn't fit. */
async function burnOverflow(rows, offers, coins, dryRun, active) {
    const threshold = option("overflowThreshold", 2_000_000_000)
    let spent = 0, orders = 0
    for (const row of rows) {
        const offer = offers.get(row.tool)
        while (offer && orders < MAX_BURN_ORDERS && active()) {
            const excess = coins - spent - threshold
            const count = Math.min(Math.floor(excess / offer.price), offer.maxPerClick)
            if (!(count > 0))
                break
            const result = await buy(offer, count, row.kingdom, dryRun)
            orders++
            if (result !== 0)
                break
            spent += count * offer.price
            await pause(1500, 4000)
        }
    }
    if (spent > 0)
        console.log("coinsBurned", spent)
    return spent
}

async function cycle(active) {
    const rows = targetRows()
    if (rows.length == 0) {
        reportStatus("waiting", "statusBuyToolsNoTargets")
        return 60 * 60_000
    }
    if (!Number.isFinite(resources.coins)) {
        reportStatus("waiting", "statusBuyToolsNoAnswer")
        return 10 * 60_000
    }
    const dryRun = Boolean(pluginOptions.dryRunOrders)
    const margin = option("margin", 4000), coinFloor = option("coinFloor", 0), spendCap = option("spendCap", 500_000)

    await stock.refreshHome()
    const offers = liveOffers()
    let coins = resources.coins
    let spent = 0
    let bought = 0
    const outcomes = rows.map(() => new Set())
    const dryBought = new Map()

    for (const [i, row] of rows.entries()) {
        const offer = offers.get(row.tool)
        if (!offer) {
            outcomes[i].add("noOffer")
            continue
        }
        const key = `${row.kingdom}:${row.tool}`
        const deficit = row.stock - stock.toolStock(row.tool, { kingdom: row.kingdom }).total - (dryBought.get(key) ?? 0)
        if (deficit <= 0) {
            outcomes[i].add("met")
            continue
        }
        const wanted = Math.ceil((deficit + margin) / offer.perPackage)
        const byFloor = Math.floor((coins - coinFloor) / offer.price)
        const byCap = Math.floor((spendCap - spent) / offer.price)
        const count = Math.min(wanted, offer.maxPerClick, byFloor, byCap)
        if (!(count > 0)) {
            outcomes[i].add(byFloor <= byCap ? "coinFloor" : "capReached")
            continue
        }
        if (!active())
            return
        const result = await buy(offer, count, row.kingdom, dryRun)
        if (result !== 0) {
            outcomes[i].add(result == STORAGE_FULL ? "storageFull" : result == NOT_ENOUGH_COINS ? "coinFloor" : "refused")
            continue
        }
        const cost = count * offer.price
        spent += cost
        coins = dryRun ? coins - cost : Number.isFinite(resources.coins) ? resources.coins : coins - cost
        bought += count * offer.perPackage
        dryBought.set(key, (dryBought.get(key) ?? 0) + count * offer.perPackage)
        outcomes[i].add("bought")
        await pause(1500, 4000)
    }

    let burned = 0
    if (pluginOptions.burnOverflow && coins > option("overflowThreshold", 2_000_000_000))
        burned = await burnOverflow(rows, offers, coins, dryRun, active)

    const finals = outcomes.map(set => OUTCOMES.find(outcome => set.has(outcome)) ?? "noOffer")
    if (bought > 0 || burned > 0)
        reportStatus("running", "statusBuyToolsBought", { tools: bought, coins: spent + burned })
    else if (finals.every(outcome => outcome == "met"))
        reportStatus("waiting", "statusBuyToolsTargetsMet")
    else {
        const blocker = BLOCKERS.find(b => finals.includes(b))
        reportStatus("waiting", STATUS_KEY[blocker], { tool: String(units.get(rows[finals.indexOf(blocker)].tool).type) })
    }
    return boxMullerRandom(55 * 60_000, 70 * 60_000)
}

events.once("load", () => chore("buyTools", cycle, boxMullerRandom(4 * 60_000, 10 * 60_000)))
