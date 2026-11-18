import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { barons, fortress, melee, ranged, tool, unit } = require("./harness/army-bots.cjs")

/**
 * The `cra` each shared builder sent before armies had modes, unit orders and troop supply. The snapshots were
 * written from that code, so a stored config with none of the new options must keep producing these frames.
 */
const inventory = () => [
    melee(601, 900, { speed: "20", meleeAttack: "90" }),
    melee(602, 700, { speed: "26", meleeAttack: "140", foodSupply: undefined, meadSupply: "2" }),
    ranged(603, 800, { speed: "24", rangeAttack: "80" }),
    ranged(604, 600, { speed: "30", rangeAttack: "150", foodSupply: undefined, meadSupply: "2" }),
    melee(277, 300, { speed: "40", meleeAttack: "5" }),
    unit(690, 50, { role: "melee", beefSupply: "1" }),
    tool(614, 400, { wallBonus: "10" }),
    tool(649, 400, { wallBonus: "20" }),
    tool(615, 400, { defRangeBonus: "10" }),
]

const baronDefaults = {
    useFeather: false, useCoin: true, useTimeSkips: false, upgradeTowers: false, useWallTools: true, useShields: false, useDogs: false,
    foodTroopsOnly: false, attackLeft: false, attackMiddle: false, attackRight: false, attackCourtyard: false, commanderWhiteList: "1-99", attackWaves: "2",
}

describe("robber barons, as stored configs run today", () => {
    test.each([
        ["the defaults", {}],
        ["every side, the courtyard, shields and four waves", { attackLeft: true, attackMiddle: true, attackRight: true, attackCourtyard: true, useShields: true, attackWaves: "4" }],
        ["food troops only, with a feather", { foodTroopsOnly: true, useFeather: true, useCoin: false, attackMiddle: true }],
        ["dogs, without wall tools", { useDogs: true, useWallTools: false, attackLeft: true, attackRight: true }],
    ])("%s", async (_, options) => {
        const { cra } = await barons({ ...baronDefaults, ...options }, { inventory: inventory() })
        expect(cra).toMatchSnapshot()
    })

    test("a commander with shield maidens leaves the courtyard empty", async () => {
        const { cra } = await barons({ ...baronDefaults }, { inventory: inventory(), effects: { AttackSupportUnits: 1, attackUnitAmountFlank: 20 } })
        expect(cra).toMatchSnapshot()
    })

    test("every side off attacks left, middle and right, as the help text promises", async () => {
        const off = await barons({ ...baronDefaults }, { inventory: inventory() })
        const allOn = await barons({ ...baronDefaults, attackLeft: true, attackMiddle: true, attackRight: true, attackCourtyard: true }, { inventory: inventory() })
        expect(off.cra).toEqual(allOn.cra)
    })
})

describe("fortresses, as stored configs run today", () => {
    test.each([
        ["Burning Sands", { kingdomID: 1, level: 44 }],
        ["Fire Peaks", { kingdomID: 3, level: 60 }],
    ])("%s", async (_, game) => {
        const { cra } = await fortress({ commanderWhiteList: "1-99" }, { inventory: inventory(), ...game })
        expect(cra).toMatchSnapshot()
    })

    test("a commander with shield maidens leaves the courtyard empty", async () => {
        const { cra } = await fortress({ commanderWhiteList: "1-99" }, { inventory: inventory(), effects: { AttackSupportUnits: 1 } })
        expect(cra).toMatchSnapshot()
    })
})
