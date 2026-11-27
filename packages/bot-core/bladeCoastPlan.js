/**
 * Blade Coast (event 4) decisions, all pure: what the camp builds next, which island is next, what goes to the camp,
 * the attack's waves, which requests may leave at all, and the status the Live view shows. plugins/bladeCoast.js reads
 * the game and sends; this module only decides. Ported from Lazy Lord's be/plugins/bladeCoast.js (MIT). The request and
 * reply shapes are in docs/protocol/blade-coast.md.
 */
const { isTroop } = require("./unitCatalog.js")
const builder = require("./castleBuilder.js")

/** The maps in the order they are played (Normal, Hard, Hard plus): the space the camp's tents reach and the fewest soldiers it attacks with. */
const MAPS = Object.freeze({ 22: { space: 350, minSoldiers: 300 }, 27: { space: 400, minSoldiers: 350 }, 28: { space: 450, minSoldiers: 400 } })
const MAP_ORDER = Object.freeze([22, 27, 28])
/** Morale is built up to as much as the camp's space. */
const moraleTarget = mid => MAPS[mid].space
const STOREHOUSES = 10
/** The camp's buildings by wodID: storehouse, the first tent, and the two decorations that raise morale. */
const BUILDING = Object.freeze({ storage: 265, firstTent: 263, trainingGround: 330, flag: 329 })
const TENT = "Unittent", CHEST = "TreasureChest"
/** The prebuilt camp a player picks with resources (`csc ID`). */
const CAMP_ID = 29
/** The camp's built-in commander, which every island attack uses. */
const BUILT_IN_COMMANDER = -12

const FIRST_TOOLS = 1000, TOOLS_TOP_UP = 500
/** A tool transfer needs one soldier with it, so filling the camp leaves one place. */
const KEEP_FREE = 1
const GOODS_LOSS = 0.25, CASTLE_KEEP_SHARE = 0.25, GOODS_LOW = 0.5, FOOD_LOW = 0.3, MIN_GOODS_TRIP = 1000

const num = value => Number(value) || 0
const pairs = list => Array.isArray(list) ? list : []
const ids = list => String(list ?? "").split("+").filter(Boolean).map(Number)

/**
 * @typedef {{ id: number, type: string, level: number, pos: number, main: boolean, or: number[], and: number[], priceID: number }} CoastNode
 * @typedef {{ mid: number, end: number, islands: CoastNode[], ports: CoastNode[] }} CoastMap
 * @typedef {{
 *   space: number, soldiersCounted: number, morale: number,
 *   wood: number, stone: number, food: number, maxWood: number, maxStone: number, maxFood: number,
 *   inventory: Map<number, number>,
 *   troopTrip: { seconds: number, units: [number, number][] }, goodsTrip: { seconds: number, goods: [string, number][] },
 *   won: Set<number>, cooldowns: Map<number, number>, paid: Map<number, Map<string, number>>,
 * }} Camp
 * `soldiersCounted` (`S.U`) still counts soldiers out on an attack, which `inventory` leaves out.
 * @typedef {{ role: "wall" | "gate" | "ranged", wods: number[], slots: ("front" | "flank")[] }} ChosenTool
 * @typedef {{ troopWods: number[], tools: ChosenTool[] }} Loadout
 */

/** A map's islands and ports from the game's `tmaps` and `tmapnodes`. Islands are every DUNGEON type; the Kraken is `end`. */
function coastMap(mid, tmaps, tmapnodes) {
    const row = tmaps.find(m => Number(m.mapID) == mid)
    const byID = new Map(tmapnodes.map(n => [Number(n.tmapnodeID), n]))
    const nodes = ids(row?.tmapnodeIDs).map(id => byID.get(id)).filter(Boolean).map(n => ({
        id: Number(n.tmapnodeID), type: String(n.type), level: num(n.dungeonlevel), pos: num(n.pos),
        main: n.dungeonType == "main" || n.type == "BRIDGEDUNGEON", or: ids(n.orUnlockIDs), and: ids(n.andUnlockIDs), priceID: Number(n.partPayPriceID),
    }))
    return {
        mid, end: Number(row?.endNodeID),
        islands: nodes.filter(n => /DUNGEON/.test(n.type)),
        ports: nodes.filter(n => n.type == "PORT").sort((a, b) => a.id - b.id),
    }
}

/** The camp from a `tmp` map entry, or undefined when the player hasn't joined that map (no `S`). @returns {Camp | undefined} */
function readCamp(entry) {
    if (!entry?.S)
        return undefined
    const S = entry.S, nodes = pairs(entry.N)
    const seconds = trip => num(trip?.RS) > 0 ? num(trip.RS) : 0
    return {
        space: num(S.MU), soldiersCounted: num(S.U), morale: num(entry.M),
        wood: num(S.W), stone: num(S.S), food: num(S.F), maxWood: num(S.MRW), maxStone: num(S.MRS), maxFood: num(S.MRF),
        inventory: new Map(pairs(entry.I).map(([wod, n]) => [Number(wod), num(n)])),
        troopTrip: { seconds: seconds(entry.UT), units: pairs(entry.UT?.I) },
        goodsTrip: { seconds: seconds(entry.RT), goods: pairs(entry.RT?.G) },
        won: new Set(nodes.filter(n => Number(n.A) == 1).map(n => Number(n.NID))),
        cooldowns: new Map(nodes.filter(n => num(n.CD) > 0).map(n => [Number(n.NID), num(n.CD)])),
        paid: new Map(nodes.map(n => [Number(n.NID), new Map(pairs(n.G).map(([k, v]) => [k, num(v)]))])),
    }
}

const soldiersIn = (inventory, unitByWod) => [...inventory].filter(([wod]) => isTroop(unitByWod.get(wod))).reduce((t, [, n]) => t + n, 0)
const amountOf = (inventory, wods) => wods.reduce((t, w) => t + (inventory.get(w) ?? 0), 0)

// ---- The camp ----

/** Storehouses built, read from the camp's wood storage: 3,000 to start and 7,500 a storehouse. */
const storehousesOf = camp => Math.max(0, Math.round((camp.maxWood - 3000) / 7500))

/** What the camp still needs: "storage", then "tent" to the space, then "decoration" to the morale; undefined when ready. */
function campNeed(camp, mid) {
    if (storehousesOf(camp) < STOREHOUSES) return "storage"
    if (camp.space < MAPS[mid].space) return "tent"
    if (camp.morale < moraleTarget(mid)) return "decoration"
    return undefined
}

const freeRow = builder.rubyFree

/**
 * The next camp step for `need` in this layout (castleLayout's `parseCastleLayout`), first match wins:
 * a treasure chest to collect, a building under way to finish, a new building, a tent a level up when no new one fits,
 * then an expansion bought with wood and stone. `kit` is castleLayout.js. `leftChests` holds chests the game refused.
 * @returns {{ kind: "chest", building } | { kind: "busy", building } | { kind: "build", row, spot } | { kind: "upgrade", building, row }
 *   | { kind: "expansion", row, spot } | { kind: "noRoom" }}
 */
function campStep(need, layout, mid, kit, leftChests = new Set()) {
    const { byWod, findSpot, expansionSpots, expansionRow, CASTLE_GROUND, BUILD_IN_PROGRESS, UPGRADE_IN_PROGRESS, IDLE_STATES } = kit
    const chest = layout.buildings.find(b => byWod.get(b.wodID)?.name == CHEST && !leftChests.has(b.objectID))
    if (chest) return { kind: "chest", building: chest }
    const busy = layout.buildings.find(b => b.state == BUILD_IN_PROGRESS || b.state == UPGRADE_IN_PROGRESS)
    if (busy) return { kind: "busy", building: busy }
    const rows = need == "storage" ? [BUILDING.storage] : need == "tent" ? [BUILDING.firstTent] : [BUILDING.trainingGround, BUILDING.flag]
    for (const row of rows.map(wod => byWod.get(wod)).filter(freeRow)) {
        const spot = findSpot(layout, row)
        if (spot) return { kind: "build", row, spot }
    }
    if (need == "tent") {
        const lowest = layout.buildings.filter(b => byWod.get(b.wodID)?.name == TENT && IDLE_STATES.has(b.state))
            .map(building => ({ building, row: byWod.get(num(byWod.get(building.wodID)?.upgradeWodID)) }))
            .filter(t => freeRow(t.row))
            .sort((a, b) => num(byWod.get(a.building.wodID).level) - num(byWod.get(b.building.wodID).level))[0]
        if (lowest) return { kind: "upgrade", ...lowest }
    }
    const bought = layout.grounds.filter(g => g.wodID != CASTLE_GROUND).length
    const row = expansionRow(mid, bought + 1)
    const spot = freeRow(row) && expansionSpots(layout)[0]
    return spot ? { kind: "expansion", row, spot } : { kind: "noRoom" }
}

const costOf = row => ({ wood: num(row?.costWood), stone: num(row?.costStone) })

// ---- Islands and ports ----

/**
 * The islands on a shortest way to the Kraken from what's won so far: those where the fewest islands still to win
 * before and after it add up to the fewest for the whole way. An island opens when any of its `or` islands is won.
 * Ports are paid, not fought, so they don't count. `left` is the islands still to win, the Kraken included.
 */
function shortestRoute(map, camp) {
    const cost = n => camp.won.has(n.id) ? 0 : 1
    const upTo = new Map(), after = new Map([[map.end, 0]])
    for (let changed = true; changed;) {
        changed = false
        for (const n of map.islands) {
            const value = (n.or.length == 0 ? 0 : Math.min(...n.or.map(u => upTo.get(u) ?? Infinity))) + cost(n)
            if (value < (upTo.get(n.id) ?? Infinity)) { upTo.set(n.id, value); changed = true }
            for (const u of n.or) {
                const via = cost(n) + (after.get(n.id) ?? Infinity)
                if (via < (after.get(u) ?? Infinity)) { after.set(u, via); changed = true }
            }
        }
    }
    const best = upTo.get(map.end) ?? Infinity
    return { nodes: new Set(map.islands.filter(n => (upTo.get(n.id) ?? Infinity) + (after.get(n.id) ?? Infinity) == best).map(n => n.id)), left: best }
}

/**
 * The islands open to attack now, best first: unlocked (any `or` won, every `and` won), not won, not cooling down, and
 * on a shortest route when `shortest` is set. Main-path and bridge islands come before side islands, then by position.
 * A cooling island is waited for, never skipped.
 */
function attackable(map, camp, shortest) {
    const route = shortest ? shortestRoute(map, camp).nodes : undefined
    const side = n => Number(!n.main)
    return map.islands
        .filter(n => !route || route.has(n.id))
        .filter(n => (n.or.length == 0 || n.or.some(u => camp.won.has(u))) && n.and.every(u => camp.won.has(u)))
        .filter(n => !camp.won.has(n.id) && !(camp.cooldowns.get(n.id) > 0))
        .sort((a, b) => side(a) - side(b) || a.pos - b.pos)
}

/** The next port (a warship level) to pay, with what's left of its price; undefined when none is open. */
function nextPort(map, camp, partpay) {
    const port = map.ports.find(n => !camp.won.has(n.id) && n.or.every(u => camp.won.has(u)))
    if (!port) return undefined
    const price = partpay.find(p => Number(p.partPayPriceID) == port.priceID)
    const paid = camp.paid.get(port.id) ?? new Map()
    return { port, wood: Math.max(0, num(price?.wood) - (paid.get("W") ?? 0)), stone: Math.max(0, num(price?.stone) - (paid.get("S") ?? 0)) }
}

// ---- Waves ----

/** The game's CombatConst: soldiers and tools a wave side takes at an island's level, and the slots open at it. */
const maxAttackers = level => level <= 69 ? Math.min(260, 5 * level + 8) : 320
const flankSoldiers = level => Math.ceil(.2 * maxAttackers(level))
const frontSoldiers = level => Math.ceil(maxAttackers(level) - 2 * flankSoldiers(level))
const flankTools = level => level < 37 ? 10 : level < 50 ? 20 : level < 69 ? 30 : 40
const frontTools = level => level < 11 ? 10 : level < 37 ? 20 : level < 50 ? 30 : level < 69 ? 40 : 50
/** A slot opens at the level listed. A locked slot filled in is refused with ATTACK_TOO_MANY_UNITS (Lazy Lord, a level 15 island). */
const SLOT_LEVELS = { flankTools: [0, 37], frontTools: [0, 11, 37], flankUnits: [0, 13], frontUnits: [0, 0, 13, 13, 26, 26] }
const openSlots = (kind, level) => SLOT_LEVELS[kind].filter(at => level >= at).length
const waveCount = playerLevel => playerLevel >= 51 ? 4 : playerLevel >= 26 ? 3 : playerLevel >= 13 ? 2 : 1
/** Which chosen tool a side's open tool slots get first. */
const SIDE_ORDER = { flank: ["wall", "ranged", "gate"], front: ["gate", "wall", "ranged"] }

/** A side's tool room shared evenly over one chosen tool per open slot, in SIDE_ORDER. `share` follows `tools`' order. */
function sideShare(cap, side, tools, level) {
    const open = openSlots(side == "front" ? "frontTools" : "flankTools", level)
    const order = SIDE_ORDER[side].map(role => tools.findIndex(t => t.role == role)).filter(i => i >= 0 && tools[i].slots.includes(side)).slice(0, open)
    const share = tools.map(() => 0)
    order.forEach((i, k) => { share[i] = Math.floor(cap / order.length) + (k < cap % order.length ? 1 : 0) })
    return { share, order }
}

/** The tools one attack's first wave takes on an island of `level`, per chosen tool. */
function toolsForIsland(level, tools) {
    const sides = [sideShare(flankTools(level), "flank", tools, level), sideShare(flankTools(level), "flank", tools, level), sideShare(frontTools(level), "front", tools, level)]
    return tools.map((_, i) => sides.reduce((t, s) => t + s.share[i], 0))
}

/**
 * The `thm` waves (`A`): soldiers from the camp wave by wave (left, right, front), the chosen troop first, and the tools
 * in the first wave only. An empty slot is `[-1, 0]`.
 * @param {Loadout} loadout
 */
function buildWaves(level, inventory, loadout, { playerLevel, unitByWod }) {
    const soldiers = [...inventory].filter(([wod, n]) => n > 0 && isTroop(unitByWod.get(wod)))
        .sort((a, b) => Number(loadout.troopWods.includes(b[0])) - Number(loadout.troopWods.includes(a[0])) || b[1] - a[1])
        .map(([wod, n]) => [wod, n])
    const takeSoldiers = (cap, slots, open) => {
        const out = []
        let left = cap
        while (left > 0 && out.length < open && soldiers.length) {
            const part = Math.min(soldiers[0][1], left)
            out.push([soldiers[0][0], part])
            left -= part
            soldiers[0][1] -= part
            if (soldiers[0][1] <= 0) soldiers.shift()
        }
        while (out.length < slots) out.push([-1, 0])
        return out
    }
    const stock = loadout.tools.map(t => t.wods.map(w => [w, inventory.get(w) ?? 0]).filter(([, n]) => n > 0))
    const takeTool = (which, n) => {
        const left = stock[which]
        while (left.length && left[0][1] <= 0) left.shift()
        if (!left.length || n <= 0) return [-1, 0]
        const part = Math.min(left[0][1], n)
        left[0][1] -= part
        return [left[0][0], part]
    }
    const toolSlots = (cap, slots, first, side) => {
        const out = []
        if (first) {
            const { share, order } = sideShare(cap, side, loadout.tools, level)
            out.push(...order.map(i => takeTool(i, share[i])).filter(t => t[0] != -1))
        }
        while (out.length < slots) out.push([-1, 0])
        return out
    }
    return Array.from({ length: waveCount(playerLevel) }, (_, w) => ({
        L: { T: toolSlots(flankTools(level), 2, w == 0, "flank"), U: takeSoldiers(flankSoldiers(level), 2, openSlots("flankUnits", level)) },
        R: { T: toolSlots(flankTools(level), 2, w == 0, "flank"), U: takeSoldiers(flankSoldiers(level), 2, openSlots("flankUnits", level)) },
        M: { T: toolSlots(frontTools(level), 3, w == 0, "front"), U: takeSoldiers(frontSoldiers(level), 6, openSlots("frontUnits", level)) },
    }))
}

// ---- Troops, tools and goods for the camp ----

/**
 * What the camp should get now. Soldiers only below the map's minimum (soldiers away on an attack count), then filled to
 * all places but one. Tools when short for the next island, in lots (1,000 of each the first time on a map, 500 after),
 * never fewer than the shortfall, and only with at least one soldier, so a full camp waits for a battle to free room.
 * @returns {{ short: false } | { short: true, soldiers: number, tools: number[], atLeast: number[], campFull: boolean }}
 */
function refillPlan({ camp, mid, soldiers, toolsHave, toolsNeeded, firstLot }) {
    const inCamp = Math.max(camp.soldiersCounted, soldiers)
    const soldiersShort = inCamp < MAPS[mid].minSoldiers
    const toolsShort = toolsHave.some((have, i) => have < toolsNeeded[i])
    if (!soldiersShort && !toolsShort)
        return { short: false }
    let fill = soldiersShort ? Math.max(0, camp.space - KEEP_FREE - inCamp) : 0
    if (toolsShort && fill == 0 && camp.space - inCamp >= 1)
        fill = 1
    const toolsGo = toolsShort && fill > 0
    const lot = firstLot ? FIRST_TOOLS : TOOLS_TOP_UP
    return {
        short: true, soldiers: fill, campFull: toolsShort && !toolsGo,
        tools: toolsHave.map(() => toolsGo ? lot : 0),
        atLeast: toolsHave.map((have, i) => toolsGo ? Math.max(0, toolsNeeded[i] - have) : 0),
    }
}

/** Takes `amount` from `held` ([[wod, n]], best first), or undefined when it holds fewer. */
function take(held, amount) {
    const out = []
    let left = amount
    for (const [wod, n] of held) {
        if (left <= 0) break
        const part = Math.min(n, left)
        out.push([wod, part])
        left -= part
    }
    return left > 0 ? undefined : out
}

/**
 * One `tut` load from the supply castle for `plan`: all of a kind or none of it. `held(wods)` is what the castle has of
 * those wodIDs, best level first. Each tool goes up to its lot or all the castle has, but never under `atLeast`.
 * @returns {{ I: [number, number][], short: ({ troops: number } | { tool: number, wod: number })[] }}
 */
function loadTrip(plan, loadout, held) {
    const I = [], short = []
    if (plan.soldiers > 0) {
        const part = take(held(loadout.troopWods), plan.soldiers)
        part ? I.push(...part) : short.push({ troops: plan.soldiers })
    }
    loadout.tools.forEach((tool, i) => {
        const have = held(tool.wods)
        let n = Math.min(plan.tools[i], have.reduce((t, [, k]) => t + k, 0))
        if (!(n > 0) && !(plan.atLeast[i] > 0)) return
        n = Math.max(n, plan.atLeast[i])
        const part = take(have, n)
        part ? I.push(...part) : short.push({ tool: n, wod: tool.wods[0] })
    })
    return { I, short }
}

/** The coin fee for a `tut` load: half the kingdom travel fee for each soldier, 50 for each tool (the game's dialog). */
const travelFee = (I, unitByWod) => Math.round(I.reduce((t, [wod, n]) => {
    const unit = unitByWod.get(wod)
    return t + n * (isTroop(unit) ? num(unit.kingdomTravellingCost) : 100) * 0.5
}, 0))

const RESOURCE_KEYS = { wood: "W", stone: "S", food: "F" }
const capital = key => key[0].toUpperCase() + key.slice(1)
/** What a castle can give of each good, keeping a quarter of its storage. */
const spareOf = castle => Object.fromEntries(Object.keys(RESOURCE_KEYS).map(key =>
    [key, Math.max(0, Math.floor(num(castle[key]) - num(castle.getProductionData?.[`maxAmount${capital(key)}`]) * CASTLE_KEEP_SHARE))]))

/**
 * A `tgt` goods trip, or undefined when the camp isn't low. The camp is low below half its wood or stone (or below
 * `need`) or below 30% food; `foodOnly` looks at food alone. The trip fills its storage, counting the quarter lost at
 * sea, from the first castle that can give it all (the supply castle first), else the one that can give the most.
 * @returns {undefined | { castle, G: [string, number][] } | { castle: undefined }}
 */
function goodsPlan(camp, castles, { need = {}, foodOnly = false } = {}) {
    const want = {
        wood: foodOnly ? 0 : Math.max(0, camp.maxWood - camp.wood), stone: foodOnly ? 0 : Math.max(0, camp.maxStone - camp.stone),
        food: camp.food < camp.maxFood * FOOD_LOW ? Math.max(0, camp.maxFood - camp.food) : 0,
    }
    const low = want.food > 0 || (!foodOnly && (camp.wood < Math.max(camp.maxWood * GOODS_LOW, need.wood ?? 0) ||
        camp.stone < Math.max(camp.maxStone * GOODS_LOW, need.stone ?? 0)))
    if (!low) return undefined
    const gross = Object.fromEntries(Object.entries(want).map(([k, v]) => [k, Math.ceil(v / (1 - GOODS_LOSS))]))
    const offers = castles.map(castle => {
        const spare = spareOf(castle)
        return { castle, give: Object.fromEntries(Object.entries(gross).map(([k, v]) => [k, Math.min(v, spare[k])])) }
    })
    const total = offer => Object.values(offer.give).reduce((t, n) => t + n, 0)
    const best = offers.find(o => Object.entries(gross).every(([k, v]) => o.give[k] >= v)) ?? [...offers].sort((a, b) => total(b) - total(a))[0]
    const G = Object.entries(RESOURCE_KEYS).map(([k, letter]) => [letter, best?.give[k] ?? 0]).filter(([, n]) => n >= MIN_GOODS_TRIP)
    return best && G.length ? { castle: best.castle, G } : { castle: undefined }
}

// ---- What may leave ----

const { SKIP_TYPES } = builder
const zero = value => value === 0
/**
 * Every request the plugin may send and what its payload must hold. Rubies are the game's C2: `PWR 1` and `OC2 1` pay a
 * camp or building with them, `SC 1` a port, `BT 1` boosts an attack's travel, `tkt` and `sdc` buy time. None of
 * those are listed, so none can leave. An island's cooldown is waited for: no request here skips it.
 */
const ALLOWED = Object.freeze({
    tmp: () => true, jea: () => true, tai: () => true, gas: () => true, dcl: () => true,
    csc: p => p.ID == CAMP_ID && zero(p.PWR) && zero(p.OC2),
    sje: p => Object.keys(p).every(k => k == "MID"),
    ebu: builder.ALLOWED.ebu, eup: builder.ALLOWED.eup, ebe: builder.ALLOWED.ebe, etc: builder.ALLOWED.etc, msb: builder.ALLOWED.msb,
    tut: () => true, tgt: () => true,
    msm: p => (p.TT === 1 || p.TT === 2) && SKIP_TYPES.has(p.MST),
    ule: p => zero(p.SC) && zero(p.C1) && zero(p.F) && p.SCID === -1,
    thm: p => p.LID === BUILT_IN_COMMANDER && p.BT === 2 && zero(p.BPC) && zero(p.PTT),
    tfm: () => true,
})
/** Requests that only read: a dry run still sends these. */
const READS = new Set(["tmp", "jea", "tai", "gas", "dcl"])
/** Whether the plugin may send `cmd` with `payload`. */
const mayLeave = (cmd, payload) => Object.hasOwn(ALLOWED, cmd) && ALLOWED[cmd](payload ?? {})

// ---- What the Live view shows ----

/** The battle strength morale gives, in percent of normal (the game's CombatConst.getMoralBonus). */
const moraleBonus = morale => Math.round(100 * (morale >= 0 ? 2 - 1 / (1 + morale / 250) : 1 / (1 + Math.abs(morale) / 250)))

/** The phase the card shows (BladeCoastPhase in @gge/contracts). */
function phaseOf({ mid, map, camp, loadout, attackOut, stopped, shortest, unitByWod }) {
    if (stopped) return "stopped"
    if (camp.won.has(map.end)) return "mapDone"
    const need = campNeed(camp, mid)
    if (need == "storage") return "storehouses"
    if (need == "tent") return "tents"
    if (need == "decoration") return "morale"
    if (attackOut) return attackOut.kraken ? "krakenAttackOut" : "attackOut"
    const next = attackable(map, camp, shortest)[0]
    const needed = next && loadout ? toolsForIsland(next.level, loadout.tools) : []
    const toolsShort = (loadout?.tools ?? []).some((t, i) => amountOf(camp.inventory, t.wods) < (needed[i] ?? 0))
    if (soldiersIn(camp.inventory, unitByWod) < MAPS[mid].minSoldiers || camp.troopTrip.seconds > 0 || toolsShort) return "filling"
    return "attacking"
}

/**
 * The BladeCoastStatus (@gge/contracts) for the camp as last read. `attackOut` is the attack this run sent, with its
 * island; `landsAt` stands in for an attack out from before a restart, whose island isn't known.
 */
function statusOf({ mid, map, camp, phase, attackOut, shortest, now = Date.now() }) {
    const scope = map.islands.filter(n => n.id != map.end)
    const won = scope.filter(n => camp.won.has(n.id)).length
    const left = shortest ? shortestRoute(map, camp).left - (camp.won.has(map.end) ? 0 : 1) : undefined
    const next = attackable(map, camp, shortest)[0]
    const trips = [
        ...(attackOut ? [{ kind: "attack", island: attackOut.island, level: attackOut.level, kraken: attackOut.kraken, sentAt: attackOut.sentAt, endsAt: attackOut.endsAt }] : []),
        ...(camp.troopTrip.seconds > 0 ? [{ kind: "troops", amount: camp.troopTrip.units.reduce((t, [, n]) => t + num(n), 0), endsAt: now + camp.troopTrip.seconds * 1000 }] : []),
        ...(camp.goodsTrip.seconds > 0 ? [{ kind: "goods", endsAt: now + camp.goodsTrip.seconds * 1000 }] : []),
    ]
    const whole = n => Math.max(0, Math.floor(n))
    return {
        map: mid, phase,
        camp: {
            space: camp.space, spaceTarget: MAPS[mid].space, soldiers: whole(camp.soldiersCounted), minSoldiers: MAPS[mid].minSoldiers,
            storehouses: storehousesOf(camp), storehousesTarget: STOREHOUSES,
            wood: whole(camp.wood), stone: whole(camp.stone), food: whole(camp.food), storage: whole(camp.maxWood),
        },
        morale: { value: Math.round(camp.morale), bonus: moraleBonus(camp.morale), target: moraleTarget(mid) },
        warship: { level: 1 + map.ports.filter(n => camp.won.has(n.id)).length, max: 1 + map.ports.length },
        islands: { won, total: shortest ? won + (Number.isFinite(left) ? left : 0) : scope.length, krakenWon: camp.won.has(map.end) },
        nextIsland: next ? { id: next.id, level: next.level, kraken: next.id == map.end } : null,
        trips: trips.slice(0, 10),
    }
}

module.exports = {
    MAPS, MAP_ORDER, STOREHOUSES, BUILDING, CAMP_ID, BUILT_IN_COMMANDER, FIRST_TOOLS, TOOLS_TOP_UP, READS,
    coastMap, readCamp, soldiersIn, amountOf, storehousesOf, campNeed, campStep, costOf,
    shortestRoute, attackable, nextPort, toolsForIsland, buildWaves, waveCount,
    refillPlan, loadTrip, travelFee, goodsPlan, mayLeave, moraleBonus, phaseOf, statusOf,
}
