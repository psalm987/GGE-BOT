/**
 * Buying tools from the armourer with coins: what the Armourer plugin and the Khan plugin's defence stock share.
 * A buy is one `sbp` for a package the armourer lists right now.
 */
const err = require("./err.json")
const { xtHandler } = require("./ggeBot.js")
const { resources, activeEvent } = require("./protocols.js")
const { events } = require("./ggeBot.js")
const { ask, chore } = require("./chores.js")
const { pause, boxMullerRandom } = require("./pacing.js")
const loadItem = require("./paths.js").loadItem

const ARMOURER_EVENT = 27

const units = new Map(loadItem("units").map(unit => [Number(unit.wodID), unit]))
const packages = new Map(loadItem("packages").map(pack => [Number(pack.packageID), pack]))

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

/**
 * Tops up tools that have run low, one batch each: a row is `{ tool, keep, have }`, and a tool with `have` below
 * `keep` gets `batch` more, or as many as `maxPerClick` allows. Nothing is bought that would take the coins under
 * `coinFloor` or the run's spending over `spendCap`. Resolves to `{ bought, spent }` in tools and coins.
 */
async function topUp(rows, { kingdom, batch, coinFloor, spendCap, dryRun, active = () => true }) {
    const offers = liveOffers()
    let coins = resources.coins, spent = 0, bought = 0
    if (!Number.isFinite(coins))
        return { bought, spent }
    for (const row of rows) {
        const offer = offers.get(row.tool)
        if (!offer || row.have >= row.keep)
            continue
        const count = Math.min(Math.ceil(batch / offer.perPackage), offer.maxPerClick,
            Math.floor((coins - coinFloor) / offer.price), Math.floor((spendCap - spent) / offer.price))
        if (!(count > 0) || !active())
            continue
        if (await buy(offer, count, kingdom, dryRun) !== 0)
            continue
        spent += count * offer.price
        coins -= count * offer.price
        bought += count * offer.perPackage
        await pause(1500, 4000)
    }
    return { bought, spent }
}

/** A tool that has run low is bought in batches of this many. */
const BATCH = 1000

/**
 * Keeps tools in stock in one kingdom for a plugin, checking about every 30 minutes from a few minutes after login.
 * `stocks` is `[[option key, wodID]]` and `options` the plugin's: a tool whose option is above 0 is bought, one batch
 * at a time, while the kingdom holds fewer than that. `armourerSpendCap` and `armourerCoinFloor` bound each check,
 * and `dryRun` logs the orders instead. With every stock at 0 nothing is started.
 */
function keepStocked(name, stocks, kingdom, options, logKeys) {
    const wanted = stocks.map(([key, tool]) => ({ tool, keep: Number(options[key]) || 0 })).filter(row => row.keep > 0)
    if (wanted.length == 0)
        return
    const stock = require("./plugins/stock.js")
    events.once("load", () => chore(name, async active => {
        await stock.refreshHome()
        const rows = wanted.map(row => ({ ...row, have: stock.toolStock(row.tool, { kingdom }).total }))
        const { bought, spent } = await topUp(rows, {
            kingdom, batch: BATCH, dryRun: Boolean(options.dryRun), active,
            coinFloor: Number(options.armourerCoinFloor) || 0, spendCap: Number(options.armourerSpendCap) || 0,
        })
        if (bought > 0)
            console.info(logKeys[0], bought, " ", logKeys[1], spent)
        return boxMullerRandom(25 * 60_000, 35 * 60_000)
    }, boxMullerRandom(3 * 60_000, 8 * 60_000)))
}

module.exports = { ARMOURER_EVENT, units, liveOffers, buy, topUp, keepStocked }
