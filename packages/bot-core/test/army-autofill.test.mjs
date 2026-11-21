import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"
import { ARMY_MODES, TROOP_SUPPLIES, UNIT_ORDERS } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { barons, fortress, melee, ranged, tool } = require("./harness/army-bots.cjs")
const army = require("../army.js")

const FOOD_SLOW = 601, MEAD_STRONG = 602, FOOD_RANGED = 603, MEAD_FAST = 604
const inventory = () => [
    melee(FOOD_SLOW, 900, { speed: "20", meleeAttack: "90" }),
    melee(MEAD_STRONG, 700, { speed: "26", meleeAttack: "140", foodSupply: undefined, meadSupply: "2" }),
    ranged(FOOD_RANGED, 800, { speed: "24", rangeAttack: "80" }),
    ranged(MEAD_FAST, 600, { speed: "30", rangeAttack: "150", foodSupply: undefined, meadSupply: "2" }),
    tool(614, 400, { wallBonus: "10" }),
]
const sent = cra => [...new Set([...cra.A.flatMap(wave => [wave.L.U, wave.M.U, wave.R.U]).flat(), ...cra.RW].map(([wodID]) => wodID).filter(wodID => wodID != -1))]
/** The melee troop of wave 2's left flank and the ranged troop of wave 1's: the first each pool hands out. */
const firstPicks = cra => ({ ranged: cra.A[0].L.U[0][0], melee: cra.A[1].L.U[0][0] })
const order = name => army.UNIT_ORDERS.indexOf(name)
const supply = name => army.TROOP_SUPPLIES.indexOf(name)

test("the bot and the contracts name the same unit orders, troop supplies and army modes", () => {
    expect(army.UNIT_ORDERS).toEqual([...UNIT_ORDERS])
    expect(army.TROOP_SUPPLIES).toEqual([...TROOP_SUPPLIES])
    expect(army.ARMY_MODES).toEqual([...ARMY_MODES])
})

describe("robber barons autofill", () => {
    test.each([
        ["castle", { ranged: FOOD_RANGED, melee: FOOD_SLOW }],
        ["fastest", { ranged: MEAD_FAST, melee: MEAD_STRONG }],
        ["strongest", { ranged: MEAD_FAST, melee: MEAD_STRONG }],
        ["weakest", { ranged: FOOD_RANGED, melee: FOOD_SLOW }],
    ])("unit order %s picks its first troops", async (name, picks) => {
        const { cra } = await barons({ useWallTools: true, attackWaves: "2", unitOrder: order(name) }, { inventory: inventory() })
        expect(firstPicks(cra)).toEqual(picks)
    })

    test.each([
        ["all", [FOOD_RANGED, FOOD_SLOW]],
        ["food", [FOOD_RANGED, FOOD_SLOW]],
        ["mead", [MEAD_FAST, MEAD_STRONG]],
    ])("troop supply %s sends only troops that eat it", async (name, troops) => {
        const { cra } = await barons({ useWallTools: true, attackWaves: "2", attackLeft: true, supply: supply(name) }, { inventory: inventory() })
        expect(sent(cra).sort()).toEqual(troops.sort())
    })

    test("the older food-only switch still applies while the troop supply is All, and a picked supply wins over it", async () => {
        const meadFirst = [inventory()[1], inventory()[3], inventory()[0], inventory()[2]]
        const food = await barons({ useWallTools: true, attackWaves: "2", attackLeft: true, foodTroopsOnly: true }, { inventory: meadFirst })
        expect(sent(food.cra).sort()).toEqual([FOOD_SLOW, FOOD_RANGED])
        const mead = await barons({ useWallTools: true, attackWaves: "2", attackLeft: true, foodTroopsOnly: true, supply: supply("mead") }, { inventory: inventory() })
        expect(sent(mead.cra).sort()).toEqual([MEAD_STRONG, MEAD_FAST])
    })
})

describe("fortress autofill", () => {
    test.each([
        ["fastest", MEAD_FAST],
        ["strongest", MEAD_FAST],
        ["weakest", FOOD_RANGED],
        ["castle", FOOD_SLOW],
    ])("unit order %s picks its first troop", async (name, first) => {
        const { cra } = await fortress({ unitOrder: order(name) }, { inventory: inventory() })
        expect(cra.A[0].L.U[0][0]).toBe(first)
    })

    test.each([
        ["food", [FOOD_SLOW, FOOD_RANGED]],
        ["mead", [MEAD_STRONG, MEAD_FAST]],
    ])("troop supply %s sends only troops that eat it", async (name, troops) => {
        const { cra } = await fortress({ supply: supply(name) }, { inventory: inventory() })
        expect(sent(cra).sort()).toEqual(troops)
    })

    test.each([
        ["no horse", 0, { HBW: -1, PTT: 0 }],
        ["a coin horse", 1, { HBW: 1, PTT: 0 }],
        ["a feather", 2, { HBW: -1, PTT: 1 }],
        ["a feather when nothing is stored", undefined, { HBW: -1, PTT: 1 }],
    ])("rides %s", async (_, horse, frame) => {
        const { cra } = await fortress({ horse }, { inventory: inventory() })
        expect(cra).toMatchObject(frame)
    })
})

describe("time skips per plugin", () => {
    const skips = (settings, resources) => {
        const bot = fakeBot()
        bot.botConfig.plugins.skips = settings
        return loadModule("plugins/skips.js", { bot, extra: { protocols: { resources } } }).mod
    }
    const owned = { "1MinSkip": 10, "5MinSkip": 10, "10MinSkip": 10, "30MinSkip": 10, "60MinSkip": 10, "5HourSkip": 10, "24HourSkip": 10 }
    const everySkip = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true }

    test("without a list of its own a plugin spends what the Skips settings allow", () => {
        expect(skips(everySkip, owned).spendSkip(3600)).toBe("MS5")
        expect(skips({ ...everySkip, "1Hour": false }, owned).spendSkip(3600)).not.toBe("MS5")
        expect(skips(everySkip, owned).spendSkip(3600, null)).toBe("MS5")
    })

    test("a plugin's own list replaces the Skips settings for that plugin", () => {
        const { spendSkip, haveEnoughSkips } = skips(everySkip, owned)
        expect(spendSkip(3600, [30])).toBe("MS4")
        expect(spendSkip(3600, [])).toBeUndefined()
        expect(haveEnoughSkips(3600, [30])).toBe(true)
        expect(haveEnoughSkips(3600 * 24, [1])).toBe(false)
        expect(skips({ ...everySkip, "1Hour": false }, owned).spendSkip(3600, [60])).toBe("MS5")
    })

    test("a list that can't be read falls back to the Skips settings", () => {
        expect(skips(everySkip, owned).spendSkip(3600, ["60"])).toBe("MS5")
        expect(skips(everySkip, owned).spendSkip(3600, "all")).toBe("MS5")
    })

    test("robber barons skip the wait with their own list", async () => {
        const game = { inventory: inventory(), resources: { "5MinSkip": 5, "60MinSkip": 5 } }
        const area = () => ({ type: 2, x: 110, y: 105, extraData: [0, 400, 3000], timeSinceRequest: Date.now() })
        const global = await barons({ useTimeSkips: true, attackWaves: "2" }, { ...game, area: area() })
        expect(global.skipped).toEqual(["MS5"])
        const own = await barons({ useTimeSkips: true, attackWaves: "2", skipTypes: [5] }, { ...game, area: area() })
        expect(own.skipped).toEqual(["MS2"])
    })

    test("a march home and the robber baron loop spend one skip between them on the tower they share", async () => {
        const area = { type: 2, x: 110, y: 105, extraData: [0, 400, 3000], timeSinceRequest: Date.now() }
        const home = { kingdomID: 0, targetOwner: { ownerID: 7 }, targetAttack: { type: 1, x: 100, y: 100 }, sourceAttack: area }
        const movementEvents = new EventEmitter()
        const waitToAttack = async job => {
            movementEvents.emit("returning", home)
            return job()
        }
        const { cra, skipped } = await barons({ useTimeSkips: true, attackWaves: "2" }, {
            inventory: inventory(), resources: { "60MinSkip": 5 }, area, movements: [home], movementEvents, waitToAttack,
            skipLands: () => new Promise(resolve => setTimeout(resolve, 2)),
        })
        expect(skipped).toEqual(["MS5"])
        expect(cra).toBeDefined()
    })
})
