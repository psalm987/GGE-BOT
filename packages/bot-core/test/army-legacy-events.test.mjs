import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")

/**
 * The `cra` the five event and Storm plugins sent before they had an army mode, a unit order and a troop supply. The
 * snapshots were written from that code, so a stored config with none of the new options must keep producing these frames.
 */
const eventTool = (wodID, amount, info) => unit(wodID, amount, { fightType: 0, typ: "Attack", usageEventID: "5,72", slotTypes: "1,2,9", ...info })
const inventory = () => [
    melee(601, 900, { speed: "20", meleeAttack: "90" }),
    melee(602, 700, { speed: "26", meleeAttack: "140", foodSupply: undefined, meadSupply: "2" }),
    ranged(603, 800, { speed: "24", rangeAttack: "80" }),
    ranged(604, 600, { speed: "30", rangeAttack: "150", foodSupply: undefined, meadSupply: "2" }),
    melee(277, 300, { speed: "40", meleeAttack: "5" }),
    melee(34, 200, { speed: "22", meleeAttack: "60" }),
    unit(690, 50, { role: "melee", beefSupply: "1" }),
    tool(614, 400, { wallBonus: "10" }),
    tool(649, 400, { wallBonus: "20" }),
    tool(615, 400, { defRangeBonus: "10" }),
    eventTool(106, 120, { ragePointBonus: "1" }),
    eventTool(563, 15, { ragePointBonus: "2" }),
    eventTool(107, 30, { ragePointBonus: "1", khanTabletBooster: "1" }),
    eventTool(162, 60, { khanTabletBooster: "4" }),
    eventTool(164, 25, { khanTabletBooster: "6" }),
    eventTool(740, 40, { khanTabletBooster: "3", wallBonus: "25" }),
    eventTool(738, 40, { khanTabletBooster: "3", gateBonus: "25", slotTypes: "1,9" }),
    eventTool(739, 40, { khanTabletBooster: "3", defRangeBonus: "20" }),
    eventTool(801, 50, { samuraiTokenBooster: "4" }),
    eventTool(802, 20, { samuraiTokenBooster: "7" }),
    eventTool(803, 40, { samuraiTokenBooster: "3", wallBonus: "25" }),
    eventTool(901, 50, { pointBonus: "4" }),
    eventTool(902, 20, { pointBonus: "9" }),
    eventTool(903, 30, { pointBonus: "3", wallBonus: "25" }),
    eventTool(904, 30, { reputationBonus: "5" }),
]

const scaled = { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50", playerRageCap: "1500" }] }
const camp = (type, extraData) => ({ type, x: 110, y: 105, extraData })
const games = {
    attackNomads: { areas: [camp(27, [0, 0, 0, 0, 0, 5, 0])], start: { EDID: 3 }, items: scaled },
    attackSamurai: { areas: [camp(29, [0, 0, 0, 0, 0, 5, 0])], start: { EDID: 3 }, items: scaled },
    attackKhan: { areas: [camp(35, [0, 0, 0, 0, 0, 0, 5])], start: { EDID: 3 }, items: scaled },
    attackBerimondInvasion: { areas: [camp(30, [0, 12, 0, 0, 0, 0, 100])] },
    attackStormForts: { areas: [{ ...camp(25, [0, 0, 8, 0, 3, 0]), timeSinceRequest: 0 }], castle: { aqua: 0, getProductionData: { maxAmountAqua: 1_000_000 } } },
}
const run = (plugin, options = {}, game = {}) => runEvent(plugin, options, { inventory: inventory(), ...games[plugin], ...game })

describe("event and Storm attacks, as stored configs run today", () => {
    test.each([
        ["attackNomads", "the defaults", { useFood: true }],
        ["attackNomads", "wall tools first, weakest chests, food troops only, a feather", { useFood: true, eventWallToolsFirst: true, lowValueChests: true, foodTroopsOnly: true, useFeather: true }],
        ["attackNomads", "no chests, no food troops, a coin horse", { useFood: false, noChests: true, useCoin: true }],
        ["attackSamurai", "the defaults", {}],
        ["attackSamurai", "weakest chests, food troops only, a coin horse", { lowValueChests: true, foodTroopsOnly: true, useCoin: true }],
        ["attackSamurai", "no chests", { noChests: true }],
        ["attackKhan", "the defaults", { wavesTillChests: "4", useCoin: true, useFood: true }],
        ["attackKhan", "chests from the third wave, weakest first", { wavesTillChests: "2", lowValueChests: true, useFood: true }],
        ["attackKhan", "wall tools first, food troops only", { wavesTillChests: "4", eventWallToolsFirst: true, foodTroopsOnly: true, useFood: true }],
        ["attackKhan", "no chests, a feather", { wavesTillChests: "4", noChests: true, useFeather: true, useFood: true }],
        ["attackBerimondInvasion", "the defaults", { wavesTillChests: "4" }],
        ["attackBerimondInvasion", "reputation, weakest chests", { wavesTillChests: "4", reputation: true, lowValueChests: true }],
        ["attackBerimondInvasion", "no event tools, food troops only, a coin horse", { wavesTillChests: "4", noEventTools: true, foodTroopsOnly: true, useCoin: true }],
        ["attackStormForts", "the defaults", { allowLvl70Easy: true }],
        ["attackStormForts", "a feather", { allowLvl70Easy: true, useFeather: true }],
    ])("%s: %s", async (plugin, _, options) => {
        const { cra } = await run(plugin, { commanderWhiteList: "1-99", ...options })
        expect(cra).toMatchSnapshot()
    })

    test.each([
        ["attackNomads", { nomadCamps: [{ id: 3, countVictory: 12 }] }, [0, 3, 0, 0, 0, 0, 0], 27],
        ["attackSamurai", { samuraiCamps: [{ countVictory: "12" }] }, [0, 11, 0, 0, 0, 0, 0], 29],
    ])("%s on a classic camp", async (plugin, items, extraData, type) => {
        const { cra } = await run(plugin, { commanderWhiteList: "1-99", useFood: true }, { areas: [camp(type, extraData)], start: { EDID: 0 }, items })
        expect(cra).toMatchSnapshot()
    })

    test("a commander with more waves and bigger flanks", async () => {
        const effects = { additionalWaves: 1, attackUnitAmountFlank: 20, attackUnitAmountFront: 10, attackUnitAmountReinforcementBonus: 50 }
        for (const plugin of Object.keys(games))
            expect((await run(plugin, { commanderWhiteList: "1-99", useFood: true, wavesTillChests: "4", allowLvl70Easy: true }, { effects })).cra).toMatchSnapshot(plugin)
    })
})
