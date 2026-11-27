import { expect, test } from "vitest"
import type { BladeCoastTool, BladeCoastUnit } from "@gge/contracts"
import { EMPTY_SETUP, missingPicks, tripProgress, tripsUnderWay, unitOptions } from "../src/blade-coast.ts"

const troops: BladeCoastUnit[] = [
    { type: "Swordsman", nameKey: "swordsman_name", name: "Swordsman", recruitGroup: "attackTroops", levels: [3, 5] },
    { type: "Corsair", nameKey: "corsair_name", name: "Corsair", recruitGroup: "eventTroops", levels: [0] },
    { type: "Archer", nameKey: "archer_name", name: "Archer", recruitGroup: "attackTroops", levels: [1] },
]
const tools: BladeCoastTool[] = [
    { type: "Ladder", nameKey: "ladder_name", name: "Ladder", recruitGroup: "attackTools", levels: [1], roles: ["wall"] },
    { type: "Mantlet", nameKey: "mantlet_name", name: "Mantlet", recruitGroup: "attackTools", levels: [1], roles: ["ranged", "wall"] },
]
const words = {
    name: (unit: BladeCoastUnit) => unit.name,
    level: (name: string, level: number) => `${name} level ${level}`,
    group: (group: string) => `[${group}]`,
}

test("a unit select lists each type at each level under its recruit group, named by name and level, a type with no levels by name alone", () => {
    expect(unitOptions(troops, words)).toEqual([
        { key: "attackTroops", label: "[attackTroops]", options: [
            { value: "Archer#1", label: "Archer level 1" },
            { value: "Swordsman#3", label: "Swordsman level 3" },
            { value: "Swordsman#5", label: "Swordsman level 5" },
        ] },
        { key: "eventTroops", label: "[eventTroops]", options: [{ value: "Corsair#0", label: "Corsair" }] },
    ])
})

test("a tool select lists the tools for its defence, without one already picked for another defence", () => {
    const wall = (skip: string[]) => unitOptions(tools.filter(tool => tool.roles.includes("wall")), words, new Set(skip)).flatMap(group => group.options.map(o => o.value))
    expect(wall([])).toEqual(["Ladder#1", "Mantlet#1"])
    expect(wall(["Mantlet"])).toEqual(["Ladder#1"])
})

test("a setup lists what it still lacks: the castle, the troop, then each defence's tool", () => {
    expect(missingPicks(EMPTY_SETUP)).toEqual(["castle", "troop", "wall", "gate", "ranged"])
    expect(missingPicks({ castle: { kingdom: 0, id: 1 }, troop: "Swordsman#5", tools: { wall: "Ladder#1", gate: null, ranged: "Mantlet#1" } })).toEqual(["gate"])
})

const attack = { kind: "attack" as const, island: 40, level: 8, kraken: false, sentAt: 1_000, endsAt: 5_000 }

test("the card shows what is still on its way, soonest first, and an attack whose landing time isn't known stays", () => {
    const trips = [attack, { kind: "goods" as const, endsAt: 2_000 }, { kind: "troops" as const, amount: 120, endsAt: 900 }, { ...attack, island: 41, sentAt: null, endsAt: null }]
    expect(tripsUnderWay(trips, 1_500).map(trip => trip.kind === "attack" ? trip.island : trip.kind)).toEqual(["goods", 40, 41])
})

test("an attack's progress runs from when it was sent to when it lands, and is unknown without both", () => {
    expect(tripProgress(attack, 3_000)).toBe(0.5)
    expect(tripProgress(attack, 9_000)).toBe(1)
    expect(tripProgress({ ...attack, sentAt: null }, 3_000)).toBeNull()
    expect(tripProgress({ kind: "goods", endsAt: 2_000 }, 1_000)).toBeNull()
})
