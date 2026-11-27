/**
 * The Build plugin's decisions, all pure: which buildings a plan may name, what the game would refuse, what a castle
 * does next, what the rest of its plan costs, and which requests may leave at all. plugins/build.js reads the game and
 * sends; this module only decides. Ported from Lazy Lord's be/plugins/build.js (MIT). The requests are in
 * docs/protocol/build.md.
 *
 * @typedef {{ building: string, level: number, count: number }} PlanEntry
 * `building` is a kind's name. The castle should have `count` of it at `level` or higher.
 * @typedef {{ useSkips: boolean, buyExpansions: boolean, entries: PlanEntry[] }} CastlePlan
 * @typedef {{
 *   kingdomID: number, areaType: number, layout: import("./castleLayout.js").CastleLayout, slots: number[],
 *   stock: Record<string, number>, storage: Record<string, number>,
 * }} CastleView
 * `slots` is the build queue, -1 for a free slot. `stock` and `storage` are what the castle holds and can hold, by
 * resource. A storage that isn't a number is unknown.
 * @typedef {{
 *   player: { level?: number, legendLevel?: number }, coins: number, currencies: Record<string, number>,
 *   coinFloor: number, resourceFloor: number, held: (key: string) => boolean, leftChests: Set<number>, skips: boolean,
 * }} Context
 * `held(key)` says whether the game refused a plan row (by building name) or "expansion" lately. `leftChests` holds the
 * chests the game refused. `skips` is false once the account ran out of time skips.
 */
const { loadItem } = require("./paths.js")
const layoutKit = require("./castleLayout.js")
const builder = require("./castleBuilder.js")

const { byWod, findSpot, expansionSpots, expansionLimit, expansionRow, timeLeft, CASTLE_GROUND, BUILD_IN_PROGRESS, UPGRADE_IN_PROGRESS, IDLE_STATES, IN_PROGRESS_STATES } = layoutKit
const buildings = loadItem("buildings")

const num = value => Number(value) || 0
const idList = value => String(value ?? "").split(",").filter(Boolean).map(Number)

// ---- What a building may cost ----

/** The castle's own resources a building may cost, by the row's cost field. */
const RESOURCE_COSTS = Object.freeze({ costWood: "wood", costStone: "stone", costCoal: "coal", costOil: "oil", costGlass: "glass", costIron: "iron", costAquamarine: "aqua" })
/** The construction currencies a building may cost, by the row's cost field: the names protocols.js tracks them under. */
const CURRENCY_COSTS = Object.freeze({
    costLegendaryToken: "legendaryToken", costLegendaryMaterial: "legendaryMaterial", costFloraToken: "floraToken",
    costSceatToken: "sceatToken", costGoldToken: "goldToken", costPlaster: "plaster", costDragonScaleTile: "dragonScaleTile",
    costCommonTimber: "commonTimber", costCommonStraw: "commonStraw", costRareNails: "rareNails", costRareGlue: "rareGlue",
    costSamuraiToken: "samuraiToken", costKhanTablet: "khanTablet", costKhanMedal: "khanMedal", costImperialDucat: "imperialDucat",
})
const COINS = "costC1"
const PAYABLE = new Set([...Object.keys(RESOURCE_COSTS), ...Object.keys(CURRENCY_COSTS), COINS])
const costsOf = row => Object.keys(row).filter(key => key.startsWith("cost") && Number(row[key]) > 0)
/** Every price of the row is coins, a castle resource or a tracked currency. Rubies (`costC2`) are none of them. */
const hasPlainCosts = row => costsOf(row).every(key => PAYABLE.has(key))
/** Requirements the bot can't check. A row with one is never built. */
const UNCHECKABLE = ["effectLocked", "sceatSkillLocked", "slumLevelNeeded", "skillUnlockID"]
const isCheckable = row => UNCHECKABLE.every(key => row[key] === undefined || row[key] === "" || row[key] === "0")
const buildable = row => Boolean(row) && builder.rubyFree(row) && hasPlainCosts(row) && isCheckable(row)

// ---- The kinds a plan may name ----

const BERIMOND = 10
const isBerimond = row => idList(row?.kIDs).includes(BERIMOND)
/** A building's name in a plan: its own, but each Berimond decoration by its type, as they share one name. */
const planName = row => row?.name == "FactionDeco" ? row.type : row?.name
/** Berimond camp buildings Lazy Lord chose not to offer. */
const BERIMOND_LEFT_OUT = new Set(["FactionGuardpost", "FactionHospital", "FactionStable", "FactionMarket"])

/**
 * The first level of a building the shop sells: civil and military buildings and the Berimond camp's decorations, at
 * level 1, with a price the bot may pay. Districts, event buildings other than Berimond's and skins are left out.
 */
const isShopFirstLevel = row => row.group == "Building" && !row.downgradeWodID && Number(row.level) == 1 && !BERIMOND_LEFT_OUT.has(row.name) &&
    (["CIVIL", "MILITARY"].includes(row.shopCategory) || (row.shopCategory == "DECO" && row.name == "FactionDeco" && isBerimond(row))) &&
    !row.isDistrict && (!row.eventIDs || isBerimond(row)) && !row.skinID && costsOf(row).length > 0 && buildable(row)

/** A building's levels from `first`, as far as each is one the bot may build. */
function levelsFrom(first) {
    const levels = [first]
    for (let row = byWod.get(Number(first.upgradeWodID)); buildable(row); row = byWod.get(Number(row.upgradeWodID)))
        levels.push(row)
    return levels
}

const berimondFirst = name => buildings.find(r => r.name == name && Number(r.level) == 1 && isBerimond(r) && !r.downgradeWodID)
const CASTLE_KINDS = { notKingdoms: [BERIMOND], category: "CASTLE" }
/**
 * Kinds a castle is given and the bot only upgrades, by plan name: `first` is the level-1 row, `pool` where the layout
 * keeps it, `command` the request that upgrades it, and `all` means every one the castle has. A tower's empty spot is
 * the game's level 0 and is left alone. The Berimond camp has its own two.
 */
const UPGRADE_ONLY = Object.entries({
    Keep: { ...CASTLE_KINDS, first: buildings.find(r => r.group == "Building" && r.name == "Keep" && !r.downgradeWodID), pool: "buildings", nameKey: "keep_name" },
    Castlewall: { ...CASTLE_KINDS, first: byWod.get(501), pool: "defences", command: "eud", nameKey: "castlewall_name" },
    Moat: { ...CASTLE_KINDS, first: byWod.get(455), pool: "defences", nameKey: "basic_moat_name" },
    Gate: { ...CASTLE_KINDS, first: byWod.get(450), pool: "gates", nameKey: "gate_name" },
    Towers: { ...CASTLE_KINDS, first: byWod.get(402), pool: "towers", nameKey: "guard_tower_name", all: true },
    FactionBarracks: { first: berimondFirst("FactionBarracks"), pool: "buildings", category: "MILITARY", kingdoms: [BERIMOND] },
    FactionUnitCamp: { first: berimondFirst("FactionUnitCamp"), pool: "buildings", category: "MILITARY", kingdoms: [BERIMOND] },
}).filter(([, kind]) => kind.first)

/**
 * @typedef {{
 *   name: string, category: string, upgradeOnly: boolean, all: boolean, pool: string, command: string, firsts: object[],
 *   wods: Set<number>, kingdoms: number[], notKingdoms: number[], areaTypes: number[], maxLevel: number, maxCount: number,
 *   requires: [number, number][], nameKey: string,
 * }} Kind
 * `firsts` holds a level-1 row for each kingdom's version. `wods` is every wodID of the kind. `kingdoms` and
 * `areaTypes` are empty for anywhere. `maxCount` is 0 for no limit. `requires` is each level's required level and
 * legend level, level 1 first.
 * @type {Map<string, Kind>}
 */
const kinds = new Map()
const requiresOf = levels => levels.map(row => [num(row.requiredLevel), num(row.requiredLegendLevel)])
const union = (...lists) => [...new Set(lists.flat())].sort((a, b) => a - b)
for (const first of buildings.filter(isShopFirstLevel)) {
    const name = planName(first)
    const levels = levelsFrom(first)
    const kind = kinds.get(name) ?? {
        name, category: first.shopCategory, upgradeOnly: false, all: false, pool: "buildings", command: "eup", firsts: [], wods: new Set(),
        kingdoms: [], notKingdoms: [], areaTypes: [], maxLevel: 0, maxCount: 0, requires: [],
        nameKey: first.name == "FactionDeco" ? `factiondeco_${String(first.type).toLowerCase()}_name` : `${name.toLowerCase()}_name`,
    }
    kind.firsts.push(first)
    levels.forEach(row => kind.wods.add(Number(row.wodID)))
    if (levels.length > kind.maxLevel) {
        kind.maxLevel = levels.length
        kind.requires = requiresOf(levels)
    }
    kind.maxCount = Math.max(kind.maxCount, num(first.maximumCount))
    kind.kingdoms = union(kind.kingdoms, idList(first.kIDs))
    kind.areaTypes = union(kind.areaTypes, idList(first.onlyInAreaTypes))
    kinds.set(name, kind)
}
for (const [name, { first, pool, command = "eup", category, nameKey, all = false, kingdoms = [], notKingdoms = [] }] of UPGRADE_ONLY) {
    const levels = levelsFrom(first)
    // The whole chain is the kind, so a level the bot can't build is still found in the castle.
    const wods = new Set()
    for (let row = first; row && !wods.has(Number(row.wodID)); row = byWod.get(Number(row.upgradeWodID)))
        wods.add(Number(row.wodID))
    kinds.set(name, {
        name, category, upgradeOnly: true, all, pool, command, firsts: [first], wods, kingdoms, notKingdoms, areaTypes: [],
        maxLevel: num(first.level) + levels.length - 1, maxCount: all ? 0 : 1, requires: requiresOf(levels), nameKey: nameKey ?? `${name.toLowerCase()}_name`,
    })
}

/** Whether a building of the layout is of the plan's kind. */
const isOfKind = (building, kind) => kind.upgradeOnly ? kind.wods.has(building.wodID) :
    planName(byWod.get(building.wodID)) == kind.name && byWod.get(building.wodID)?.group == "Building"
const levelOf = building => num(byWod.get(building.wodID)?.level)
const nextLevel = building => byWod.get(Number(byWod.get(building.wodID)?.upgradeWodID))
/** The castle's buildings of a kind, the highest level first. */
const ofKindIn = (castle, kind) => (castle.layout[kind.pool] ?? []).filter(b => isOfKind(b, kind)).sort((a, b) => levelOf(b) - levelOf(a))
/** The kind's level-1 row for the castle's kingdom. */
const firstLevelFor = (kind, castle) => kind.firsts.find(f => !f.kIDs || idList(f.kIDs).includes(Number(castle.kingdomID)))

/**
 * Each kind as the plan editor offers it (@gge/contracts BuildingChoice), sorted by category and English name. `lang`
 * is the game's English language file: `nameKey` is the key the name is under there, whatever its case, and `label`
 * its text. A kind the file lacks keeps its own name.
 */
function catalogChoices(lang = {}) {
    const keys = new Map(Object.keys(lang).map(key => [key.toLowerCase(), key]))
    return [...kinds.values()].map(kind => {
        const nameKey = keys.get(kind.nameKey) ?? kind.nameKey
        return {
            name: kind.name, nameKey, label: String(lang[nameKey] ?? kind.name), category: kind.category, maxLevel: kind.maxLevel, maxCount: kind.maxCount,
            upgradeOnly: kind.upgradeOnly, all: kind.all, kingdoms: kind.kingdoms, notKingdoms: kind.notKingdoms, areaTypes: kind.areaTypes, requires: kind.requires,
        }
    }).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label) || a.name.localeCompare(b.name))
}

/** The BuildPlan option (@gge/contracts) under `key`. */
const buildPlanOption = (key, lang) => ({ type: "BuildPlan", key, buildings: catalogChoices(lang), default: [] })

// ---- The saved plan ----

/**
 * The saved BuildPlan as the bot works it: `{ castles: [{ ref, useSkips, buyExpansions, entries }], dropped }`. An
 * upgrade-only kind counts once and no building passes the game's limit, whatever was saved. A row the bot can't build
 * is in `dropped` as `{ building, why }`. A castle with no rows and no expansions to buy is left out. The saved plan
 * itself is never changed.
 */
function readPlan(value) {
    const castles = [], dropped = []
    for (const saved of Array.isArray(value) ? value : []) {
        const ref = saved?.castle
        if (!Number.isInteger(ref?.kingdom) || !Number.isInteger(ref?.id))
            continue
        const entries = []
        for (const row of Array.isArray(saved.rows) ? saved.rows : []) {
            const kind = kinds.get(String(row?.building ?? ""))
            const level = Number(row?.level), count = Number(row?.count)
            if (!kind)
                dropped.push({ building: String(row?.building ?? ""), why: "unknown" })
            else if (!Number.isInteger(level) || level < 1 || !Number.isInteger(count) || count < 1)
                dropped.push({ building: kind.name, why: "invalid" })
            else
                entries.push({ building: kind.name, level, count: kind.upgradeOnly ? 1 : kind.maxCount > 0 ? Math.min(count, kind.maxCount) : count })
        }
        const buyExpansions = saved.buyExpansions === true
        if (entries.length || buyExpansions)
            castles.push({ ref: { kingdom: ref.kingdom, id: ref.id }, useSkips: saved.useSkips === true, buyExpansions, entries })
    }
    return { castles, dropped }
}

// ---- What the game would refuse ----

/**
 * Why the game wouldn't allow `row` in `castle` for `player`, or undefined if it would: "notPossible", "needsLevel",
 * "needsLegendLevel", "notInKingdom" or "notInCastleType". A level the bot hasn't read counts as not reached.
 * @param {Pick<CastleView, "kingdomID" | "areaType">} castle
 */
function missingRequirement(row, castle, player) {
    if (!buildable(row))
        return "notPossible"
    if (Number(row.requiredLevel) > 0 && !(player?.level >= Number(row.requiredLevel)))
        return "needsLevel"
    if (Number(row.requiredLegendLevel) > 0 && !(player?.legendLevel >= Number(row.requiredLegendLevel)))
        return "needsLegendLevel"
    if (row.kIDs && !idList(row.kIDs).includes(Number(castle.kingdomID)))
        return "notInKingdom"
    // The Berimond camp takes only its own buildings. The others name no kingdom, which would read as anywhere.
    if (Number(castle.kingdomID) == BERIMOND && !isBerimond(row))
        return "notInKingdom"
    if (row.onlyInAreaTypes && !idList(row.onlyInAreaTypes).includes(Number(castle.areaType)))
        return "notInCastleType"
    return undefined
}

/** A castle resource's shortage for `cost`: "never" when storage can't hold the price above the floor, "now" when the stock is short. */
function resourceShort(resource, cost, castle, floor) {
    const max = Number(castle.storage?.[resource])
    if (Number.isFinite(max) && max > 0 && cost + floor > max)
        return "never"
    return Number(castle.stock?.[resource]) - cost >= floor ? undefined : "now"
}

/**
 * What `row` costs that isn't there: undefined when the castle and the player can pay now and keep their floors, "now"
 * when something is short, "never" when a price is above what the castle can store. An amount the bot hasn't read
 * counts as short.
 * @param {Pick<CastleView, "stock" | "storage">} castle
 * @param {Pick<Context, "coins" | "currencies" | "coinFloor" | "resourceFloor">} ctx
 */
function shortOf(row, castle, ctx) {
    let short
    for (const key of costsOf(row)) {
        const cost = Number(row[key])
        if (key == COINS) {
            if (!(Number(ctx.coins) - cost >= num(ctx.coinFloor)))
                short = "now"
        } else if (CURRENCY_COSTS[key]) {
            if (!(Number(ctx.currencies?.[CURRENCY_COSTS[key]]) >= cost))
                short = "now"
        } else if (RESOURCE_COSTS[key]) {
            const lacking = resourceShort(RESOURCE_COSTS[key], cost, castle, num(ctx.resourceFloor))
            if (lacking == "never")
                return "never"
            short = lacking ?? short
        } else
            return "never"
    }
    return short
}

const payment = (row, castle, ctx) => {
    const short = shortOf(row, castle, ctx)
    return short == "never" ? { kind: "blocked", reason: "overStorage" } : short ? { kind: "wait", reason: "resources" } : undefined
}

// ---- One plan row ----

/**
 * The next thing to do for one plan row: `{ kind: "done" }`, `{ kind: "upgrade", building, row, command }`,
 * `{ kind: "build", row, spot }`, `{ kind: "wait", reason }` with "busy" or "resources", or `{ kind: "blocked", reason }`.
 * The `count` best buildings are raised first, a level at a time, then new ones are built at level 1.
 * @param {PlanEntry} entry
 * @param {CastleView} castle
 * @param {Context} ctx
 */
function nextStep(entry, castle, ctx) {
    const kind = kinds.get(entry.building)
    if (!kind)
        return { kind: "blocked", reason: "notPossible" }
    const kingdomID = Number(castle.kingdomID)
    if (kind.upgradeOnly && ((kind.kingdoms.length && !kind.kingdoms.includes(kingdomID)) || kind.notKingdoms.includes(kingdomID)))
        return { kind: "blocked", reason: "notInKingdom" }
    const have = ofKindIn(castle, kind)
    if (kind.all && have.length == 0)
        return { kind: "blocked", reason: "upgradeOnlyMissing" }
    const count = kind.all ? have.length : entry.count
    if (have.filter(b => levelOf(b) >= entry.level).length >= count)
        return { kind: "done" }

    const queued = new Set(castle.slots.filter(id => id >= 0))
    for (const building of have.slice(0, count)) {
        if (levelOf(building) >= entry.level)
            continue
        if (queued.has(building.objectID) || !IDLE_STATES.has(building.state) || building.damageType > 0)
            return { kind: "wait", reason: "busy" }
        const row = nextLevel(building)
        const missing = missingRequirement(row, castle, ctx.player)
        if (missing)
            return { kind: "blocked", reason: missing }
        return payment(row, castle, ctx) ?? { kind: "upgrade", building, row, command: kind.command }
    }
    if (have.length >= count)
        return { kind: "wait", reason: "busy" }
    if (kind.upgradeOnly)
        return { kind: "blocked", reason: "upgradeOnlyMissing" }

    const first = firstLevelFor(kind, castle)
    const missing = missingRequirement(first, castle, ctx.player)
    if (missing)
        return { kind: "blocked", reason: missing }
    if (Number(first.maximumCount) > 0 && have.length >= Number(first.maximumCount))
        return { kind: "blocked", reason: "atLimit" }
    const unpaid = payment(first, castle, ctx)
    if (unpaid)
        return unpaid
    const spot = findSpot(castle.layout, first)
    return spot ? { kind: "build", row: first, spot } : { kind: "blocked", reason: "noSpace", have: have.length, want: count }
}

// ---- Expansions ----

const expansionsBought = castle => castle.layout.grounds.filter(g => g.wodID != CASTLE_GROUND).length
/** An expansion the bot can check and pay: no legendary skill, effect or legendary price. Its ruby price is the other way to pay and is never used. */
const plainExpansion = row => Boolean(row) && ![row.sceatSkillLocked, row.effectLocked, row.costLegendaryToken, row.costLegendaryMaterial].some(v => Number(v) > 0)
const woodStoneOf = row => ({ wood: num(row?.costWood), stone: num(row?.costStone) })

/**
 * The castle's next expansion: `{ kind: "expansion", row, spot }`, `{ kind: "done" }` at the player's limit or when the
 * kingdom has none left, `{ kind: "wait" }` for wood and stone, `{ kind: "blocked", reason }`, or `{ kind: "noData" }`.
 * @param {CastleView} castle
 * @param {Pick<Context, "player" | "resourceFloor">} ctx
 */
function nextExpansion(castle, ctx) {
    if (!castle.layout?.grounds?.some(g => g.wodID == CASTLE_GROUND))
        return { kind: "noData" }
    const bought = expansionsBought(castle)
    if (!Number.isFinite(ctx.player?.level) || bought >= expansionLimit(ctx.player.level))
        return { kind: "done" }
    const row = expansionRow(castle.kingdomID, bought + 1)
    if (!plainExpansion(row))
        return { kind: "done" }
    let waiting = false
    for (const [resource, cost] of Object.entries(woodStoneOf(row))) {
        const short = resourceShort(resource, cost, castle, num(ctx.resourceFloor))
        if (short == "never")
            return { kind: "blocked", reason: "overStorage" }
        waiting ||= short == "now"
    }
    if (waiting)
        return { kind: "wait", reason: "resources" }
    const spot = expansionSpots(castle.layout)[0]
    return spot ? { kind: "expansion", row, spot } : { kind: "blocked", reason: "noSpace" }
}

// ---- One look at a castle ----

const CHEST = "TreasureChest"
const underWay = building => IN_PROGRESS_STATES.has(building.state) && timeLeft(building) > 0
/** Seconds until the first building under way ends, or undefined when none is. */
function firstDoneIn(castle) {
    const left = castle.layout.buildings.filter(underWay).map(timeLeft)
    return left.length ? Math.min(...left) : undefined
}

/**
 * What to do in a castle now, first match wins:
 * 1. `{ kind: "noData" }` when the castle's layout or queue isn't known.
 * 2. `{ kind: "chest", building }`: an expansion's treasure chest to collect.
 * 3. `{ kind: "skip", building, seconds }`: a build under way to finish with skips, where the player ticked that.
 * 4. `{ kind: "expansion", row, spot }`: an expansion to buy, where the player ticked that. It takes no queue slot.
 * 5. `{ kind: "queueFull", seconds }`: no free slot. `seconds` until the first build ends, undefined when unknown.
 * 6. `{ kind: "build" | "upgrade", entry, … }`: the first plan row that can act (see nextStep).
 * 7. `{ kind: "rest", done, waiting, busySeconds, notes, expansion? }`: nothing to send. `done` when every row is at its
 *    level and no expansion is waited for. `waiting` when resources are. `busySeconds` until the building a row waits
 *    for ends. `notes` say why each unfinished row didn't act: `{ building, state, reason?, have?, want? }` with state
 *    "held", "blocked", "waiting" or "busy". `expansion` is `{ state, reason }` when one waits or is blocked.
 * @param {CastleView} castle
 * @param {CastlePlan} castlePlan
 * @param {Context} ctx
 */
function lookAt(castle, castlePlan, ctx) {
    if (!castle.layout || !Array.isArray(castle.slots))
        return { kind: "noData" }
    const chest = castle.layout.buildings.find(b => byWod.get(b.wodID)?.name == CHEST && !ctx.leftChests.has(b.objectID))
    if (chest)
        return { kind: "chest", building: chest }
    if (castlePlan.useSkips && ctx.skips) {
        const building = castle.layout.buildings.find(b => (b.state == BUILD_IN_PROGRESS || b.state == UPGRADE_IN_PROGRESS) && timeLeft(b) > 0)
        if (building)
            return { kind: "skip", building, seconds: timeLeft(building) }
    }
    let expansion
    if (castlePlan.buyExpansions && !ctx.held("expansion")) {
        const next = nextExpansion(castle, ctx)
        if (next.kind == "expansion")
            return next
        if (next.kind == "wait" || next.kind == "blocked")
            expansion = { state: next.kind == "wait" ? "waiting" : "blocked", reason: next.reason }
    }
    if (!castle.slots.includes(-1))
        return { kind: "queueFull", seconds: firstDoneIn(castle) }

    const notes = []
    for (const entry of castlePlan.entries) {
        if (ctx.held(entry.building)) {
            notes.push({ building: entry.building, state: "held" })
            continue
        }
        const step = nextStep(entry, castle, ctx)
        if (step.kind == "build" || step.kind == "upgrade")
            return { ...step, entry }
        if (step.kind == "blocked") {
            const { kind: _, ...why } = step
            notes.push({ building: entry.building, state: "blocked", ...why })
        } else if (step.kind == "wait")
            notes.push(step.reason == "busy" ? { building: entry.building, state: "busy" } : { building: entry.building, state: "waiting", reason: step.reason })
    }
    const waiting = expansion?.state == "waiting" || notes.some(note => note.state == "waiting")
    return {
        kind: "rest", done: notes.length == 0 && expansion?.state != "waiting", waiting,
        busySeconds: notes.some(note => note.state == "busy") ? firstDoneIn(castle) : undefined,
        notes, ...(expansion && { expansion }),
    }
}

// ---- For Build Supply ----

/** A level wood and stone count for: one the castle may build now or later, without aquamarine. */
const countsForSupply = (row, castle, ctx) => Boolean(row) && !missingRequirement(row, castle, ctx.player) && !(Number(row.costAquamarine) > 0) &&
    shortOf(row, castle, { ...ctx, resourceFloor: 0 }) != "never"
const countOf = (entry, kind, have) => kind.all ? have.length : entry.count
const mayBuildNew = (kind, first, have, count) => !kind.upgradeOnly && Boolean(first) && have.length < count &&
    !(Number(first.maximumCount) > 0 && have.length >= Number(first.maximumCount))
const expansionRowsLeft = (castle, castlePlan, ctx) => {
    const rows = []
    if (!castlePlan.buyExpansions || !castle.layout?.grounds || !Number.isFinite(ctx.player?.level))
        return rows
    for (let n = expansionsBought(castle) + 1; n <= expansionLimit(ctx.player.level); n++) {
        const row = expansionRow(castle.kingdomID, n)
        if (!plainExpansion(row))
            break
        rows.push(row)
    }
    return rows
}

/**
 * The wood and stone the rest of a castle's plan costs: every level still to go on the buildings it has, new buildings
 * from level 1 to the plan's level, and the expansions the player's level allows. Levels the castle can't build don't
 * count. The Build Supply plugin sends a castle this much.
 * @param {CastleView} castle
 * @param {CastlePlan} castlePlan
 * @param {Context} ctx
 * @returns {{ wood: number, stone: number }}
 */
function supplyNeed(castle, castlePlan, ctx) {
    const need = { wood: 0, stone: 0 }
    const add = (row, times = 1) => { const cost = woodStoneOf(row); need.wood += cost.wood * times; need.stone += cost.stone * times }
    for (const entry of castlePlan.entries) {
        const kind = kinds.get(entry.building)
        if (!kind)
            continue
        const have = ofKindIn(castle, kind)
        const count = countOf(entry, kind, have)
        for (const building of have.slice(0, count))
            for (let row = nextLevel(building); row && num(row.level) <= entry.level && countsForSupply(row, castle, ctx); row = byWod.get(Number(row.upgradeWodID)))
                add(row)
        const first = firstLevelFor(kind, castle)
        if (!mayBuildNew(kind, first, have, count))
            continue
        for (let row = first; row && num(row.level) <= entry.level && countsForSupply(row, castle, ctx); row = byWod.get(Number(row.upgradeWodID)))
            add(row, count - have.length)
    }
    expansionRowsLeft(castle, castlePlan, ctx).forEach(row => add(row))
    return need
}

/**
 * True when the plan has next steps that wood and stone pay for and the castle can pay none of them: Build has spent
 * what it can, so more wood and stone would move it on.
 * @param {CastleView} castle
 * @param {CastlePlan} castlePlan
 * @param {Context} ctx
 */
function nothingPayable(castle, castlePlan, ctx) {
    const rows = []
    for (const entry of castlePlan.entries) {
        const kind = kinds.get(entry.building)
        if (!kind)
            continue
        const have = ofKindIn(castle, kind)
        const count = countOf(entry, kind, have)
        rows.push(...have.slice(0, count).filter(b => levelOf(b) < entry.level).map(nextLevel))
        const first = firstLevelFor(kind, castle)
        if (mayBuildNew(kind, first, have, count))
            rows.push(first)
    }
    const fitsStorage = row => ["wood", "stone"].every(r => !(woodStoneOf(row)[r] > Number(castle.storage?.[r])))
    const counted = [...rows.filter(row => countsForSupply(row, castle, ctx)), ...expansionRowsLeft(castle, castlePlan, ctx).slice(0, 1).filter(fitsStorage)]
        .map(woodStoneOf).filter(cost => cost.wood > 0 || cost.stone > 0)
    return counted.length > 0 && counted.every(cost => cost.wood > num(castle.stock?.wood) || cost.stone > num(castle.stock?.stone))
}

// ---- What may leave ----

/**
 * Every request the plugin may send and what its payload must hold. `jca` reads a castle. The rest are castleBuilder's,
 * none of which can pay with rubies. Anything not listed can't leave.
 */
const ALLOWED = Object.freeze({ jca: () => true, ...builder.ALLOWED })
/** Requests that only read: a dry run still sends these. */
const READS = new Set(["jca"])
/** Whether the plugin may send `cmd` with `payload`. */
const mayLeave = (cmd, payload) => Object.hasOwn(ALLOWED, cmd) && ALLOWED[cmd](payload ?? {})

module.exports = {
    BERIMOND, RESOURCE_COSTS, CURRENCY_COSTS, kinds, catalogChoices, buildPlanOption, readPlan,
    missingRequirement, shortOf, nextStep, nextExpansion, lookAt, supplyNeed, nothingPayable,
    ALLOWED, READS, mayLeave,
}
