import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

// Hand-made rows in the shape of the game's buildings.json and expansions.json, not copied from it.
const buildings = [
    { wodID: 200, name: "Castle", width: "20", height: "20", rotateType: "0" },
    { wodID: 201, name: "Castle", width: "10", height: "20", rotateType: "0" },
    { wodID: 263, name: "Unittent", level: "1", width: "5", height: "5", buildDuration: "1800", upgradeWodID: "371" },
    { wodID: 371, name: "Unittent", level: "2", width: "5", height: "5", buildDuration: "2400" },
    { wodID: 372, name: "Unittent", level: "3", width: "5", height: "5", buildDuration: "6000" },
    { wodID: 265, name: "Storage", level: "1", width: "4", height: "6", buildDuration: "3600" },
    { wodID: 900, name: "Longhall", width: "3", height: "12", rotateType: "1" },
    { wodID: 901, name: "Longhall", width: "3", height: "12", rotateType: "0" },
    { wodID: 902, name: "Square", width: "4", height: "4" },
    { wodID: 903, name: "Well", width: "2", height: "2" },
]
const expansions = [
    { expansionID: "1", spaceIDs: "0", expansionLevel: "1", costWood: "29", costStone: "5" },
    { expansionID: "74", spaceIDs: "21,22,23", expansionLevel: "1", costWood: "511", costStone: "510" },
    { expansionID: "75", spaceIDs: "21,22,23", expansionLevel: "2", costWood: "900", costStone: "900" },
]

const layoutModule = () => loadModule("castleLayout.js", { items: { buildings, expansions } }).mod

const castleGround = { wodID: 200, objectID: 1, x: 0, y: 0, rotation: 0 }
const building = (wodID, x, y, rest = {}) => ({ wodID, objectID: 0, x, y, rotation: 0, districtID: 0, ...rest })

describe("parsing gca", () => {
    test("a building row keeps seconds done, the boost as a factor, its district and its upgrade target", () => {
        const { parseCastleLayout } = layoutModule()
        const row = [263, 41, 3, 7, 1, 200, 13, 100, 150, 100, 0, 0, 0, 0, 5, 372]
        const layout = parseCastleLayout({ BD: [row] })
        expect(layout.buildings).toEqual([{
            wodID: 263, objectID: 41, x: 3, y: 7, rotation: 1, secondsDone: 200, state: 13, hitPoints: 100, boost: 1.5,
            efficiency: 100, damageType: 0, districtID: 5, upgradeTargetWodID: 372,
        }])
    })

    test("a short row with no boost reads as no district, no upgrade target and a boost of 1", () => {
        const { parseBuilding } = layoutModule()
        expect(parseBuilding([265, 9, 0, 0, 0, 0, 0, 100, 0, 100, 0])).toMatchObject({ boost: 1, districtID: 0, upgradeTargetWodID: 0 })
    })

    test("ground, fixed positions, walls, gates and towers each get their own list, empty when the block is missing", () => {
        const { parseCastleLayout } = layoutModule()
        const layout = parseCastleLayout({
            BG: [[200, 1, 0, 0, 0], [201, 2, 20, 0, 0]],
            FP: [[903, 3, 6, 6]],
            G: [[50, 4, 9, 20, 0, 0, 0, 100, 100, 100, 0]],
        })
        expect(layout.grounds).toEqual([castleGround, { wodID: 201, objectID: 2, x: 20, y: 0, rotation: 0 }])
        expect(layout.fixedPositions).toEqual([{ wodID: 903, objectID: 3, x: 6, y: 6, rotation: 0 }])
        expect(layout.gates.map(g => g.wodID)).toEqual([50])
        expect(layout.buildings).toEqual([])
        expect(layout.defences).toEqual([])
        expect(layout.towers).toEqual([])
        expect(parseCastleLayout(undefined).grounds).toEqual([])
    })
})

describe("finding a spot", () => {
    test("the first free spot row by row from the top left", () => {
        const { findSpot, byWod } = layoutModule()
        const layout = { grounds: [castleGround], buildings: [building(265, 0, 0)] }
        expect(findSpot(layout, byWod.get(902))).toEqual({ x: 4, y: 0, r: 0 })
    })

    test("a rotated building takes its turned tiles", () => {
        const { findSpot, byWod } = layoutModule()
        // A 4x6 storehouse turned once covers 6 across and 4 down.
        const layout = { grounds: [castleGround], buildings: [building(265, 0, 0, { rotation: 1 })] }
        expect(findSpot(layout, byWod.get(902))).toEqual({ x: 6, y: 0, r: 0 })
    })

    test("a new building is turned only when its row allows it", () => {
        const { findSpot, byWod } = layoutModule()
        // An expansion piece turned once is 20 across and 10 down: a 3x12 hall fits only lying down.
        const layout = { grounds: [{ wodID: 201, objectID: 1, x: 0, y: 0, rotation: 1 }], buildings: [] }
        expect(findSpot(layout, byWod.get(900))).toEqual({ x: 0, y: 0, r: 1 })
        expect(findSpot(layout, byWod.get(901))).toBeUndefined()
    })

    test("fixed positions block tiles and district buildings don't", () => {
        const { findSpot, byWod } = layoutModule()
        const layout = {
            grounds: [castleGround],
            buildings: [building(265, 0, 0, { districtID: 7 })],
            fixedPositions: [{ wodID: 903, objectID: 2, x: 0, y: 0, rotation: 0 }],
        }
        expect(findSpot(layout, byWod.get(902))).toEqual({ x: 2, y: 0, r: 0 })
    })

    test("no ground or no room gives undefined", () => {
        const { findSpot, byWod } = layoutModule()
        expect(findSpot({ grounds: [], buildings: [] }, byWod.get(902))).toBeUndefined()
        const full = { grounds: [castleGround], buildings: [0, 5, 10, 15].flatMap(y => [0, 5, 10, 15].map(x => building(263, x, y))) }
        expect(findSpot(full, byWod.get(902))).toBeUndefined()
    })
})

describe("expansions", () => {
    test("a lone castle ground offers one spot on each side, each piece turned to lie along it", () => {
        const { expansionSpots } = layoutModule()
        expect(expansionSpots({ grounds: [castleGround] })).toEqual([
            { x: 0, y: -10, r: 3 },
            { x: 0, y: 20, r: 1 },
            { x: -10, y: 0, r: 2 },
            { x: 20, y: 0, r: 0 },
        ])
    })

    test("after an expansion on the right, the right spot moves out past it", () => {
        const { expansionSpots } = layoutModule()
        const spots = expansionSpots({ grounds: [castleGround, { wodID: 201, objectID: 2, x: 20, y: 0, rotation: 0 }] })
        expect(spots).toContainEqual({ x: 30, y: 0, r: 0 })
        expect(spots).not.toContainEqual({ x: 20, y: 0, r: 0 })
        expect(spots).toContainEqual({ x: -10, y: 0, r: 2 })
    })

    test("no castle ground, no spots", () => {
        const { expansionSpots } = layoutModule()
        expect(expansionSpots({ grounds: [{ wodID: 201, objectID: 2, x: 0, y: 0, rotation: 0 }] })).toEqual([])
    })

    test("the limit grows with the player's level and stops at 19", () => {
        const { expansionLimit } = layoutModule()
        expect([1, 2, 5, 12, 21, 45, 46, 70].map(expansionLimit)).toEqual([1, 2, 4, 6, 10, 15, 19, 19])
    })

    test("the cost row is the one for that space and that expansion number", () => {
        const { expansionRow } = layoutModule()
        expect(expansionRow(22, 1)?.expansionID).toBe("74")
        expect(expansionRow(22, 2)?.expansionID).toBe("75")
        expect(expansionRow(0, 1)?.expansionID).toBe("1")
        expect(expansionRow(22, 3)).toBeUndefined()
    })
})

describe("time left", () => {
    const row = (wodID, done, state, boost, target = 0) => [wodID, 1, 0, 0, 0, done, state, 100, boost, 100, 0, 0, 0, 0, 0, target]

    test("a new building's time is its build time over the boost, less what is done", () => {
        const { timeLeft, parseBuilding } = layoutModule()
        expect(timeLeft(parseBuilding(row(263, 200, 2, 150)))).toBe(1000)
        expect(timeLeft(parseBuilding(row(263, 200, 2, 100)))).toBe(1600)
    })

    test("an upgrade runs to the level the game names, else the next level", () => {
        const { timeLeft, parseBuilding } = layoutModule()
        expect(timeLeft(parseBuilding(row(263, 0, 13, 100, 372)))).toBe(6000)
        expect(timeLeft(parseBuilding(row(263, 400, 13, 200)))).toBe(800)
    })

    test("never below zero", () => {
        const { timeLeft, parseBuilding } = layoutModule()
        expect(timeLeft(parseBuilding(row(263, 5000, 2, 100)))).toBe(0)
    })

    test("building states sort into idle and under way", () => {
        const { IDLE_STATES, IN_PROGRESS_STATES, BUILD_IN_PROGRESS, UPGRADE_IN_PROGRESS } = layoutModule()
        expect([...IDLE_STATES].sort((a, b) => a - b)).toEqual([0, 4, 15])
        expect([...IN_PROGRESS_STATES].sort((a, b) => a - b)).toEqual([2, 6, 10, 13])
        expect([BUILD_IN_PROGRESS, UPGRADE_IN_PROGRESS]).toEqual([2, 13])
    })
})
