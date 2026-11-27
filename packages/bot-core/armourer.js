/**
 * Buying tools from the armourer with coins: what the Armourer plugin and the Khan plugin's defence stock share.
 * A buy joins the castle, opens its armourer (`gbc`) and sends one `sbp` for a package the armourer lists right now,
 * as the game's client does. After Lazy Lord's armorerTools.js (MIT).
 */
const err = require("./err.json")
const { xtHandler } = require("./ggeBot.js")
const { resources, activeEvent, castles, AreaType, setCastle, shopTurn } = require("./protocols.js")
const { events } = require("./ggeBot.js")
const { ask, chore } = require("./chores.js")
const { pause, boxMullerRandom } = require("./pacing.js")
const loadItem = require("./paths.js").loadItem

const ARMOURER_EVENT = 27

const units = new Map(loadItem("units").map(unit => [Number(unit.wodID), unit]))
const packages = new Map(loadItem("packages").map(pack => [Number(pack.packageID), pack]))

/**
 * The armourer's entry when a list last brought it in, and when it closes (ms). The game sends the event list of the
 * place the player is in, and a place without the armourer, such as the Berimond camp, leaves it out. So a list
 * without it does not close it: only its end time (`RS`, seconds left) does. Lazy Lord (medium).
 */
let lastListed
events.on("eventStart", e => {
    if (e?.EID == ARMOURER_EVENT)
        lastListed = { entry: e, closesAt: Date.now() + Number(e.RS) * 1000 }
})
/** The armourer's `sei` entry while it is open, or undefined. */
const armourerEntry = () => activeEvent(ARMOURER_EVENT) ?? (Date.now() < lastListed?.closesAt ? lastListed.entry : undefined)

const MAIN_TYPES = [AreaType.mainCastle, AreaType.externalKingdom, AreaType.beriCastle]
/** The kingdom's main castle: the home castle, or the castle of an outer kingdom. */
const mainCastle = kingdom => castles.find(castle => castle.kingdomID == kingdom && castle.areaInfo && MAIN_TYPES.includes(castle.areaInfo.type))

/** The package ids the armourer lists in its `sei` entry, whether the game sends an array or a comma list. */
function livePackageIDs() {
    const listed = armourerEntry()?.PIDS
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
 * Buys `packagesToBuy` of `offer` into `castle`, one of the account's castles. Resolves to the game's result (0 when
 * the buy went through), after taking the new coin count from the reply: undefined when no reply came, or the error's
 * name when the castle could not be joined. With `dryRun` it logs the order and sends nothing.
 *
 * `sbp` names no castle, so the bot first joins the castle and opens its armourer (`gbc`), as the game's client does.
 * The reply names no purchase either: the armourer's buys wait their turn in `shopTurn`, and a success whose `grc`
 * is another kingdom's castle, such as a Storm shop buy that `attackStormForts.js` sends outside the turn, is not ours.
 */
async function buy(offer, packagesToBuy, castle, dryRun) {
    const kingdom = castle.kingdomID
    const order = { PID: offer.pid, BT: 0, TID: ARMOURER_EVENT, AMT: packagesToBuy, KID: kingdom, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }
    if (dryRun) {
        console.log("dryRunSbp", JSON.stringify(order))
        return 0
    }
    const ours = (reply, result) => result != 0 || reply.grc?.KID === undefined || reply.grc.KID == kingdom
    let reply, result
    try {
        ({ reply, result } = await setCastle(castle, () => shopTurn(async () => {
            await ask("gbc", { CID: castle.id, KID: kingdom })
            return ask("sbp", order, undefined, ours)
        })))
    } catch (error) {
        result = String(error?.message ?? error)
    }
    console.debug("armourerBuyReply", castle.id, result, reply?.grc?.AID)
    if (result === 0 && reply.gcu)
        xtHandler.emit("gcu", reply.gcu)
    if (result !== 0)
        console.warn("buyToolsRefused", JSON.stringify(order), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
    return result
}

/**
 * Tops up tools that have run low in `castle`, or else in `kingdom`'s main castle, one batch each: a row is `{ tool, keep, have, batch? }`,
 * and a tool with `have` below `keep` gets its row's `batch` or else `batch` more, or as many as `maxPerClick` allows.
 * Nothing is bought that would take the coins under `coinFloor` or the run's spending over `spendCap`. Resolves to
 * `{ bought, spent }` in tools and coins.
 */
async function topUp(rows, { kingdom, castle = mainCastle(kingdom), batch = 0, coinFloor, spendCap, dryRun, active = () => true }) {
    const offers = liveOffers()
    let coins = resources.coins, spent = 0, bought = 0
    if (!Number.isFinite(coins) || !castle)
        return { bought, spent }
    for (const row of rows) {
        const offer = offers.get(row.tool)
        if (!offer || row.have >= row.keep)
            continue
        const count = Math.min(Math.ceil((row.batch ?? batch) / offer.perPackage), offer.maxPerClick,
            Math.floor((coins - coinFloor) / offer.price), Math.floor((spendCap - spent) / offer.price))
        if (!(count > 0) || !active())
            continue
        if (await buy(offer, count, castle, dryRun) !== 0)
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

module.exports = { ARMOURER_EVENT, units, mainCastle, liveOffers, buy, topUp, keepStocked }
