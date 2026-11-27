if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Rows",
                key: "targets",
                columns: [
                    { key: "tool", type: "tool" },
                    { key: "stock", type: "number", min: 1, max: 1_000_000, default: 1000 },
                ],
                default: []
            },
            {
                type: "Rows",
                key: "castleTargets",
                columns: [
                    { key: "castle", type: "castle" },
                    { key: "tool", type: "tool" },
                    { key: "stock", type: "number", min: 1, max: 1_000_000, default: 1000 },
                ],
                default: []
            },
            {
                type: "Number",
                key: "resourceFloor",
                min: 0,
                max: 100_000_000,
                step: 1000,
                default: 0
            },
            {
                type: "Checkbox",
                key: "dryRunOrders",
                default: false
            }
        ]
    }

const err = require("../err.json")
const { events, botConfig } = require("../ggeBot.js")
const { setCastle, castles, resources } = require("../protocols.js")
const { ask, chore } = require("../chores.js")
const { boxMullerRandom, pause } = require("../pacing.js")
const stock = require("./stock.js")
const loadItem = require("../paths.js").loadItem
const { CASTLE_COSTS } = require("../orderable.js")
const { BUP_REFUSALS, refusalMemory } = require("../refusals.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const reportStatus = require("../pluginStatus.js").statusReporter(__filename)
reportStatus("waiting", "statusToolsmithStarting")

/** One order holds at most this many tools bought with resources. */
const MAX_PER_ORDER = 80
/** The client's default for `bup`'s SK field. */
const CLIENT_SK = 73

/** The workshop buildings by level (building wodIDs) and the castle flag that says a castle has one. */
const WORKSHOPS = {
    Workshop: { flag: "hasSiegeWorkshop", levels: [165, 166, 167, 256] },
    Dworkshop: { flag: "hasDefenseWorkshop", levels: [176, 177, 178, 257] },
}
const ENABLE_UNIT = "46", DISABLE_UNIT = "84"

const units = new Map(loadItem("units").map(unit => [Number(unit.wodID), unit]))
const skills = (() => {
    try {
        return new Map(loadItem("sceatSkills").map(skill => [Number(skill.skillID), skill]))
    } catch {
        return new Map()
    }
})()

/** A unit's `cost<Name>` fields, as items files carry them. Wood, stone and the rest come out of the castle (CASTLE_COSTS). */
/** The Sceat tools' components are the account's, under the names protocols.js gives them. */
const ACCOUNT_COSTS = {
    costComponent1: "screws", costComponent2: "blackPowder", costComponent3: "saws", costComponent4: "drills",
    costComponent5: "crowbars", costComponent6: "leatherStrips", costComponent7: "chains", costComponent8: "metalPlates",
}

/** What one tool costs, as `[holder, resource, amount]` where holder is the castle or the account's resources. */
const costOf = (unit, castle) => [
    ...Object.entries(CASTLE_COSTS).map(([field, resource]) => [castle, resource, Number(unit[field])]),
    ...Object.entries(ACCOUNT_COSTS).map(([field, resource]) => [resources, resource, Number(unit[field])]),
].filter(([, , amount]) => amount > 0)

/** The tools in `wodID`'s upgrade chain, lowest level first. */
function chainOf(wodID) {
    let head = units.get(wodID)
    for (const seen = new Set(); head && head.downgradeWodID != undefined && units.has(Number(head.downgradeWodID)) && !seen.has(head.wodID);) {
        seen.add(head.wodID)
        head = units.get(Number(head.downgradeWodID))
    }
    const chain = []
    for (let tool = head; tool && !chain.includes(tool); tool = units.get(Number(tool.upgradeWodID)))
        chain.push(tool)
    return chain
}

/** The `46&<wodID>` (enable) and `84&<wodID>` (disable) tools of the Sceat skills a player has, as two sets. */
function skillEffects(skillIDs) {
    const enabled = new Set(), disabled = new Set()
    for (const id of skillIDs)
        for (const part of String(skills.get(Number(id))?.effects ?? "").split(",")) {
            const [effect, value = ""] = part.split("&")
            const target = effect == ENABLE_UNIT ? enabled : effect == DISABLE_UNIT ? disabled : undefined
            for (const wodID of value.replace(/\+/g, "#").split("#"))
                if (target && Number.isInteger(Number(wodID)) && wodID !== "")
                    target.add(Number(wodID))
        }
    return { enabled, disabled }
}

/** The level of `workshop` a castle has, 0 when it has none. */
function workshopLevel(castle, workshop) {
    const present = WORKSHOPS[workshop].levels
    const known = (castle.buildings ?? []).map(b => present.indexOf(b.wodID) + 1)
    return Math.max(0, ...known, castle[WORKSHOPS[workshop].flag] && !castle.buildings ? 1 : 0)
}

/**
 * The tool to build for the one a player picked: the highest level of its chain the workshop can build and the
 * Sceat skills allow. A chain's lowest level is on unless a skill turns it off, and each higher one only when a skill
 * turns it on. With no skill list (`skillIDs` undefined) the workshop's level alone decides.
 * Returns `{ wodID }`, or `{ lockedBy: "level" | "skills" }`.
 */
function levelToBuild(wodID, workshop, skillIDs) {
    const chain = chainOf(wodID)
    const fits = chain.filter(tool => Number(tool.buildingLevel ?? 1) <= workshop)
    if (fits.length == 0)
        return { lockedBy: "level" }
    if (!skillIDs)
        return { wodID: Number(fits.at(-1).wodID) }
    const { enabled, disabled } = skillEffects(skillIDs)
    const allowed = fits.filter(tool => !disabled.has(Number(tool.wodID)) && (enabled.has(Number(tool.wodID)) || tool.downgradeWodID == undefined))
    return allowed.length ? { wodID: Number(allowed.at(-1).wodID) } : { lockedBy: "skills" }
}

/** How many of a tool `castle` can pay for, keeping `floor` of each resource. */
function affordable(unit, castle, floor) {
    const costs = costOf(unit, castle)
    return costs.length == 0 ? Infinity : Math.min(...costs.map(([holder, resource, cost]) => Math.floor((Number(holder[resource]) - floor) / cost)))
}

/** Outcomes of one target, best first. */
const OUTCOMES = ["queued", "met", "queueUnknown", "queueFull", "noResources", "tooMany", "refused", "levelLocked", "noWorkshop"]
/** The blockers in the order the status names them when nothing was queued. */
const BLOCKERS = ["noWorkshop", "levelLocked", "noResources", "queueUnknown", "queueFull", "tooMany", "refused"]
const STATUS_KEY = {
    noWorkshop: "statusToolsmithNoWorkshop", levelLocked: "statusToolsmithLevelLocked", noResources: "statusToolsmithNoResources", queueFull: "statusToolsmithQueueFull",
    queueUnknown: "statusToolsmithQueueUnknown", tooMany: "statusToolsmithTooMany", refused: "statusToolsmithRefused",
}

/** What the game's refusals taught about each tool in each castle, by `<castle>:<wodID>`. */
const learned = refusalMemory()

const asRows = value => Array.isArray(value) ? value : []
const asNumber = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback

function targetRows() {
    const account = asRows(pluginOptions.targets).map(row => ({ tool: Number(row.tool), stock: Number(row.stock) }))
    const perCastle = asRows(pluginOptions.castleTargets).map(row => ({ tool: Number(row.tool), stock: Number(row.stock), castle: row.castle }))
    return [...account, ...perCastle].filter(row => units.has(row.tool) && row.stock > 0)
}

const fewMinutes = () => boxMullerRandom(60_000, 3 * 60_000)

/** Reads the player's active Sceat skills; undefined when the game doesn't say. */
async function activeSkills() {
    const { reply, result } = await ask("skl", {})
    return result === 0 && Array.isArray(reply.SIDS) ? reply.SIDS.map(Number) : undefined
}

async function cycle(active) {
    const rows = targetRows()
    if (rows.length == 0) {
        reportStatus("waiting", "statusToolsmithNoTargets")
        return 30 * 60_000
    }
    const dryRun = Boolean(pluginOptions.dryRunOrders)
    const floor = asNumber(pluginOptions.resourceFloor, 0)

    await stock.refreshHome()
    const skillIDs = await activeSkills()
    const outcomes = rows.map(() => new Set())
    const dryQueued = new Map()
    let queuedOrders = 0
    let queuedTools = 0
    let soonest

    const have = (wodID, row) => stock.toolStock(wodID, row.castle ? { castle: row.castle } : {}).total + (dryQueued.get(`${wodID}:${row.castle?.id ?? ""}`) ?? 0)

    const workshops = castles.filter(castle => Object.values(WORKSHOPS).some(w => castle[w.flag]))
    rows.forEach((row, i) => {
        const workshop = WORKSHOPS[units.get(row.tool).name]
        const places = workshops.filter(castle => castle[workshop?.flag] && (!row.castle || row.castle.kingdom == castle.kingdomID && row.castle.id == castle.id))
        if (places.length == 0)
            outcomes[i].add("noWorkshop")
    })

    for (const castle of workshops) {
        if (!active())
            return
        await setCastle(castle, async () => {
            const queue = await stock.readQueue(castle)
            if (!queue)
                return
            if (queue.unknown) {
                console.warn("toolsmithQueueUnknown", castle.kingdomID, castle.id)
                rows.forEach((row, i) => {
                    const workshop = WORKSHOPS[units.get(row.tool).name]
                    if (workshop && castle[workshop.flag] && (!row.castle || row.castle.kingdom == castle.kingdomID && row.castle.id == castle.id))
                        outcomes[i].add("queueUnknown")
                })
                return
            }
            if (queue.seconds !== undefined && queue.seconds > 0)
                soonest = Math.min(soonest ?? Infinity, queue.seconds)
            let free = queue.freeSlots
            for (const [i, row] of rows.entries()) {
                const unit = units.get(row.tool)
                const workshop = WORKSHOPS[unit.name]
                if (!workshop || !castle[workshop.flag] || row.castle && (row.castle.kingdom != castle.kingdomID || row.castle.id != castle.id))
                    continue
                const level = levelToBuild(row.tool, workshopLevel(castle, unit.name), skillIDs)
                if (level.lockedBy) {
                    outcomes[i].add("levelLocked")
                    continue
                }
                const built = units.get(level.wodID)
                const learnedKey = `${castle.id}:${level.wodID}`
                const holding = learned.holding(learnedKey)
                if (holding) {
                    outcomes[i].add(holding)
                    continue
                }
                for (;;) {
                    const deficit = row.stock - have(level.wodID, row)
                    if (deficit <= 0) {
                        outcomes[i].add("met")
                        break
                    }
                    if (free == 0) {
                        outcomes[i].add("queueFull")
                        break
                    }
                    const amount = Math.min(MAX_PER_ORDER, learned.cap(learnedKey), deficit, affordable(built, castle, floor))
                    if (!(amount > 0)) {
                        outcomes[i].add("noResources")
                        break
                    }
                    if (!active())
                        return
                    const order = { LID: stock.TOOLS_LIST, WID: level.wodID, AMT: amount, PO: -1, PWR: 0, SK: CLIENT_SK, SID: castle.kingdomID, AID: castle.id }
                    if (dryRun)
                        console.log("dryRunBup", JSON.stringify(order))
                    else {
                        const { result } = await ask("bup", order)
                        if (result !== 0) {
                            console.warn("toolsmithRefused", JSON.stringify(order), " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)
                            const outcome = BUP_REFUSALS[result] ?? "refused"
                            learned.refused(learnedKey, outcome, amount)
                            outcomes[i].add(outcome)
                            if (outcome == "levelLocked")
                                console.warn("toolsmithLevelLocked", String(built.type))
                            if (outcome == "queueFull")
                                free = 0
                            break
                        }
                        learned.accepted(learnedKey)
                        stock.noteQueued(castle, level.wodID, amount)
                    }
                    const key = `${level.wodID}:${row.castle?.id ?? ""}`
                    if (dryRun)
                        dryQueued.set(key, (dryQueued.get(key) ?? 0) + amount)
                    for (const [holder, resource, cost] of costOf(built, castle))
                        holder[resource] -= cost * amount
                    free--
                    queuedOrders++
                    queuedTools += amount
                    outcomes[i].add("queued")
                    await pause(1500, 4000)
                }
            }
        })
        await pause(2000, 6000)
    }

    const finals = outcomes.map(set => OUTCOMES.find(outcome => set.has(outcome)) ?? "noAnswer")
    if (queuedOrders > 0)
        reportStatus("running", "statusToolsmithQueued", { orders: queuedOrders, tools: queuedTools })
    else if (finals.every(outcome => outcome == "met"))
        reportStatus("waiting", "statusToolsmithTargetsMet")
    else {
        const blocker = BLOCKERS.find(b => finals.includes(b))
        if (blocker)
            reportStatus("waiting", STATUS_KEY[blocker], { tool: String(units.get(rows[finals.indexOf(blocker)].tool).type) })
        else
            reportStatus("waiting", "statusToolsmithNoAnswer")
    }
    if (soonest !== undefined)
        return soonest * 1000 + fewMinutes()
    return 15 * 60_000 + fewMinutes()
}

events.once("load", () => chore("toolsmith", cycle, boxMullerRandom(3 * 60_000, 8 * 60_000)))
