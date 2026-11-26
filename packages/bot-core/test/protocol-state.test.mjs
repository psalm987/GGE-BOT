import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const ME = 7
/** A `gam` movement entry: by default the player's own march home, 60 s long and 30 s in. */
const march = ({ id = 42, from = ME, to = ME, ...m } = {}, rest = {}) => ({
    M: { MID: id, T: 0, KID: 0, OID: from, SID: from, TID: to, TT: 60, PT: 30, TA: [1, 3, 4, 100], SA: [1, 0, 0, 200], ...m },
    ...rest,
})

function movementsBot() {
    const { mod, bot } = loadModule("protocols.js", { items: { units: [{ wodID: 10 }] } })
    const seen = { return: [], ended: [] }
    for (const name of Object.keys(seen))
        mod.movementEvents.on(name, movement => seen[name].push(movement.id))
    const gam = (...marches) => bot.xtHandler.emit("gam", { M: marches, O: [] }, 0)
    return { mod, bot, seen, gam }
}

describe("a movement the game removes", () => {
    test("dms is the game's delete-message reply: a numeric MID neither throws nor ends a march", () => {
        const { mod, bot, seen, gam } = movementsBot()
        gam(march())

        expect(() => bot.xtHandler.emit("dms", { MID: 42 }, 0)).not.toThrow()

        expect(mod.movements.map(m => m.id)).toEqual([42])
        expect(seen).toEqual({ return: [], ended: [] })
    })

    test("mrm ends the movement it names: ended for any movement, return only for a march home", () => {
        const { mod, bot, seen, gam } = movementsBot()
        gam(march({ id: 42 }), march({ id: 43, to: 98 }))

        bot.xtHandler.emit("mrm", { MID: 43 }, 0)
        expect(seen).toEqual({ return: [], ended: [43] })

        bot.xtHandler.emit("mrm", { MID: 42 }, 0)
        expect(seen).toEqual({ return: [42], ended: [43, 42] })
        expect(mod.movements).toEqual([])
    })

    test("an mrm for a movement the bot doesn't know, or a refused one, changes nothing", () => {
        const { mod, bot, seen, gam } = movementsBot()
        gam(march())

        bot.xtHandler.emit("mrm", { MID: 99 }, 0)
        bot.xtHandler.emit("mrm", { MID: 42 }, 114)

        expect(mod.movements.map(m => m.id)).toEqual([42])
        expect(seen).toEqual({ return: [], ended: [] })
    })

    test("a march that runs its course ends once, even when the game also removes it", async () => {
        vi.useFakeTimers()
        const { bot, seen, gam } = movementsBot()
        gam(march())

        await vi.advanceTimersByTimeAsync(45_000)
        bot.xtHandler.emit("mrm", { MID: 42 }, 0)
        await vi.advanceTimersByTimeAsync(60_000)

        expect(seen).toEqual({ return: [42], ended: [42] })
    })
})

describe("when a march counts as over", () => {
    test("10 s after the game's time, since the game removes it a few seconds late and refuses the commander until then", async () => {
        vi.useFakeTimers()
        const { seen, gam } = movementsBot()
        gam(march({ TT: 60, PT: 30 }))

        await vi.advanceTimersByTimeAsync(39_999)
        expect(seen.return).toEqual([])
        await vi.advanceTimersByTimeAsync(1)
        expect(seen.return).toEqual([42])
    })

    const home = { KID: 0, AI: [{ AID: 100, AC: [[10, 5]], gpa: {} }] }
    const stationed = march({ TT: 60, PT: 30 }, { A: [[10, 20]] })
    const unitsAtHome = mod => mod.castles[0].unitInventory.map(unit => unit.amount)

    test("a march home adds its troops to a castle list read before it landed", async () => {
        vi.useFakeTimers()
        const { mod, bot, gam } = movementsBot()
        bot.xtHandler.emit("dcl", { C: [home] }, 0)
        gam(stationed)

        await vi.advanceTimersByTimeAsync(40_000)

        expect(unitsAtHome(mod)).toEqual([25])
    })

    test("a castle list read after it landed already counts the troops, so they are not added twice", async () => {
        vi.useFakeTimers()
        const { mod, bot, gam } = movementsBot()
        gam(stationed)

        await vi.advanceTimersByTimeAsync(35_000)
        bot.xtHandler.emit("dcl", { C: [{ ...home, AI: [{ ...home.AI[0], AC: [[10, 25]] }] }] }, 0)
        await vi.advanceTimersByTimeAsync(5_000)

        expect(unitsAtHome(mod)).toEqual([25])
    })
})
