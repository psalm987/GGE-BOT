import { expect, test } from "vitest"
import type { AccountCastle, BuildPlan, BuildingChoice } from "@gge/contracts"
import { addCastle, addRow, buildingOptions, castleOfPart, countOf, newRow, offeredTo, requirementOf, unplannedCastles } from "../src/build-plan.ts"

const choice = (name: string, rest: Partial<BuildingChoice> = {}): BuildingChoice => ({
    name, nameKey: `${name.toLowerCase()}_name`, label: name, category: "CIVIL", maxLevel: 3, maxCount: 0, upgradeOnly: false, all: false,
    kingdoms: [], notKingdoms: [], areaTypes: [], requires: [[1, 0], [5, 0], [30, 2]], ...rest,
})
const farm = choice("Farm")
const barracks = choice("Barracks", { category: "MILITARY", maxCount: 1 })
const hunter = choice("Hunter", { kingdoms: [0], areaTypes: [1] })
const keep = choice("Keep", { category: "CASTLE", upgradeOnly: true, maxCount: 1, notKingdoms: [10] })
const towers = choice("Towers", { category: "CASTLE", upgradeOnly: true, all: true, notKingdoms: [10] })
const flag = choice("FactionFlag", { category: "DECO", kingdoms: [10], maxLevel: 1 })
const choices = [farm, barracks, hunter, keep, towers, flag]

const main: AccountCastle = { kingdom: 0, id: 100, name: "Home", x: 1, y: 2, type: 1 }
const outpost: AccountCastle = { kingdom: 0, id: 101, name: "Out", x: 3, y: 4, type: 4 }
const camp: AccountCastle = { kingdom: 10, id: 7, name: "Camp", x: 5, y: 6, type: 15 }
const castles = [main, outpost, camp]

test("a castle is offered the buildings of its kingdom and castle type", () => {
    const names = (castle: AccountCastle | undefined, kingdom: number) => offeredTo(choices, kingdom, castle).map(c => c.name)
    expect(names(main, 0)).toEqual(["Farm", "Barracks", "Hunter", "Keep", "Towers"])
    expect(names(outpost, 0)).toEqual(["Farm", "Barracks", "Keep", "Towers"])
    expect(names(camp, 10)).toEqual(["FactionFlag"])
})

test("a castle the account no longer lists is offered by its kingdom alone", () => {
    expect(offeredTo(choices, 0, undefined).map(c => c.name)).toEqual(["Farm", "Barracks", "Hunter", "Keep", "Towers"])
})

test("a plan part finds its castle, and the kingdom's main castle for a main-castle ref", () => {
    expect(castleOfPart(castles, { kingdom: 0, id: 101 })).toBe(outpost)
    expect(castleOfPart(castles, { kingdom: 0, id: -1 })).toBe(main)
    expect(castleOfPart(castles, { kingdom: 0, id: 999 })).toBeUndefined()
})

test("the building select groups by category in the game's order, by name, without the ones the castle already plans", () => {
    const words = { name: (c: BuildingChoice) => c.label, group: (g: string) => `[${g}]` }
    expect(buildingOptions([farm, barracks, keep, towers, choice("Dwelling")], words, new Set(["Farm"]))).toEqual([
        { key: "CASTLE", label: "[CASTLE]", options: [{ value: "Keep", label: "Keep" }, { value: "Towers", label: "Towers" }] },
        { key: "CIVIL", label: "[CIVIL]", options: [{ value: "Dwelling", label: "Dwelling" }] },
        { key: "MILITARY", label: "[MILITARY]", options: [{ value: "Barracks", label: "Barracks" }] },
    ])
})

test("a new row asks for one building at level 1, and an upgrade-only kind at its next level", () => {
    expect(newRow(farm)).toEqual({ building: "Farm", level: 1, count: 1 })
    expect(newRow(keep)).toEqual({ building: "Keep", level: 2, count: 1 })
    expect(newRow(choice("Moat", { upgradeOnly: true, maxLevel: 1 }))).toEqual({ building: "Moat", level: 1, count: 1 })
})

test("how many a row may ask for: one of a single building, the game's limit, else 100, and towers are all of them", () => {
    expect(countOf(farm)).toEqual({ max: 100, fixed: false, all: false })
    expect(countOf(choice("Tavern", { maxCount: 3 }))).toEqual({ max: 3, fixed: false, all: false })
    expect(countOf(barracks)).toEqual({ max: 1, fixed: true, all: false })
    expect(countOf(keep)).toEqual({ max: 1, fixed: true, all: false })
    expect(countOf(towers)).toEqual({ max: 1, fixed: true, all: true })
})

test("a level says the player level and legend level it needs, and nothing when it needs none", () => {
    expect(requirementOf(farm, 1)).toBeUndefined()
    expect(requirementOf(farm, 2)).toEqual({ level: 5, legendLevel: 0 })
    expect(requirementOf(farm, 3)).toEqual({ level: 30, legendLevel: 2 })
    expect(requirementOf(farm, 9)).toBeUndefined()
})

test("adding a castle and a row leaves the plan saveable, and the plan given is not changed", () => {
    const empty: BuildPlan = []
    const one = addCastle(empty, { kingdom: 0, id: 100 })
    expect(one).toEqual([{ castle: { kingdom: 0, id: 100 }, useSkips: false, buyExpansions: false, rows: [] }])
    expect(empty).toEqual([])
    const two = addRow(one, 0, farm)
    expect(two[0]!.rows).toEqual([{ building: "Farm", level: 1, count: 1 }])
    expect(one[0]!.rows).toEqual([])
})

test("the castles still to add are the account's without the ones in the plan", () => {
    const plan: BuildPlan = [{ castle: { kingdom: 0, id: -1 }, useSkips: false, buyExpansions: false, rows: [] }, { castle: { kingdom: 10, id: 7 }, useSkips: false, buyExpansions: false, rows: [] }]
    expect(unplannedCastles(castles, plan)).toEqual([outpost])
})
