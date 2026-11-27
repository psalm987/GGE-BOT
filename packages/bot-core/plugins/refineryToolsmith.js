/**
 * Refinery and Toolsmith components: keeps each picked building's crafting and queue slots busy with the products the
 * player picks, taking them in turn, and keeps the extra slots the player picks rented for coins. It never makes a recipe
 * priced in rubies and never rents for rubies. Ported from Lazy Lord's be/plugins/refineryToolsmith.js (MIT). The
 * requests and replies are in docs/protocol/crafting.md.
 */

/**
 * The products a row may pick, by product number (the index + 1): the game's recipe group and the building that makes
 * it (crin's CQID: 1 Refinery, 2 Toolsmith). The numbers are the craftProduct column's values, so they never change.
 */
const PRODUCTS = [
    { group: 1, building: 1, name: "Refined wood" },
    { group: 2, building: 1, name: "Refined stone" },
    { group: 13, building: 1, name: "Steel" },
    { group: 14, building: 1, name: "Dragon glass" },
    { group: 3, building: 2, name: "Screws" },
    { group: 4, building: 2, name: "Black powder" },
    { group: 5, building: 2, name: "Saw" },
    { group: 6, building: 2, name: "Drill" },
    { group: 7, building: 2, name: "Crowbar" },
    { group: 8, building: 2, name: "Leather strips" },
    { group: 9, building: 2, name: "Chains" },
    { group: 10, building: 2, name: "Metal plates" },
]
const LENGTHS = ["Short", "Long"]

const optionDefs = [
    {
        type: "Rows",
        key: "craftRows",
        columns: [
            { key: "castle", type: "castle" },
            { key: "craftProduct", type: "number", min: 1, max: PRODUCTS.length },
            { key: "craftLength", type: "number", min: 0, max: LENGTHS.length - 1, default: 0 },
            { key: "rentProductionSlots", type: "number", min: 0, max: 1, default: 0 },
            { key: "rentQueueSlots", type: "number", min: 0, max: 3, default: 0 },
        ],
        default: [],
    },
    { type: "Number", key: "rentCoinCap", min: 0, max: 100_000_000, step: 500_000, unit: "coins", default: 10_000_000 },
    { type: "Number", key: "coinFloor", min: 0, max: 2_147_483_647, step: 100_000, unit: "coins", default: 1_000_000 },
    { type: "Checkbox", key: "dryRunOrders", default: false },
]

if (require("node:worker_threads").isMainThread)
    return module.exports = { pluginOptions: optionDefs }

const err = require("../err.json")
const { events, botConfig, xtHandler } = require("../ggeBot.js")
const { castles, resources } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const { refusalMemory } = require("../refusals.js")
const { MAIN_CASTLE } = require("../legacyOptions.js")
const stock = require("./stock.js")
const { loadItem } = require("../paths.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusCraftingStarting")

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE
/** enableCraftingRecipes: `616&id#id…` in a building's areaSpecificEffects, a research's effects, or crin's CE. */
const ENABLE_RECIPES = "616"
/** The building states crin's S takes while a building can't craft (being built, stopped, being taken down), from Lazy Lord's source. */
const NOT_WORKING = new Set([0, 1, 2, 5, 6])
const NO_FREE_SLOT = 63
const MAX_CRAFTS_A_ROUND = 6
const MAIN_CASTLE_TYPES = [1, 12, 15]

const recipes = loadItem("craftingRecipes")
const queues = new Map(loadItem("craftingQueues").map(q => [Number(q.queueTypeId), q]))
const buildingRows = loadItem("buildings").filter(b => b.name == "Refinery" || b.name == "Toolsmith")
const researchEffects = new Map(loadItem("researches").map(r => [Number(r.researchID), String(r.effects ?? "")]))
const BUILDING_NAMES = { 1: "Refinery", 2: "Toolsmith" }
const groupOfRecipe = new Map(recipes.map(r => [Number(r.craftingRecipeId), Number(r.recipeGroupID)]))

/** What one craft costs, by the holder that pays: the castle for its resources, the account for refined wood and stone. */
const CASTLE_PAYS = { costWood: "wood", costStone: "stone", costCoal: "coal", costOil: "oil", costGlass: "glass", costIron: "iron" }
const ACCOUNT_PAYS = { costRefinedLumber: "refinedLumber", costRefinedStone: "refinedStone" }
const costsOf = recipe => Object.entries(recipe).filter(([k, v]) => k.startsWith("cost") && Number(v) > 0).map(([k, v]) => [k, Number(v)])

/** The recipe ids in a `616&a#b` effect list, or in an effect value. */
const recipeIds = text => String(text).split(/[#,+&]/).map(Number).filter(n => Number.isInteger(n) && n > 0)
const enabledIn = effects => String(effects ?? "").split(",").filter(part => part.startsWith(`${ENABLE_RECIPES}&`)).flatMap(part => recipeIds(part.slice(4)))
const numbers = text => String(text ?? "").split(",").map(Number).filter(n => n > 0)

// ---- What the game told us ----

/** Crafting buildings by `<kingdom>:<castle>:<CQID>`: `{ KID, AID, OID, queueType, state, PS, QS, effectRecipes }`. */
const workshops = new Map()
const keyOf = (kingdom, castleID, queueType) => `${kingdom}:${castleID}:${queueType}`
const isEntry = obj => Number.isFinite(Number(obj?.AID)) && obj?.CQID !== undefined

function readEntry(b, effectRecipes) {
    const key = keyOf(Number(b.KID), Number(b.AID), Number(b.CQID))
    workshops.set(key, {
        KID: Number(b.KID), AID: Number(b.AID), OID: Number(b.OID), queueType: Number(b.CQID), state: Number(b.S),
        PS: b.PS ?? {}, QS: b.QS ?? {}, effectRecipes: effectRecipes ?? workshops.get(key)?.effectRecipes ?? [],
    })
}

/** crin's CE pairs `[effectID, value]` that unlock recipes, for the buildings of the same CAI entry. */
const effectRecipesOf = list => (Array.isArray(list) ? list : []).filter(e => Array.isArray(e) && String(e[0]) == ENABLE_RECIPES).flatMap(e => [e[1]].flat(3).flatMap(recipeIds))

xtHandler.on("crin", (obj, result) => {
    if (Number(result) != 0)
        return
    for (const area of [obj?.CAI ?? []].flat()) {
        const effectRecipes = effectRecipesOf(area?.CE)
        for (const b of area?.CBI ?? [])
            if (isEntry(b))
                readEntry(b, effectRecipes)
    }
})
for (const cmd of ["crst", "crun", "crca", "crqm", "crsk"])
    xtHandler.on(cmd, (obj, result) => Number(result) == 0 && isEntry(obj) && readEntry(obj))

/** Recipes the bought research unlocks, from rei's BR; undefined until rei has answered. */
let researchRecipes
let researchAskedAt = -Infinity
async function readResearch() {
    if (Date.now() - researchAskedAt < HOUR)
        return
    researchAskedAt = Date.now()
    const { reply, result } = await ask("rei", {})
    if (result === 0 && Array.isArray(reply.BR))
        researchRecipes = new Set(reply.BR.flatMap(id => enabledIn(researchEffects.get(Number(id)))))
}

// ---- Slots ----

/**
 * One kind of a building's slots, as the client builds them: the permanent ones first, then the rentable ones in rent
 * order. CRID holds the recipe in each slot (in slot order) and RUT the seconds left on each rentable slot; a rentable
 * slot with nothing left is locked.
 */
function slotsOf(b, kind) {
    const q = queues.get(b.queueType)
    const permanent = Number(kind == "production" ? q?.permanentProductionSlots : q?.permanentQueueSlots) || 0
    const costs = numbers(kind == "production" ? q?.productionSlotUnlockCostC1 : q?.queueSlotUnlockCostC1)
    const list = kind == "production" ? b.PS : b.QS
    return Array.from({ length: permanent + costs.length }, (_, index) => {
        const rentIndex = index - permanent, rentable = rentIndex >= 0
        const rentLeft = rentable ? Number(list?.RUT?.[rentIndex]) || 0 : Infinity
        return { kind, index, rentIndex, rentable, cost: rentable ? costs[rentIndex] : 0, rentLeft, locked: rentLeft <= 0, busy: Number(list?.CRID?.[index]) > 0 }
    })
}
const freeSlots = b => ["production", "queue"].flatMap(kind => slotsOf(b, kind)).filter(s => !s.locked && !s.busy)

/** What a request the game accepted changed, for a reply that didn't carry the building's entry (and for a dry run). */
function takeSlot(b, slot, recipeID) {
    const list = slot.kind == "production" ? b.PS : b.QS
    list.CRID = Object.assign([], list.CRID)
    list.CRID[slot.index] = recipeID
}
function rentSlot(b, slot) {
    const list = slot.kind == "production" ? b.PS : b.QS
    const q = queues.get(b.queueType)
    list.RUT = Object.assign([], list.RUT)
    list.RUT[slot.rentIndex] = Number(slot.kind == "production" ? q?.productionSlotUnlockDuration : q?.queueSlotUnlockDuration) || 604_800
}

// ---- The plan ----

const asRows = value => Array.isArray(value) ? value : []
const asNumber = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback

const castleOf = ref => castles.find(c => c.kingdomID == ref.kingdom && c.areaInfo && (ref.id == MAIN_CASTLE ? MAIN_CASTLE_TYPES.includes(c.areaInfo.type) : c.id == ref.id))

/**
 * The rows grouped by building: `{ key, ref, castle, queueType, products: [{ product, length }], rentProduction, rentQueue }`.
 * A product names its building, so rows of one castle's Refinery or Toolsmith join, in row order; the slots to rent are
 * the most any of them asks for. `key` is the building's key in `workshops`; `castle` is undefined while the bot doesn't
 * know the castle.
 */
function plan() {
    const plans = new Map()
    for (const row of asRows(pluginOptions.craftRows)) {
        const product = PRODUCTS[Number(row.craftProduct) - 1]
        const ref = row.castle
        if (!product || !Number.isInteger(ref?.kingdom) || !Number.isInteger(ref?.id))
            continue
        const castle = castleOf(ref)
        const key = castle ? keyOf(castle.kingdomID, castle.id, product.building) : keyOf(ref.kingdom, ref.id, product.building)
        const entry = plans.get(key) ?? { key, ref, castle, queueType: product.building, products: [], rentProduction: 0, rentQueue: 0 }
        plans.set(key, entry)
        if (!entry.products.some(p => p.product == product))
            entry.products.push({ product, length: LENGTHS[Number(row.craftLength)] ?? "Short" })
        entry.rentProduction = Math.max(entry.rentProduction, Math.min(1, asNumber(row.rentProductionSlots, 0)))
        entry.rentQueue = Math.max(entry.rentQueue, Math.min(3, asNumber(row.rentQueueSlots, 0)))
    }
    return [...plans.values()]
}

/** The building's row in buildings.json: its castle layout's level when the bot has read it, else level 1 in its kingdom. */
function buildingRowOf(castle, b) {
    const wodID = castle.buildings?.find(x => x.ownerID == b.OID)?.wodID
    return buildingRows.find(r => Number(r.wodID) == wodID) ??
        buildingRows.find(r => r.name == BUILDING_NAMES[b.queueType] && Number(r.level) == 1 && String(r.kIDs).split(",").includes(String(castle.kingdomID)))
}

/**
 * The recipe to make for a product and length: the highest level the building, research and crin's effects have
 * unlocked, that the building's level allows. Ruby recipes, and any recipe with a ruby price, are never picked.
 */
function bestRecipe({ product, length }, row, b) {
    const learned = new Set([...enabledIn(row?.areaSpecificEffects), ...(researchRecipes ?? []), ...b.effectRecipes])
    return recipes
        .filter(r => Number(r.recipeGroupID) == product.group && r.type == length && !(Number(r.costC2) > 0) && learned.has(Number(r.craftingRecipeId)))
        .filter(r => !r.requiredCraftingBuildings || String(r.requiredCraftingBuildings).split(",").includes(String(row?.wodID)))
        .sort((x, y) => Number(y.level) - Number(x.level))[0]
}

/**
 * What the castle or the account holds of a cost, less what this round has spent of it (`round.used`). The bot's shared
 * counts are left alone: the next round reads the castle again, and the game sends the account's currencies. A cost the
 * bot doesn't track holds nothing.
 */
function held(field, castle, round) {
    const key = field in CASTLE_PAYS ? `${castle.kingdomID}:${castle.id}:${field}` : field
    const have = field in CASTLE_PAYS ? Number(castle[CASTLE_PAYS[field]]) : field in ACCOUNT_PAYS ? Number(resources[ACCOUNT_PAYS[field]]) || 0 : 0
    return { key, left: have - (round.used.get(key) ?? 0) }
}
const affordable = (recipe, castle, round) => costsOf(recipe).every(([field, need]) => held(field, castle, round).left >= need)
function pay(recipe, castle, round) {
    for (const [field, need] of costsOf(recipe)) {
        const { key } = held(field, castle, round)
        round.used.set(key, (round.used.get(key) ?? 0) + need)
    }
}

/** The product started last in a building, as the game shows it: the last one waiting in the queue, else the crafting slot with the most time left. */
function lastStartedGroup(b) {
    const queued = asRows(b.QS?.CRID).map(Number).filter(id => id > 0)
    if (queued.length)
        return groupOfRecipe.get(queued.at(-1))
    const crafting = asRows(b.PS?.CRID).map((id, i) => ({ id: Number(id), left: Number(b.PS.RCT?.[i]) || 0 })).filter(s => s.id > 0).sort((x, y) => y.left - x.left)
    return crafting.length ? groupOfRecipe.get(crafting[0].id) : undefined
}

// ---- A round ----

/** Where each building's turn of products carries on, by plan key. */
const turn = new Map()
/** Refusals other than "all full" and "too few resources" hold the building back: 15 min, then 30, up to an hour. */
const learned = refusalMemory()
/** Buildings already reported missing, so each is logged once a session. */
const missingLogged = new Set()

const isShort = code => /^NOT_ENOUGH/.test(String(err[code] ?? ""))

/**
 * Sends a crafting request, or in a dry run only pretends the game took it. A refusal other than "all full" and "too
 * few resources" is logged here.
 */
async function send(cmd, request, round) {
    if (round.dryRun)
        return { result: 0 }
    const { reply, result } = await ask(cmd, request)
    if (result !== 0 && result !== NO_FREE_SLOT && !isShort(result))
        console.warn("craftingRefused", cmd, JSON.stringify(request), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
    return { reply, result }
}

/** Copies the building's entry a reply carried (which the crafting listener has read) into `b`; false when it carried none. */
function refreshFrom(reply, entry, b) {
    if (!isEntry(reply))
        return false
    Object.assign(b, workshops.get(entry.key))
    return true
}

/**
 * Rents the picked slots of one kind that are locked now, in order. Coins only, within what the round may still spend
 * and above the coin floor. Returns "rented", "capped", "refused" or nothing to do.
 */
async function rent(entry, b, kind, wanted, round) {
    const outcomes = new Set()
    for (;;) {
        const slot = slotsOf(b, kind).filter(s => s.rentable).slice(0, wanted).find(s => s.locked)
        if (!slot)
            return outcomes
        if (!(round.spent + slot.cost <= round.cap && Number(resources.coins) - round.spent - slot.cost >= round.floor)) {
            outcomes.add("capped")
            return outcomes
        }
        const request = { KID: b.KID, AID: b.AID, OID: b.OID, S: [slot.index], ST: kind }
        const { result, reply } = await send("crun", request, round)
        if (result !== 0) {
            outcomes.add("refused")
            return outcomes
        }
        console.log(round.dryRun ? "dryRunCrun" : "craftingRented", JSON.stringify(request), " ", slot.cost)
        if (!refreshFrom(reply, entry, b))
            rentSlot(b, slot)
        round.spent += slot.cost
        round.slots++
        outcomes.add("rented")
        await pause(2000, 4000)
    }
}

/** Fills the free slots with the picked products in turn, skipping any the castle can't pay for now. */
async function fill(entry, castle, b, round) {
    const row = buildingRowOf(castle, b)
    const outcomes = new Set()
    for (let i = 0; i < MAX_CRAFTS_A_ROUND; i++) {
        const free = freeSlots(b)
        if (free.length == 0) {
            outcomes.add("full")
            return outcomes
        }
        const candidates = entry.products.map(p => ({ ...p, recipe: bestRecipe(p, row, b) })).filter(c => c.recipe)
        if (candidates.length == 0) {
            outcomes.add("nothingUnlocked")
            return outcomes
        }
        if (!turn.has(entry.key)) {
            const at = candidates.findIndex(c => c.product.group == lastStartedGroup(b))
            turn.set(entry.key, at == -1 ? 0 : at + 1)
        }
        const start = turn.get(entry.key) % candidates.length
        const pick = candidates.map((_, k) => candidates[(start + k) % candidates.length]).find(c => affordable(c.recipe, castle, round))
        if (!pick) {
            outcomes.add("short")
            round.short ??= candidates[start].product.name
            return outcomes
        }
        const request = { KID: b.KID, AID: b.AID, OID: b.OID, PWR: 0, CRID: Number(pick.recipe.craftingRecipeId) }
        const { result, reply } = await send("crst", request, round)
        if (result !== 0) {
            const outcome = result === NO_FREE_SLOT ? "full" : isShort(result) ? "short" : "refused"
            if (outcome == "short")
                round.short ??= pick.product.name
            outcomes.add(outcome)
            return outcomes
        }
        console.log(round.dryRun ? "dryRunCrst" : "craftingStarted", JSON.stringify(request), " ", pick.product.name)
        if (!refreshFrom(reply, entry, b))
            takeSlot(b, free[0], request.CRID)
        pay(pick.recipe, castle, round)
        turn.set(entry.key, candidates.indexOf(pick) + 1)
        round.crafts++
        outcomes.add("started")
        await pause(2000, 4000)
    }
    return outcomes
}

/** The blockers in the order the status names them when nothing was started or rented. */
const BLOCKERS = ["refused", "noBuilding", "notWorking", "nothingUnlocked", "capped", "short", "full"]
const STATUS_KEY = {
    refused: "statusCraftingRefused", noBuilding: "statusCraftingNoBuilding", notWorking: "statusCraftingNotWorking", nothingUnlocked: "statusCraftingNothingUnlocked",
    capped: "statusCraftingRentCapped", short: "statusCraftingShort", full: "statusCraftingFull",
}

const interval = () => boxMullerRandom(9 * MINUTE, 11 * MINUTE)

async function cycle(active) {
    const entries = plan()
    if (entries.length == 0) {
        reportStatus("waiting", "statusCraftingNoRows")
        return HOUR
    }
    await readResearch()
    await stock.refreshHome()
    const { result } = await ask("crin", {})
    if (result !== 0) {
        reportStatus("waiting", "statusCraftingNoAnswer")
        return interval()
    }

    const round = {
        dryRun: Boolean(pluginOptions.dryRunOrders), cap: asNumber(pluginOptions.rentCoinCap, 10_000_000), floor: asNumber(pluginOptions.coinFloor, 1_000_000),
        spent: 0, used: new Map(), slots: 0, crafts: 0, short: undefined,
    }
    const outcomes = new Set()
    for (const entry of entries) {
        if (!active())
            return
        const found = entry.castle && workshops.get(entry.key)
        if (!found) {
            outcomes.add("noBuilding")
            if (!missingLogged.has(entry.key)) {
                missingLogged.add(entry.key)
                console.warn("craftingNoBuilding", JSON.stringify(entry.ref), " ", BUILDING_NAMES[entry.queueType])
            }
            continue
        }
        if (NOT_WORKING.has(found.state)) {
            outcomes.add("notWorking")
            continue
        }
        if (learned.holding(entry.key)) {
            outcomes.add("refused")
            continue
        }
        // A dry run changes a copy, so the next round reads the game's own state again.
        const b = round.dryRun ? structuredClone(found) : found
        const done = new Set()
        for (const [kind, wanted] of [["production", entry.rentProduction], ["queue", entry.rentQueue]])
            if (!done.has("refused"))
                (await rent(entry, b, kind, wanted, round)).forEach(o => done.add(o))
        if (!done.has("refused"))
            (await fill(entry, entry.castle, b, round)).forEach(o => done.add(o))
        if (done.has("refused"))
            learned.refused(entry.key, "refused")
        else
            learned.accepted(entry.key)
        done.forEach(o => outcomes.add(o))
    }

    if (round.crafts + round.slots > 0)
        reportStatus(round.dryRun ? "waiting" : "running", round.dryRun ? "statusCraftingDryRun" : "statusCraftingStarted", { crafts: round.crafts, slots: round.slots, coins: round.spent })
    else {
        const blocker = BLOCKERS.find(b => outcomes.has(b)) ?? "full"
        reportStatus("waiting", STATUS_KEY[blocker], blocker == "short" ? { product: round.short } : {})
    }

    const expiry = entries.flatMap(entry => {
        const b = entry.castle && workshops.get(entry.key)
        return b ? [["production", entry.rentProduction], ["queue", entry.rentQueue]].flatMap(([kind, wanted]) =>
            slotsOf(b, kind).filter(s => s.rentable).slice(0, wanted).filter(s => !s.locked).map(s => s.rentLeft)) : []
    })
    const next = interval()
    return expiry.length ? Math.min(next, Math.min(...expiry) * SECOND + boxMullerRandom(30 * SECOND, 3 * MINUTE)) : next
}

events.once("load", () => chore("refineryToolsmith", cycle, boxMullerRandom(2 * MINUTE, 5 * MINUTE)))
