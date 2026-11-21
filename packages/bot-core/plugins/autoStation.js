/**
 * Auto Station: when a player attacks one of the account's castles, moves the troops out to a protected alliance
 * castle just before the attack lands and calls them home once it is over. See docs/protocol/stationing.md.
 */
const GATE_CHOICES = ["Off", "Open the gates for 6 hours", "Open the gates for 12 hours"]
const optionDefs = [
    { type: "Number", key: "stationLeadSeconds", min: 20, max: 600, step: 5, unit: "seconds", default: 60 },
    { type: "Select", key: "stationDestination", selection: ["Auto: the nearest alliance castle under protection", "Fixed: the castles listed below"], default: 0 },
    { type: "Number", key: "stationMinProtectionHours", min: 1, max: 168, step: 1, unit: "hours", default: 1 },
    {
        type: "Rows", key: "stationFixedDestinations", default: [], columns: [
            { key: "stationKingdom", type: "kingdom" },
            { key: "stationX", type: "number", min: 0, max: 1300 },
            { key: "stationY", type: "number", min: 0, max: 1300 },
        ],
    },
    { type: "Select", key: "stationTroops", selection: ["Every troop", "Attack troops only"], default: 0 },
    {
        type: "Rows", key: "stationReserve", default: [], columns: [
            { key: "castle", type: "castle" },
            { key: "troop", type: "troop" },
            { key: "stationKeep", type: "number", min: 0, max: 10_000_000 },
        ],
    },
    ...require("../commanderOptions.js").commanderOptions(),
    { type: "Select", key: "stationGateFallback", selection: GATE_CHOICES, default: 0 },
    { type: "Number", key: "stationGateMaxRubies", min: 0, max: 60_000, step: 10, unit: "rubies", default: 700 },
    { type: "Number", key: "stationMinArmy", min: 0, max: 10_000_000, step: 1, unit: "troops", default: 0 },
    { type: "Checkbox", key: "stationAllowOutposts", default: false },
    { type: "Number", key: "stationMaxCommanders", min: 1, max: 20, step: 1, default: 2 },
    { type: "Number", key: "stationHours", min: 1, max: 12, step: 1, unit: "hours", default: 12 },
    { type: "Checkbox", key: "stationScopeMain", default: true },
    { type: "Checkbox", key: "stationScopeOutposts", default: true },
    { type: "Checkbox", key: "stationScopeCaptures", default: true },
    { type: "Checkbox", key: "stationDryRun", default: false },
]

if (require("node:worker_threads").isMainThread)
    return module.exports = { pluginOptions: optionDefs, checks: require("../commanderOptions.js").commanderChecks, breaksPeace: true }

require("./incoming.js")
const err = require("../err.json")
const { castles, movements, AreaType, KingdomID, ClientCommands } = require("../protocols.js")
const { takeFreeCommander, freeCommander } = require("./commander.js")
const { lockCastle, unlockCastle } = require("../castleLock.js")
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require("../ggeBot.js")
const { statusReporter, notifyOwner } = require("../pluginStatus.js")

const DEFAULTS = Object.fromEntries(optionDefs.filter(def => def.key && def.type != "Label").map(def => [def.key, def.default]))
const setting = key => botConfig.plugins.autoStation?.[key] ?? DEFAULTS[key]
const reportStatus = statusReporter(__filename)

/** Never move troops sooner than this after first seeing an attack. */
const MIN_REACTION_MS = 5_000
/** Attacks stop leaving a castle this long before its troops do, so none is half built when they go. */
const LOCK_LEAD_MS = 30_000
/** Troops come home this long after the last attack on their castle lands. */
const RECALL_DELAY_MS = 60_000
/** A destination tried later than this before the attack lands could not get the troops out in time. */
const LAST_TRY_MS = 2_000
const MAX_DESTINATIONS_TRIED = 3
const REPLY_MS = 10_000
const MAIN_TYPES = [AreaType.mainCastle, AreaType.externalKingdom]
/** `mos` CD and the base of its cost formula, by gate choice. */
const GATES = [undefined, { CD: 0, base: 450 }, { CD: 1, base: 700 }]

/** The ruby cost of opening the gates before discounts, from the castle's open-gate count (`getOpenGateCosts`). */
function openGateCost(gate, openGateCount) {
    const n = Math.min(9, openGateCount + 1)
    return 10 * Math.round(gate.base * n ** (1.1 + n / 10) / 10)
}

const inScope = castle => MAIN_TYPES.includes(castle.areaInfo.type) ? setting("stationScopeMain")
    : castle.areaInfo.type == AreaType.outpost ? setting("stationScopeOutposts")
    : setting("stationScopeCaptures")
const watched = () => castles.filter(castle => castle.areaInfo && inScope(castle))
const nameOf = castle => String(castle.areaInfo.extraData[7] || `${castle.areaInfo.x}:${castle.areaInfo.y}`)
const distance = (from, to) => (from.x - to.x) ** 2 + (from.y - to.y) ** 2
const isAttackTroop = info =>
    Number(info.meleeAttack ?? 0) + Number(info.rangeAttack ?? 0) > Number(info.meleeDefence ?? 0) + Number(info.rangeDefence ?? 0)

/**
 * A castle under player attack, from the first sighting until it is over. Its phase moves one way:
 * threatened (troops leave at `evacuateAt`) → evacuating → stationed, gated, unprotected or empty → over,
 * where stationed troops are recalled RECALL_DELAY_MS after the last attack lands (recalling → over).
 * @typedef {Object} Threat
 * @property {Object} castle
 * @property {String} name the castle's name when the threat began; a march's map data can overwrite the castle's own
 * @property {"threatened"|"evacuating"|"stationed"|"recalling"|"gated"|"unprotected"|"empty"} phase
 * @property {Map<Number, import("./incoming.js").IncomingAttack>} attacks the attacks still on their way
 * @property {Number} evacuateAt
 * @property {Number} [recallAt]
 * @property {Boolean} locked
 * @property {import("../protocols.js").ClassTypes.Lord} [commander] held for the troops of this castle
 * @property {Number} [movementId] the stationed army, once the game confirmed it
 * @property {NodeJS.Timeout} [timer]
 */
/** @type {Map<String, Threat>} by kingdom and castle id */
const threats = new Map()
const keyOf = castle => `${castle.kingdomID}:${castle.id}`
function later(ms, run) {
    const timer = setTimeout(run, Math.max(0, ms))
    timer.unref?.()
    return timer
}

const PHASE_ORDER = ["evacuating", "threatened", "recalling", "stationed", "unprotected", "gated", "empty"]
function report() {
    const [threat] = [...threats.values()].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.evacuateAt - b.evacuateAt)
    const castle = threat?.name
    if (!threat)
        return reportStatus("running", "statusStationWatching", { count: watched().length })
    if (threat.phase == "threatened")
        return reportStatus("running", "statusStationThreat", { castle, at: new Date(threat.evacuateAt).toISOString() })
    if (threat.phase == "evacuating")
        return reportStatus("running", "statusStationEvacuating", { castle })
    if (threat.phase == "stationed" || threat.phase == "recalling")
        return threat.recallAt
            ? reportStatus("running", "statusStationRecalling", { castle, at: new Date(threat.recallAt).toISOString() })
            : reportStatus("running", "statusStationed", { castle })
    if (threat.phase == "gated")
        return reportStatus("running", "statusStationGated", { castle })
    if (threat.phase == "empty")
        return reportStatus("running", "statusStationEmpty", { castle })
    reportStatus("waiting", "statusStationUnprotected", { castle })
}

/** Frees a commander that went out with troops, unless one of our tracked marches shows it is still away. */
function freeIfHome(lordID) {
    if (!movements.some(m => m.owner?.ownerID == playerInfo.playerID && m.lord?.lordID == lordID))
        freeCommander(lordID)
}
/** The commander of troops whose return no tracked march will announce comes home when the station time is up at the latest. */
const freeWhenStationEnds = lordID => later(Number(setting("stationHours")) * 3600 * 1000, () => freeIfHome(lordID))

/** Evacuations run one at a time, so each `cds` reply belongs to the one evacuation waiting for it. */
let evacuations = Promise.resolve()

function holdCommander(threat) {
    const held = [...threats.values()].filter(t => t.commander).length
    if (!threat.commander && held < Number(setting("stationMaxCommanders")))
        threat.commander = takeFreeCommander(setting("commanderWhiteList"))
}

function lock(threat) {
    if (threat.locked)
        return
    threat.locked = true
    lockCastle(threat.castle.kingdomID, threat.castle.areaInfo.x, threat.castle.areaInfo.y)
    holdCommander(threat)
}

/** Ends the threat: the castle opens for attacks again, and a commander that never left goes back to the pool. */
function end(threat, { commanderLeft = false } = {}) {
    clearTimeout(threat.timer)
    threats.delete(keyOf(threat.castle))
    if (threat.locked)
        unlockCastle(threat.castle.kingdomID, threat.castle.areaInfo.x, threat.castle.areaInfo.y)
    if (threat.commander && !commanderLeft)
        freeCommander(threat.commander.lordID)
    report()
}

/** Schedules what comes next for a threat whose attacks changed. */
function plan(threat) {
    clearTimeout(threat.timer)
    threat.timer = undefined
    if (threat.phase == "threatened") {
        if (threat.attacks.size == 0)
            return end(threat)
        const untilLock = threat.evacuateAt - LOCK_LEAD_MS - Date.now()
        if (untilLock <= 0)
            lock(threat)
        threat.timer = untilLock > 0
            ? later(untilLock, () => plan(threat))
            : later(threat.evacuateAt - Date.now(), () => {
                threat.phase = "evacuating"
                report()
                evacuations = evacuations.then(() => evacuate(threat)).catch(e => {
                    console.error(e)
                    end(threat)
                })
            })
    } else if (threat.phase == "stationed") {
        threat.recallAt = threat.attacks.size == 0 ? Date.now() + RECALL_DELAY_MS : undefined
        if (threat.recallAt)
            threat.timer = later(RECALL_DELAY_MS, () => recall(threat).catch(e => {
                console.error(e)
                end(threat, { commanderLeft: true })
            }))
    } else if (!["evacuating", "recalling"].includes(threat.phase) && threat.attacks.size == 0)
        end(threat)
    report()
}

/** The castle an attack is aimed at, when it is one of ours that Auto Station watches. */
function targetOf(attack) {
    if (attack.defender.ownerID != playerInfo.playerID)
        return
    const castle = castles.find(c => c.kingdomID == attack.kingdom && c.areaInfo?.x == attack.targetCastle.x && c.areaInfo?.y == attack.targetCastle.y)
    return castle && inScope(castle) ? castle : undefined
}

const tooSmall = attack => attack.army != undefined && attack.army < Number(setting("stationMinArmy"))

function onAttack(/** @type {import("./incoming.js").IncomingAttack} */ attack) {
    const castle = targetOf(attack)
    if (!castle)
        return
    let threat = threats.get(keyOf(castle))
    if (tooSmall(attack)) {
        if (threat?.attacks.delete(attack.movementId)) {
            console.log("stationAttackTooSmall", threat.name, " ", attack.army)
            plan(threat)
        }
        return
    }
    if (threat?.attacks.has(attack.movementId))
        return

    const evacuateAt = Math.max(attack.arrivesAt - Number(setting("stationLeadSeconds")) * 1000, Date.now() + MIN_REACTION_MS)
    if (!threat) {
        threat = { castle, name: nameOf(castle), phase: "threatened", attacks: new Map(), evacuateAt, locked: false }
        threats.set(keyOf(castle), threat)
        notifyOwner("incoming_attack", { attacker: attack.attacker.name, castle: threat.name, arrival: new Date(attack.arrivesAt).toISOString() },
            `${keyOf(castle)}:${attack.movementId}`)
    }
    threat.attacks.set(attack.movementId, attack)
    threat.evacuateAt = Math.min(threat.evacuateAt, evacuateAt)
    console.log("stationThreat", threat.name, " ", attack.attacker.name, " ", new Date(attack.arrivesAt).toISOString())
    plan(threat)
}

events.on("incoming:new", onAttack)
events.on("incoming:updated", onAttack)
events.on("incoming:cleared", (/** @type {import("./incoming.js").IncomingAttack} */ attack) => {
    for (const threat of threats.values())
        if (threat.attacks.delete(attack.movementId))
            plan(threat)
})
events.once("load", report)

/** The troops that leave `castle`, as `cds` lists them: every soldier, or attack troops only, minus the reserve. */
function troopsToMove(castle) {
    const keep = new Map(setting("stationReserve")
        .filter(row => row.castle?.kingdom == castle.kingdomID && row.castle?.id == castle.id)
        .map(row => [row.troop, Number(row.stationKeep)]))
    const attackOnly = Number(setting("stationTroops")) == 1
    return (castle.unitInventory ?? [])
        .filter(unit => ["melee", "ranged"].includes(unit.unitInfo?.role) && (!attackOnly || isAttackTroop(unit.unitInfo)))
        .map(unit => [unit.unitInfo.wodID, unit.amount - (keep.get(unit.unitInfo.wodID) ?? 0)])
        .filter(([, amount]) => amount > 0)
}

/** Where the troops of `castle` may go, best first: `{ x, y, label }`. */
async function destinationsFor(castle) {
    if (Number(setting("stationDestination")) == 1)
        return setting("stationFixedDestinations")
            .filter(row => row.stationKingdom == castle.kingdomID)
            .map(row => ({ x: row.stationX, y: row.stationY, label: `${row.stationX}:${row.stationY}` }))

    if (!(playerInfo.alliance?.id >= 0)) {
        console.warn("stationNoAlliance")
        return []
    }
    const alliance = await ClientCommands.getAllianceByID(playerInfo.alliance.id).catch(() => ({}))
    const protectedFor = Number(setting("stationMinProtectionHours")) * 3600
    return (alliance.members ?? [])
        .filter(member => member.ownerID != playerInfo.playerID && member.remainingPeaceTime >= protectedFor)
        .flatMap(member => (member.castlePositionList ?? [])
            .filter(at => at.kingdomID == castle.kingdomID && (at.type != AreaType.outpost || setting("stationAllowOutposts")))
            .map(at => ({ x: at.X, y: at.Y, label: `${member.name} (${at.X}:${at.Y})` })))
        .sort((a, b) => distance(castle.areaInfo, a) - distance(castle.areaInfo, b))
}

const dryRun = () => Boolean(setting("stationDryRun"))

/**
 * Sends one `cds`: `{ movementId }` once stationed (null in a dry run), `{ refused }`, or `{ timedOut }` when the game
 * didn't answer, so the troops may or may not have left.
 */
async function station(castle, destination, commander, army) {
    const request = {
        SID: castle.id, TX: destination.x, TY: destination.y, LID: commander.lordID,
        WT: Number(setting("stationHours")), HBW: -1, BPC: 0, PTT: 0, SD: 0, A: army,
    }
    if (dryRun()) {
        console.log("dryRunCds", JSON.stringify(request))
        return { movementId: null }
    }
    const reply = waitForResult("cds", REPLY_MS, (obj, result) => result != 0 || (obj.A?.M?.TA?.[1] == destination.x && obj.A?.M?.TA?.[2] == destination.y))
    await sendXT("cds", JSON.stringify(request))
    try {
        const [obj, result] = await reply
        if (result != 0) {
            console.warn("stationRefused", destination.label, " ", err[result] ?? result)
            return { refused: true }
        }
        for (const [wodID, amount] of army) {
            const unit = castle.unitInventory.find(u => u.unitInfo?.wodID == wodID)
            if (unit)
                unit.amount -= amount
        }
        return { movementId: Number(obj.A?.M?.MID) }
    } catch {
        console.warn("stationTimedOut", destination.label)
        await sendXT("dcl", JSON.stringify({ CD: 1 }))
        return { timedOut: true }
    }
}

/** Opens the gates of `castle` when the settings allow it. Returns the rubies it cost, or undefined when it didn't. */
async function openGates(castle) {
    const gate = GATES[Number(setting("stationGateFallback"))]
    if (!gate)
        return
    if (castle.kingdomID == KingdomID.berimond) {
        console.warn("stationGateBerimond")
        return
    }
    if (!(castle.openGateCount >= 0)) {
        console.warn("stationGateCountUnknown")
        return
    }
    const cost = openGateCost(gate, castle.openGateCount)
    if (cost > Number(setting("stationGateMaxRubies"))) {
        console.warn("stationGateOverCap", cost)
        return
    }
    if (!(playerInfo.rubies >= cost)) {
        console.warn("stationGateNoRubies", cost)
        return
    }
    const request = { CID: castle.id, KID: castle.kingdomID, CD: gate.CD }
    if (dryRun()) {
        console.log("dryRunMos", JSON.stringify(request), " ", cost)
        return cost
    }
    const reply = waitForResult("mos", REPLY_MS, (obj, result) => result != 0 || obj.CID == castle.id)
    await sendXT("mos", JSON.stringify(request))
    try {
        const [obj, result] = await reply
        if (result != 0 || !(Number(obj.RPT) > 0)) {
            console.warn("stationGateRefused", err[result] ?? result)
            return
        }
        if (obj.gcu)
            xtHandler.emit("gcu", obj.gcu)
        castle.openGateCount++
        console.log("stationGateOpened", cost)
        return cost
    } catch {
        console.warn("stationGateRefused", "TIMED_OUT")
    }
}

/** Moves the troops of the threatened castle out: to an alliance castle, else behind open gates when allowed. */
async function evacuate(/** @type {Threat} */ threat) {
    const { castle, name } = threat
    const firstLanding = Math.min(...[...threat.attacks.values()].map(attack => attack.arrivesAt))
    threat.phase = "evacuating"
    report()
    lock(threat)
    console.log("stationEvacuating", name)

    const army = troopsToMove(castle)
    let outcome, destination, rubies
    if (army.length == 0)
        console.log("stationNothingToMove", name)
    else {
        holdCommander(threat)
        if (!threat.commander)
            console.warn("stationNoCommander", name)
        const destinations = threat.commander ? (await destinationsFor(castle)).slice(0, MAX_DESTINATIONS_TRIED) : []
        if (threat.commander && destinations.length == 0)
            console.warn("stationNoDestination", name)
        let timedOut = false
        for (const candidate of destinations) {
            if (Date.now() > firstLanding - LAST_TRY_MS)
                break
            const sent = await station(castle, candidate, threat.commander, army)
            // Trying again or opening the gates could send the troops twice or pay for nothing.
            timedOut = Boolean(sent.timedOut)
            if (sent.refused)
                continue
            if (!timedOut) {
                threat.movementId = sent.movementId
                destination = candidate
            }
            break
        }
        if (timedOut) {
            freeWhenStationEnds(threat.commander.lordID)
            threat.commander = undefined
        }
        const gatesInTime = !destination && !timedOut && Date.now() < firstLanding
        if (!destination && !timedOut && !gatesInTime)
            console.warn("stationGateTooLate", name)
        rubies = gatesInTime ? await openGates(castle) : undefined
        outcome = destination ? "stationed" : rubies !== undefined ? "gates_opened" : "unprotected"
    }

    if (destination)
        console.log("stationSent", name, " ", destination.label)
    if (outcome && !dryRun())
        notifyOwner("station_result", { castle: name, outcome, destination: destination?.label ?? null, rubies: rubies ?? null },
            `${keyOf(castle)}:${threat.evacuateAt}`)
    threat.phase = { stationed: "stationed", gates_opened: "gated", unprotected: "unprotected" }[outcome] ?? "empty"
    if (!destination && threat.commander) {
        freeCommander(threat.commander.lordID)
        threat.commander = undefined
    }
    // Unprotected or gated, nothing waits for the troops: attacks may leave the castle again.
    if (threat.phase != "stationed" && threat.locked) {
        threat.locked = false
        unlockCastle(castle.kingdomID, castle.areaInfo.x, castle.areaInfo.y)
    }
    plan(threat)
}

/**
 * Calls the stationed troops home. Their commander is free again when the march home ends: commander.js sees it end
 * when the game's reply carries the march, else this frees it after the march time. Attacks seen meanwhile start over.
 */
async function recall(/** @type {Threat} */ threat) {
    const { name, commander } = threat
    threat.phase = "recalling"
    report()
    let away = true
    if (threat.movementId === null) {
        console.log("dryRunMcm", name)
        away = false
    } else if (!(threat.movementId >= 0)) {
        console.warn("stationRecallUnknown", name)
        freeWhenStationEnds(commander?.lordID)
    } else {
        const reply = waitForResult("mcm", REPLY_MS)
        await sendXT("mcm", JSON.stringify({ MID: threat.movementId }))
        const [obj, result] = await reply.catch(() => [{}, "TIMED_OUT"])
        if (result != 0) {
            console.warn("stationRecallRefused", name, " ", err[result] ?? result)
            freeWhenStationEnds(commander?.lordID)
        } else {
            console.log("stationRecalled", name)
            const march = obj.A?.M
            const homeIn = (Number(march?.TT) - Number(march?.PT)) * 1000 || 0
            const tracked = movements.some(m => m.id == threat.movementId && m.lord?.lordID == commander?.lordID)
            later(homeIn + 1000, async () => {
                if (!tracked)
                    freeCommander(commander?.lordID)
                // The castle's own count of the troops that came home.
                await sendXT("dcl", JSON.stringify({ CD: 1 }))
            })
        }
    }
    const seenMeanwhile = [...threat.attacks.values()]
    end(threat, { commanderLeft: away })
    seenMeanwhile.forEach(onAttack)
}
