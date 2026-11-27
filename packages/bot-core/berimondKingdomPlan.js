/**
 * Berimond Kingdom (event 3) decisions, all pure: which tower is next, what a look or a refusal does to the tower list,
 * how many soldiers and tools each side of an attack may hold, how autofill fills the first wave, and what goes to the
 * camp. plugins/berimondKingdom.js reads the game and sends; this module only decides. Ported from Lazy Lord's
 * be/plugins/berimondKingdom.js (MIT). The requests and replies are in docs/protocol/berimond-kingdom.md.
 */
const { toolAllowedAt } = require("./attackTargets.js")

const EVENT = 3
const KINGDOM = 10
/** A watchtower of the Berimond kingdom, for the tools a target bars. */
const TARGET = Object.freeze({ kingdom: KINGDOM, areaType: 17 })
const TOWER_BOXES = Object.freeze([1, 2, 3, 4, 5].map(n => `berimondTower${n}`))
/** The fewest soldiers the first wave sends, as Lazy Lord's editor checks. */
const WAVE_ONE_MIN = 32
/** Tools a side holds in Berimond. */
const TOOL_ROOM = Object.freeze({ flank: 30, front: 40 })
/** Soldiers a side holds when the tower's level is unknown. */
const TYPED_ROOM = Object.freeze({ flank: 52, front: 156 })
const MINUTE = 60_000
/** After a failed look the tower is looked at again after these waits; one failure more drops it. */
const LOOK_WAITS_MS = Object.freeze([2 * MINUTE, 4 * MINUTE])
const ALL_CUT_STEP = 2, ALL_CUT_MAX = 20
const NO_CUT = Object.freeze({ cut: 0, allCut: 0 })
const RESUPPLY_FIRST_WAIT_MS = 2 * MINUTE, RESUPPLY_MAX_WAIT_MS = 30 * MINUTE

const num = value => Number(value) || 0

/** A position as the game writes it, where a comma groups thousands: "1,264:67" is 1264:67. */
function parseTower(text) {
    const match = String(text ?? "").replace(/[\s,.]/g, "").match(/^(\d+):(\d+)$/)
    if (!match)
        return undefined
    const x = Number(match[1]), y = Number(match[2])
    return { x, y, key: `${x}:${y}` }
}

/** The towers in the player's boxes, in order, without repeats or the `dropped` keys; `bad` counts boxes that hold no position. */
function readTowers(options, dropped = []) {
    const filled = TOWER_BOXES.map(box => String(options?.[box] ?? "").trim()).filter(Boolean)
    const parsed = filled.map(parseTower)
    const towers = []
    for (const tower of parsed)
        if (tower && !dropped.includes(tower.key) && !towers.some(t => t.key == tower.key))
            towers.push(tower)
    return { towers, bad: parsed.filter(tower => !tower).length }
}

/**
 * The tower list. `find` means the player listed none and the game's own finder picks each tower, so nothing is
 * dropped and the list never runs out. `stop` is set once the plugin is done for this event.
 */
function newQueue(towers, { find = false } = {}) {
    return { towers: [...towers], order: towers.map(t => t.key), find, seen: [], lookFails: {}, refusedInARow: 0, stop: !find && towers.length == 0 ? "towersDone" : undefined }
}

function drop(queue, key, reason) {
    const towers = queue.towers.filter(t => t.key != key)
    const { [key]: _, ...lookFails } = queue.lookFails
    const stop = queue.stop ?? (!queue.find && towers.length == 0 ? "towersDone" : undefined)
    return { queue: { ...queue, towers, lookFails, stop }, effect: { drop: key, reason } }
}

/** How long a tower that isn't ready waits before the plugin looks at it again. */
const HOLD_MS = 5 * 60_000

/** The tower `key` isn't ready: it moves to the back of the list and waits until `now` + HOLD_MS. No refusal is counted. */
function holdTower(queue, key, now) {
    const tower = queue.towers.find(t => t.key == key)
    if (!tower)
        return queue
    return { ...queue, towers: [...queue.towers.filter(t => t.key != key), tower], heldUntil: { ...queue.heldUntil, [key]: now + HOLD_MS } }
}

/**
 * How long until the first tower may be looked at: 0 when it may now. Towers whose wait is over go back to the order
 * the player typed them in, ahead of the towers still waiting.
 */
function firstFree(queue, now) {
    const held = key => (queue.heldUntil?.[key] ?? 0) > now
    const typed = key => { const i = queue.order?.indexOf(key) ?? -1; return i < 0 ? Infinity : i }
    const free = queue.towers.filter(t => !held(t.key)).sort((a, b) => typed(a.key) - typed(b.key))
    const waiting = queue.towers.filter(t => held(t.key))
    if (free.length)
        return { queue: { ...queue, towers: [...free, ...waiting] }, waitMs: 0 }
    return { queue, waitMs: Math.min(...waiting.map(t => queue.heldUntil[t.key] - now)) }
}

/**
 * What a look (`ssi`) at the first tower means: "tower", "empty" (INVALID_POSITION), "notTower" or "failed". An empty
 * spot or something else there drops the tower and is no refusal: destroyed where a tower was seen this event, else
 * never found. A failed look waits and tries again, and the third failure in a row drops the tower.
 */
function afterLook(queue, look) {
    const tower = queue.towers[0]
    const seen = queue.seen.includes(tower.key)
    if (look == "tower") {
        const { [tower.key]: _, ...lookFails } = queue.lookFails
        return { queue: { ...queue, lookFails, seen: seen ? queue.seen : [...queue.seen, tower.key] }, effect: { use: tower } }
    }
    if (look == "empty")
        return drop(queue, tower.key, seen ? "destroyed" : "notFound")
    if (look == "notTower")
        return drop(queue, tower.key, seen ? "destroyed" : "wrongCoordinates")
    const fails = (queue.lookFails[tower.key] ?? 0) + 1
    if (fails > LOOK_WAITS_MS.length)
        return drop(queue, tower.key, "lookFailed")
    return { queue: { ...queue, lookFails: { ...queue.lookFails, [tower.key]: fails } }, effect: { waitMs: LOOK_WAITS_MS[fails - 1] } }
}

/** An attack on `key` was "sent" or "refused". A refused tower is dropped, and a second refusal in a row stops the plugin. */
function afterAttack(queue, key, outcome) {
    if (outcome == "sent")
        return { queue: { ...queue, refusedInARow: 0 }, effect: {} }
    const refusedInARow = queue.refusedInARow + 1
    const counted = { ...queue, refusedInARow, stop: queue.stop ?? (refusedInARow >= 2 ? "twoRefusals" : undefined) }
    return queue.find ? { queue: counted, effect: { refused: key } } : drop(counted, key, "refused")
}

/**
 * What the plugin does about an error from building or sending an attack. Anything not listed is the game refusing
 * the tower, as Lazy Lord's plugin reads it.
 */
const ATTACK_OUTCOMES = Object.freeze({
    // The tower isn't ready: another hit is landing or it is cooling down. It waits at the back of the list, as the other
    // attack plugins hold a target that isn't ready, and is no refusal. A tower that fell is dropped by its next look.
    ATTACK_SCREEN_REFUSED: "cooling", COOLING_DOWN: "cooling",
    MISSING_UNITS: "retry", LORD_IS_USED: "retry", TIMED_OUT: "retry", CASTLE_LOCKED: "retry", CANT_START_NEW_ARMIES: "retry",
    ATTACK_TOO_MANY_UNITS: "tooMany",
    WONT_REACH_IN_TIME: "eventOver", EVENT_ALREADY_ENDED: "eventOver",
    NOT_ENOUGH_CURRENCY1: "coins",
    ATTACK_LIMIT_REACHED: "dailyLimit",
    NO_MORE_TROOPS: "troops",
})
const attackOutcome = error => ATTACK_OUTCOMES[error] ?? "refused"

/** The tower's level: field 7 of its map record, `extraData[4]`. Lazy Lord matched it to the soldiers the game showed. */
function towerLevel(areaInfo) {
    const level = Number(areaInfo?.extraData?.[4])
    return level > 0 ? level : undefined
}

/**
 * The soldiers each side may hold against a tower of `level`: attackers are 5 x level + 8, at most 260, and 320 from
 * level 70; a flank takes 20% of them, rounded up, and the middle the rest. The commander's `effects` raise each side,
 * all commanders lose `allCut` percent, and this commander `cut` soldiers more, after refusals for too many units.
 */
function troopRoom(level, effects = {}, { cut = 0, allCut = 0 } = {}) {
    let base = { ...TYPED_ROOM }
    if (level > 0) {
        const attackers = level <= 69 ? Math.min(260, 5 * level + 8) : 320
        const flank = Math.ceil(0.2 * attackers)
        base = { flank, front: attackers - 2 * flank }
    }
    const share = 1 - allCut / 100
    const side = (amount, bonus) => Math.max(1, Math.floor(amount * (1 + num(bonus) / 100) * share) - cut)
    return { flank: side(base.flank, effects.attackUnitAmountFlank), front: side(base.front, effects.attackUnitAmountFront) }
}

/** The cuts after the game refused a commander's attack for too many units: double its own, and 2% more for all. */
const cutAfterTooMany = ({ cut, allCut }) => ({ cut: cut == 0 ? 1 : cut * 2, allCut: Math.min(ALL_CUT_MAX, allCut + ALL_CUT_STEP) })

const isSoldier = info => Boolean(info?.role) && num(info.fightType) == 0
/** The camp's own auxiliaries are left out of autofill, as Lazy Lord's plugin leaves them. */
const autofillSoldier = info => isSoldier(info) && !num(info.isAuxiliary)
const fitsSide = (info, key) => info.slotTypes?.split(",").includes(key == "M" ? "1" : "2") ?? true
const TOOL_ROLES = Object.freeze({ wall: info => num(info.wallBonus) > 0, gate: info => num(info.gateBonus) > 0, shield: info => num(info.defRangeBonus) > 0 })
/** The role each tool slot takes, by side. */
const TOOL_SLOTS = Object.freeze({ L: ["wall", "shield"], R: ["wall", "shield"], M: ["wall", "gate", "shield"] })
const SIDE_KEYS = ["L", "R", "M"]
const isAttackTool = info => !info.role && Boolean(info.toolCategory) && info.typ == "Attack" && info.amountPerWave === undefined

/**
 * Fills the empty first wave `wave` from the camp's `inventory`: every side up to its `room` with the soldiers the camp
 * received, most numerous first, and its tool slots with wall, gate and archer tools. The attack waits for a full
 * wave, unless `campFull` says no more troops can come, and never goes with fewer than 32 soldiers. Takes what it
 * places out of `inventory` and returns the soldiers placed. Throws "NO_MORE_TROOPS", taking nothing, when it can't.
 */
function autofillWave(wave, inventory, room, { campFull = false, toolAllowed = info => toolAllowedAt(info, TARGET) } = {}) {
    const left = new Map(inventory.map(u => [u, u.amount]))
    const picks = []
    const take = (slot, unit, amount) => {
        left.set(unit, left.get(unit) - amount)
        picks.push([slot, unit, amount])
        return amount
    }
    const soldiers = inventory.filter(u => u.amount > 0 && autofillSoldier(u.unitInfo)).sort((a, b) => b.amount - a.amount)
    let placed = 0, full = true
    for (const key of SIDE_KEYS) {
        let space = key == "M" ? room.frontUnits : room.flankUnits
        for (const slot of wave[key].U) {
            const unit = soldiers.find(u => left.get(u) > 0)
            if (!unit || space <= 0)
                break
            space -= take(slot, unit, Math.min(space, left.get(unit)))
        }
        placed += (key == "M" ? room.frontUnits : room.flankUnits) - space
        full &&= space <= 0
    }
    if ((!full && !campFull) || placed < WAVE_ONE_MIN)
        throw "NO_MORE_TROOPS"
    const tools = inventory.filter(u => u.amount > 0 && isAttackTool(u.unitInfo) && toolAllowed(u.unitInfo))
    for (const key of SIDE_KEYS) {
        let space = key == "M" ? room.frontTools : room.flankTools
        wave[key].T.forEach((slot, i) => {
            const role = TOOL_ROLES[TOOL_SLOTS[key][i]]
            const unit = role && tools.find(u => left.get(u) > 0 && role(u.unitInfo) && fitsSide(u.unitInfo, key))
            if (unit && space > 0)
                space -= take(slot, unit, Math.min(Math.ceil(space / (wave[key].T.length - i)), left.get(unit)))
        })
    }
    for (const [slot, unit, amount] of picks) {
        slot[0] = unit.unitInfo.wodID
        slot[1] = amount
        unit.amount -= amount
    }
    return placed
}

/** The soldiers in a `cra`'s first wave. */
const waveOneSoldiers = attackInfo => SIDE_KEYS.reduce((sum, key) =>
    sum + (attackInfo.A?.[0]?.[key]?.U ?? []).reduce((n, slot) => n + (slot[0] > 0 ? num(slot[1]) : 0), 0), 0)

/** A troop that may go to the camp: one that eats food or mead, not beef, and not Berimond's own auxiliaries. */
const isSendable = info => ["melee", "ranged"].includes(info?.role) && !num(info.isAuxiliary) &&
    (num(info.foodSupply) > 0 || num(info.meadSupply) > 0) && info.beefSupply === undefined

/**
 * What goes to the camp: once its `freeSpace` reaches the `threshold`, the `held` troops (`[wodID, amount]` in the
 * player's order) up to that space. `{ units }`, `{ noRoom }` while the camp has less room, or `{ short }` with what the
 * castle holds when that is under the threshold.
 */
function resupplyPlan({ freeSpace, threshold, held }) {
    if (freeSpace < threshold)
        return { noRoom: true }
    const total = held.reduce((sum, [, amount]) => sum + amount, 0)
    let remaining = Math.min(freeSpace, total)
    if (remaining < threshold)
        return { short: total }
    const units = []
    for (const [wodID, amount] of held) {
        if (remaining <= 0)
            break
        const sent = Math.min(amount, remaining)
        units.push([wodID, sent])
        remaining -= sent
    }
    return { units }
}

/** The wait after `failures` refills in a row went wrong: 2 minutes, doubling, at most 30. */
const resupplyBackoffMs = failures => Math.min(RESUPPLY_MAX_WAIT_MS, RESUPPLY_FIRST_WAIT_MS * 2 ** (failures - 1))

module.exports = {
    EVENT, KINGDOM, TARGET, TOWER_BOXES, WAVE_ONE_MIN, TOOL_ROOM, NO_CUT, ATTACK_OUTCOMES, HOLD_MS, holdTower, firstFree,
    parseTower, readTowers, newQueue, afterLook, afterAttack, attackOutcome,
    towerLevel, troopRoom, cutAfterTooMany, autofillWave, waveOneSoldiers,
    isSendable, resupplyPlan, resupplyBackoffMs,
}
