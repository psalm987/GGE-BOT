import { describe, expect, test } from "vitest"
import { BladeCoastStatus, bladeCoastLevel } from "../src/blade-coast.ts"

const bladeCoast = {
    map: 27, phase: "attackOut",
    camp: { space: 380, spaceTarget: 400, soldiers: 352, minSoldiers: 350, storehouses: 4, storehousesTarget: 4, wood: 12_400, stone: 9_800, food: 31_000, storage: 40_000 },
    morale: { value: 260, bonus: 151, target: 400 },
    warship: { level: 3, max: 5 },
    islands: { won: 7, total: 12, krakenWon: false },
    nextIsland: { id: 41, level: 9, kraken: false },
    trips: [
        { kind: "attack", island: 40, level: 8, kraken: false, sentAt: 1_000_000, endsAt: 1_600_000 },
        { kind: "troops", amount: 120, endsAt: 1_300_000 },
        { kind: "goods", endsAt: 1_200_000 },
    ],
}

describe("the Blade Coast camp in a status report", () => {
    test("reads a full report", () => {
        expect(BladeCoastStatus.parse(bladeCoast)).toEqual(bladeCoast)
    })

    test("reads a camp between islands, with nothing out and no island left", () => {
        expect(BladeCoastStatus.parse({ ...bladeCoast, phase: "mapDone", nextIsland: null, trips: [], islands: { won: 12, total: 12, krakenWon: true } }).nextIsland).toBeNull()
    })

    test.each([
        ["a map that isn't a Blade Coast map", { ...bladeCoast, map: 23 }],
        ["a phase the card can't name", { ...bladeCoast, phase: "sailing" }],
        ["an attack that went out from before a restart without its island", { ...bladeCoast, trips: [{ kind: "attack", away: 300 }] }],
    ])("is refused for %s", (_, report) => {
        expect(BladeCoastStatus.safeParse(report).success).toBe(false)
    })

    test("names each map by its place in the order they are played", () => {
        expect(([22, 27, 28] as const).map(bladeCoastLevel)).toEqual([1, 2, 3])
    })
})
