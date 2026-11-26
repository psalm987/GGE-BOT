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

const castleList = (...castles) => ({ C: [{ KID: 0, AI: castles.map(castle => ({ gpa: {}, ...castle })) }] })
/** Joins castle 100 of kingdom 0 the way setCastle does, answering its `jca` with a `jaa`. */
async function joinCastle(mod, bot, castle = mod.castles[0]) {
    const joined = mod.setCastle(castle, () => "done")
    await new Promise(resolve => setImmediate(resolve))
    bot.xtHandler.emit("jaa", { KID: castle.kingdomID, grc: { KID: castle.kingdomID, AID: castle.id }, gca: {} }, 0)
    return joined
}

describe("castle updates", () => {
    const amounts = list => list.map(unit => [unit.unitInfo.wodID, unit.amount])

    test("hru puts the castle's new unit counts on the castle", async () => {
        const { mod, bot } = loadModule("protocols.js", { items: { units: [{ wodID: 10 }, { wodID: 11 }] } })
        bot.xtHandler.emit("dcl", castleList({ AID: 100, AC: [[10, 5]] }), 0)
        await joinCastle(mod, bot)

        bot.xtHandler.emit("hru", { gui: { I: [[10, 9], [11, 2]], HI: [[10, 1]] } }, 0)

        expect(amounts(mod.castles[0].unitInventory)).toEqual([[10, 9], [11, 2]])
        expect(amounts(mod.castles[0].hospitalInventory)).toEqual([[10, 1]])
    })

    test("an hru without gui keeps the units and still passes its gcu on", async () => {
        const { mod, bot } = loadModule("protocols.js", { items: { units: [{ wodID: 10 }] } })
        bot.xtHandler.emit("dcl", castleList({ AID: 100, AC: [[10, 5]] }), 0)
        await joinCastle(mod, bot)

        expect(() => bot.xtHandler.emit("hru", { gcu: { C1: 1234, C2: 5 } }, 0)).not.toThrow()

        expect(amounts(mod.castles[0].unitInventory)).toEqual([[10, 5]])
        expect(mod.resources.coins).toBe(1234)
    })

    test("an update that leaves out a building flag keeps it, and one that sends it changes it", () => {
        const { mod, bot } = loadModule("protocols.js")
        bot.xtHandler.emit("dcl", castleList({ AID: 100, B: 1, WS: 1, DW: 1, H: 1 }), 0)

        bot.xtHandler.emit("dcl", castleList({ AID: 100, W: 50 }), 0)
        expect(mod.castles[0]).toMatchObject({ hasBarracks: true, hasSiegeWorkshop: true, hasDefenseWorkshop: true, hasHospital: true, wood: 50 })

        bot.xtHandler.emit("dcl", castleList({ AID: 100, H: 0 }), 0)
        expect(mod.castles[0]).toMatchObject({ hasBarracks: true, hasHospital: false })
    })
})

describe("which castle the bot is in", () => {
    function twoCastles() {
        const { mod, bot } = loadModule("protocols.js")
        bot.xtHandler.emit("dcl", castleList({ AID: 100 }, { AID: 101 }), 0)
        const joins = () => bot.sent.filter(([cmd]) => cmd == "jca").map(([, req]) => req.CID)
        /** Runs a command in `castle`, answering the join when one is sent. */
        const runIn = async castle => {
            const before = joins().length
            const done = mod.setCastle(castle, () => "ran")
            await new Promise(resolve => setImmediate(resolve))
            if (joins().length > before)
                bot.xtHandler.emit("jaa", { KID: 0, grc: { KID: 0, AID: castle.id }, gca: {} }, 0)
            return done
        }
        const [first, second] = mod.castles
        return { mod, bot, joins, runIn, first, second }
    }

    test("a castle the bot is in is not joined again", async () => {
        const { joins, runIn, first } = twoCastles()
        await runIn(first)
        await runIn(first)
        expect(joins()).toEqual([100])
    })

    test("the game moving the player into another area unasked means the castle is joined again", async () => {
        const { bot, joins, runIn, first } = twoCastles()
        await runIn(first)

        bot.xtHandler.emit("jaa", { KID: 0, grc: { KID: 0, AID: 101 }, gca: {} }, 0)
        await runIn(first)
        bot.xtHandler.emit("jaa", { KID: 10, T: 15, grc: { KID: 10, AID: 55 }, gca: {} }, 0)
        await runIn(first)

        expect(joins()).toEqual([100, 100, 100])
    })

    test("being moved into a castle counts as being in it", async () => {
        const { bot, joins, runIn, second } = twoCastles()
        bot.xtHandler.emit("jaa", { KID: 0, grc: { KID: 0, AID: 101 }, gca: {} }, 0)
        await runIn(second)
        expect(joins()).toEqual([])
    })

    test("a refusal with NOT_IN_OWNED_CASTLE, or a plugin forgetting the castle, means it is joined again", async () => {
        const { mod, bot, joins, runIn, first } = twoCastles()
        await runIn(first)

        bot.xtHandler.emit("notInOwnedCastle", "bup")
        await runIn(first)
        mod.forgetCurrentCastle()
        await runIn(first)

        expect(joins()).toEqual([100, 100, 100])
    })

    test("a join over 2 minutes old is made again, since the game forgets it without saying so", async () => {
        vi.useFakeTimers({ toFake: ["Date"] })
        const { joins, runIn, first } = twoCastles()
        await runIn(first)

        vi.setSystemTime(Date.now() + 2 * 60 * 1000)
        await runIn(first)
        expect(joins()).toEqual([100])

        vi.setSystemTime(Date.now() + 1)
        await runIn(first)
        expect(joins()).toEqual([100, 100])
    })

    test("a command that works from any castle leaves the castle the bot is in", async () => {
        const { mod, joins, runIn, first } = twoCastles()
        await runIn(first)
        await mod.setCastle(undefined, () => "map look")
        await runIn(first)
        expect(joins()).toEqual([100])
    })

    test("the production lists a castle join carries are kept per castle and list", () => {
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(1_800_000_000_000)
        const { mod, bot } = twoCastles()
        const barracks = { LID: 0, QS: [{ SI: { RUT: -1 } }], PS: {} }
        const hospital = { LID: 2, PIDL: [[-1]] }

        bot.xtHandler.emit("jaa", { KID: 0, grc: { KID: 0, AID: 101 }, gca: {}, spl0: barracks, spl2: hospital, spl3: "junk" }, 0)

        expect(mod.castleQueue(0, 101, 0)).toEqual({ spl: barracks, at: 1_800_000_000_000 })
        expect(mod.castleQueue(0, 101, 2)).toEqual({ spl: hospital, at: 1_800_000_000_000 })
        expect(mod.castleQueue(0, 101, 1)).toBeUndefined()
        expect(mod.castleQueue(0, 100, 0)).toBeUndefined()
    })
})

describe("a movement with no map position", () => {
    test("reads as an empty place, and the rest of the movement list is still read", () => {
        const { mod, gam } = movementsBot()

        gam(march({ id: 1, TA: undefined, SA: undefined }), march({ id: 2 }))

        expect(mod.movements.map(m => m.id)).toEqual([1, 2])
        expect(mod.movements[0].targetAttack.extraData).toEqual([])
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

    test("an army stationed at an ally stays until its stay is over: TWD the whole stay, PWD the part already over", async () => {
        vi.useFakeTimers()
        const { seen, gam } = movementsBot()
        gam(march({ id: 1, T: 1, to: 98, TT: 60, PT: 660 }, { UM: { TWD: 3600, PWD: 600 } }),
            march({ id: 2, T: 1, to: 98, TT: 60, PT: 20 }, { UM: { TWD: 3600, PWD: 0 } }))

        await vi.advanceTimersByTimeAsync(3_009_999)
        expect(seen.ended).toEqual([])
        await vi.advanceTimersByTimeAsync(1)
        expect(seen.ended, "standing there 600 s of 3600 s: over in 3000 s").toEqual([1])
        await vi.advanceTimersByTimeAsync(3_649_999 - 3_010_000)
        expect(seen.ended).toEqual([1])
        await vi.advanceTimersByTimeAsync(1)
        expect(seen.ended, "still marching for 40 s, then 3600 s there").toEqual([1, 2])
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
