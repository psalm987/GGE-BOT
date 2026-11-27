import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00Z") }); vi.spyOn(console, "debug").mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const MINUTE = 60_000
class Lord { constructor(e) { this.lordID = e.ID; this.lordPosition = e.VIS } }

/** The real commander pool with two commanders (lord ids 1 and 2), the player's movements and a stand-in `gam` resync. */
function pool() {
    const bot = fakeBot()
    const movementEvents = new EventEmitter()
    const movements = []
    const syncs = []
    const syncMovements = async () => { syncs.push(Date.now()); return true }
    const { mod } = loadModule("plugins/commander.js", { bot, extra: { "protocols.js": { ClassTypes: { Lord }, movementEvents, movements, syncMovements } } })
    bot.xtHandler.emit("gli", { C: [{ ID: 1, VIS: 0 }, { ID: 2, VIS: 1 }] }, 0)
    const march = (lordID, { arrivesIn = MINUTE, home = false } = {}) => ({
        lord: { lordID }, owner: { ownerID: 7 }, targetOwner: { ownerID: home ? 7 : -1 },
        arrivesAt: Date.now() + arrivesIn, endsAt: Date.now() + arrivesIn, totalTime: arrivesIn,
    })
    const send = (lordID, options) => {
        const movement = march(lordID, options)
        movements.push(movement)
        movementEvents.emit("outgoing", movement)
        return movement
    }
    /** Takes the movement off the list without the "return" event the bot missed. */
    const lose = movement => movements.splice(movements.indexOf(movement), 1)
    const take = () => mod.takeFreeCommander("")
    return { ...mod, send, lose, take, syncs }
}

const isFree = (commanders, lordID) => {
    const taken = []
    for (let lord; (lord = commanders.takeFreeCommander("")); )
        taken.push(lord.lordID)
    taken.forEach(id => commanders.freeCommander(id))
    return taken.includes(lordID)
}

test("a commander whose return the bot missed is free again 60 seconds after its army should be home", async () => {
    const commanders = pool()
    const lord = commanders.take()
    const out = commanders.send(lord.lordID, { arrivesIn: MINUTE })
    commanders.lose(out)
    // An attack's army is home after travelling as far again: 2 minutes, then 60 seconds' grace.
    await vi.advanceTimersByTimeAsync(2.5 * MINUTE)
    expect(isFree(commanders, lord.lordID)).toBe(false)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(isFree(commanders, lord.lordID)).toBe(true)
})

test("a commander with its army still out is never freed by the safety net", async () => {
    const commanders = pool()
    const lord = commanders.take()
    commanders.send(lord.lordID, { arrivesIn: MINUTE })
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(isFree(commanders, lord.lordID)).toBe(false)
})

test("a commander a plugin holds is never freed by the safety net, however long it waits for its turn", async () => {
    const commanders = pool()
    const lord = commanders.take()
    await vi.advanceTimersByTimeAsync(45 * MINUTE)
    expect(isFree(commanders, lord.lordID)).toBe(false)
})

test("a commander the game refused as busy stays busy 3 minutes, is handed to no waiting plugin meanwhile, and asks for the movement list", async () => {
    const commanders = pool()
    const first = commanders.take()
    const second = commanders.take()
    let handed
    commanders.waitForCommanderAvailable("").then(lord => { handed = lord })
    commanders.commanderRefused(first.lordID)
    await vi.advanceTimersByTimeAsync(1)
    expect(handed, "the refused commander is not passed on").toBeUndefined()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(commanders.syncs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2.5 * MINUTE)
    expect(handed).toBeUndefined()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(handed?.lordID).toBe(first.lordID)
    commanders.freeCommander(second.lordID)
})

test("the movement list is asked for at most every 30 seconds", async () => {
    const commanders = pool()
    const a = commanders.take()
    const b = commanders.take()
    commanders.commanderRefused(a.lordID)
    commanders.commanderRefused(b.lordID)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(commanders.syncs).toHaveLength(1)
})

test("a commander marked busy with no army, no holder and no refusal is free again after 10 minutes", async () => {
    const commanders = pool()
    commanders.useCommander(2)
    await vi.advanceTimersByTimeAsync(9 * MINUTE)
    expect(isFree(commanders, 2)).toBe(false)
    await vi.advanceTimersByTimeAsync(1.5 * MINUTE)
    expect(isFree(commanders, 2)).toBe(true)
})
