/**
 * Keeps the defence of the main castle the way the player set it. Every Khan attack that lands uses up tools of the
 * walls, the moat and the gate, and the points of the Khan chain come from defended attacks. A layout is what `dfc`
 * replies: `{ dfw: { L, M, R: { S, UP, UC } }, dfm: { LS, MS, RS }, dfk: { S, STS, MAUCT, UC } }`. The game moves
 * tools from storage into a slot when a write raises its amount, so a refill writes the slots again with the amounts
 * they held when the plugin started.
 */
const err = require("./err.json")
const { events } = require("./ggeBot.js")
const { movementEvents } = require("./protocols.js")
const { ask } = require("./chores.js")

/** Every slot list of a layout, as [section, key], in the order tools are given out. */
const SLOTS = [["dfw", "L"], ["dfw", "M"], ["dfw", "R"], ["dfm", "LS"], ["dfm", "MS"], ["dfm", "RS"], ["dfk", "S"], ["dfk", "STS"]]
/** The sections that are written, by the command that writes them, and the fields of each that the write carries. */
const WRITES = {
    dfw: { sides: ["L", "M", "R"], sideFields: ["S", "UP", "UC"] },
    dfm: { fields: ["LS", "MS", "RS"] },
    dfk: { fields: ["S", "STS", "MAUCT", "UC"] },
}
const EMPTY = -1
/** After a Khan attack lands, the defence is looked at again after this long, in milliseconds. */
const SETTLE_MS = 5_000

/** The slots of one list: the walls keep theirs under `S`, the moat and the gate are the list itself. */
function slotsOf(layout, [section, key]) {
    const value = layout?.[section]?.[key]
    return Array.isArray(value) ? value : value?.S ?? []
}

const clone = value => structuredClone(value)

/**
 * The layout to refill to, once `seen` is read. The first layout read is the target. After that a slot that holds a
 * different tool or more of its tool takes what was seen: the player changed it. An empty slot or a slot that holds
 * less is what a defence used up, so it keeps its target.
 */
function learnTarget(target, seen) {
    if (!target)
        return clone(seen)
    const learned = clone(target)
    for (const slot of SLOTS) {
        const list = slotsOf(learned, slot)
        slotsOf(seen, slot).forEach(([tool, amount], index) => {
            const [wanted, held] = list[index] ?? [EMPTY, 0]
            if (tool == EMPTY || amount <= 0)
                return
            if (tool != wanted || amount > held)
                list[index] = [tool, amount]
        })
    }
    return learned
}

/**
 * What to write to bring `seen` back up to `target`, with `stock`, the tools in storage as a Map of wodID to count.
 * The result holds the body of each section that gets a write, under its command (`dfw`, `dfm`, `dfk`), `placed`, the
 * tools it moves into slots, and `placedBy`, those tools by command. Slots draw on the stock in table order.
 */
function refillPlan(target, seen, stock) {
    const left = new Map(stock)
    const plan = { placed: 0, placedBy: { dfw: 0, dfm: 0, dfk: 0 } }
    const filled = new Set()
    const raised = clone(seen)
    for (const slot of SLOTS) {
        const list = slotsOf(raised, slot)
        const wanted = slotsOf(target, slot)
        list.forEach((held, index) => {
            const [tool, amount] = wanted[index] ?? [EMPTY, 0]
            if (tool == EMPTY || (held[0] != EMPTY && held[0] != tool))
                return
            const give = Math.min(amount - (held[0] == tool ? held[1] : 0), left.get(tool) ?? 0)
            if (give <= 0)
                return
            list[index] = [tool, (held[0] == tool ? held[1] : 0) + give]
            left.set(tool, left.get(tool) - give)
            plan.placed += give
            plan.placedBy[slot[0]] += give
            filled.add(slot[0])
        })
    }
    for (const [command, { sides, sideFields, fields }] of Object.entries(WRITES)) {
        if (!filled.has(command))
            continue
        const section = raised[command]
        plan[command] = sides
            ? Object.fromEntries(sides.map(side => [side, Object.fromEntries(sideFields.map(field => [field, section[side][field]]))]))
            : Object.fromEntries(fields.map(field => [field, section[field]]))
    }
    return plan
}

/**
 * Refills the defence of `castle` once when started and after each Khan attack that `isTaunt` recognises lands.
 * Returns `{ refill }`, which runs a refill now: a call during a refill makes it run once more afterwards. With
 * `dryRun` it reads the defence and logs the plan, and writes nothing.
 */
function keepDefence({ castle, kingdomID, isTaunt, dryRun }) {
    const at = { CX: castle.areaInfo.x, CY: castle.areaInfo.y, AID: castle.id }
    const timers = new Set()
    const scheduled = new Set()
    let target
    let running = false
    let again = false
    let stopped = false

    const refused = (command, result) => console.warn("khanDefenceRefused", command, " ", result === undefined ? "TIMED_OUT" : err[result] ?? result)

    async function refillOnce() {
        const { reply, result } = await ask("dfc", { ...at, KID: -1 })
        if (result != 0)
            return refused("dfc", result)
        target = learnTarget(target, reply)
        const stock = new Map((reply.gui?.I ?? []).map(([wodID, count]) => [Number(wodID), Number(count)]))
        const plan = refillPlan(target, reply, stock)
        if (plan.placed == 0)
            return
        if (dryRun)
            return console.info("khanDefencePlanned", plan.placed)
        let placed = 0
        for (const command of Object.keys(WRITES)) {
            if (!plan[command])
                continue
            const written = await ask(command, { ...at, ...plan[command] })
            if (written.result == 0)
                placed += plan.placedBy[command]
            else
                refused(command, written.result)
        }
        if (placed > 0)
            console.info("khanDefenceRefilled", placed)
    }

    async function refill() {
        if (running) {
            again = true
            return
        }
        running = true
        try {
            do {
                again = false
                await refillOnce()
            } while (again && !stopped)
        } catch (error) {
            console.warn(error)
        } finally {
            running = false
        }
    }

    movementEvents.on("outgoing", march => {
        if (stopped || march.kingdomID != kingdomID || !isTaunt(march) || scheduled.has(march.id))
            return
        scheduled.add(march.id)
        const lands = Math.max(0, march.totalTime - (march.deltaTime - Date.now()))
        const timer = setTimeout(() => {
            timers.delete(timer)
            scheduled.delete(march.id)
            if (!stopped)
                refill()
        }, lands + SETTLE_MS)
        timer.unref?.()
        timers.add(timer)
    })
    events.once("unload", () => {
        stopped = true
        timers.forEach(clearTimeout)
    })
    return { refill }
}

module.exports = { SLOTS, learnTarget, refillPlan, keepDefence }
