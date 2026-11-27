import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"
import { BladeCoastStatus } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")
const plan = require("../bladeCoastPlan.js")

// Hand-made rows in the shape of the game's tmaps, tmapnodes, partpayprices, units and buildings, not copied from them.
// Map 22: islands 1 → 2 → 4 → Kraken 5 on the main path, a longer side way 1 → 3 → 7 → 8 → 5, and port 6 after island 1.
const tmaps = [{ mapID: "22", tmapnodeIDs: "1+2+3+4+5+6+7+8", endNodeID: "5" }]
const tmapnodes = [
    { tmapnodeID: "1", type: "DUNGEON", dungeonType: "main", pos: "1", dungeonlevel: "5" },
    { tmapnodeID: "2", type: "DUNGEON", dungeonType: "main", pos: "2", dungeonlevel: "10", orUnlockIDs: "1" },
    { tmapnodeID: "3", type: "DUNGEON", dungeonType: "side", pos: "3", dungeonlevel: "8", orUnlockIDs: "1" },
    { tmapnodeID: "4", type: "BRIDGEDUNGEON", pos: "4", dungeonlevel: "15", orUnlockIDs: "2" },
    { tmapnodeID: "5", type: "BOSSDUNGEON", dungeonType: "main", pos: "9", dungeonlevel: "20", orUnlockIDs: "4+8" },
    { tmapnodeID: "6", type: "PORT", orUnlockIDs: "1", partPayPriceID: "70" },
    { tmapnodeID: "7", type: "DUNGEON", dungeonType: "side", pos: "5", dungeonlevel: "9", orUnlockIDs: "3" },
    { tmapnodeID: "8", type: "DUNGEON", dungeonType: "side", pos: "6", dungeonlevel: "9", orUnlockIDs: "7", andUnlockIDs: "6" },
]
const partpay = [{ partPayPriceID: "70", wood: "20000", stone: "15000" }]
const map = plan.coastMap(22, tmaps, tmapnodes)

const units = [
    { wodID: 1, type: "Corsair", role: "melee", level: "1", kingdomTravellingCost: "40" },
    { wodID: 2, type: "Corsair", role: "melee", level: "2", kingdomTravellingCost: "40" },
    { wodID: 3, type: "Bowman", role: "ranged", kingdomTravellingCost: "20" },
    { wodID: 20, type: "Ladder" }, { wodID: 21, type: "Ram" }, { wodID: 22, type: "Mantlet" },
]
const unitByWod = new Map(units.map(u => [u.wodID, u]))
/** Corsairs, a ladder for the wall (front and flank), a ram for the gate (front) and a mantlet for ranged defence (flank). */
const loadout = {
    troopWods: [2, 1],
    tools: [{ role: "wall", wods: [20], slots: ["front", "flank"] }, { role: "gate", wods: [21], slots: ["front"] }, { role: "ranged", wods: [22], slots: ["flank"] }],
}

/** A `tmp` map entry: a camp with 10 storehouses, full space and morale on map 22, unless told otherwise. */
const entry = ({ S = {}, ...rest } = {}) => ({
    MID: 22, M: 350, I: [], N: [],
    S: { MU: 350, U: 0, W: 50_000, S: 50_000, F: 50_000, MRW: 78_000, MRS: 78_000, MRF: 78_000, ...S }, ...rest,
})
const camp = (over = {}) => plan.readCamp(entry(over))
const won = (...nids) => nids.map(NID => ({ NID, A: 1 }))

describe("the map and the camp as the game sends them", () => {
    test("a map's islands are every dungeon type, ports apart, and its Kraken is the end node", () => {
        expect(map.islands.map(n => n.id)).toEqual([1, 2, 3, 4, 5, 7, 8])
        expect(map.ports.map(n => n.id)).toEqual([6])
        expect(map.end).toBe(5)
        expect(map.islands.find(n => n.id == 5)).toMatchObject({ level: 20, or: [4, 8], main: true })
    })

    test("a map the player hasn't joined has no camp", () => {
        expect(plan.readCamp({ MID: 22 })).toBeUndefined()
        expect(plan.readCamp(undefined)).toBeUndefined()
    })

    test("the camp reads its goods, inventory, trips, won islands, cooldowns and what a port has been paid", () => {
        const read = camp({
            S: { U: 320 }, I: [[1, 300], [20, 40]], UT: { RS: 90, I: [[1, 20]] }, RT: { RS: 0 },
            N: [{ NID: 1, A: 1 }, { NID: 2, CD: 600 }, { NID: 6, G: [["W", 5000]] }],
        })
        expect(read).toMatchObject({ space: 350, soldiersCounted: 320, morale: 350, maxWood: 78_000 })
        expect(read.inventory).toEqual(new Map([[1, 300], [20, 40]]))
        expect(read.troopTrip).toEqual({ seconds: 90, units: [[1, 20]] })
        expect(read.goodsTrip.seconds).toBe(0)
        expect([...read.won]).toEqual([1])
        expect(read.cooldowns).toEqual(new Map([[2, 600]]))
        expect(read.paid.get(6)).toEqual(new Map([["W", 5000]]))
        expect(plan.soldiersIn(read.inventory, unitByWod)).toBe(300)
    })
})

describe("what the camp builds next", () => {
    test("storehouses first, to ten (read from the wood storage), then tents to the space, then morale", () => {
        expect(plan.campNeed(camp({ S: { MRW: 3000 + 9 * 7500 } }), 22)).toBe("storage")
        expect(plan.campNeed(camp({ S: { MU: 340 } }), 22)).toBe("tent")
        expect(plan.campNeed(camp({ M: 100 }), 22)).toBe("decoration")
        expect(plan.campNeed(camp(), 22)).toBeUndefined()
        expect(plan.campNeed(camp(), 27)).toBe("tent")
    })

    // Hand-made building rows: a 10×10 camp ground, 4×4 storehouses, 5×5 tents and 3×3 decorations.
    const buildings = [
        { wodID: 200, name: "Castle", width: "10", height: "10" },
        { wodID: 201, name: "Castle", width: "5", height: "10" },
        { wodID: 265, name: "Storage", width: "4", height: "4", costWood: "500", costStone: "400" },
        { wodID: 263, name: "Unittent", level: "1", width: "5", height: "5", upgradeWodID: "264", buildDuration: "600" },
        { wodID: 264, name: "Unittent", level: "2", width: "5", height: "5", upgradeWodID: "266", costWood: "900" },
        { wodID: 266, name: "Unittent", level: "3", width: "5", height: "5", costC2: "50" },
        { wodID: 330, name: "Deco", type: "TrainingGround", width: "3", height: "3", costC2: "30" },
        { wodID: 329, name: "Deco", type: "Flag", width: "3", height: "3", costWood: "100" },
        { wodID: 400, name: "TreasureChest", width: "1", height: "1" },
    ]
    const expansions = [{ spaceIDs: "22,27,28", expansionLevel: "1", costWood: "511", costStone: "510" }]
    const kit = loadModule("castleLayout.js", { items: { buildings, expansions } }).mod
    const ground = [{ wodID: 200, objectID: 1, x: 0, y: 0, rotation: 0 }]
    const at = (wodID, objectID, x, y, state = 0) => ({ wodID, objectID, x, y, rotation: 0, state, secondsDone: 0, boost: 1, districtID: 0, upgradeTargetWodID: 0 })
    const layout = buildings => ({ grounds: ground, buildings, fixedPositions: [] })

    test("a treasure chest is collected first, unless the game refused it before", () => {
        const withChest = layout([at(400, 9, 0, 0), at(265, 2, 5, 5, 2)])
        expect(plan.campStep("storage", withChest, 22, kit)).toMatchObject({ kind: "chest", building: { objectID: 9 } })
        expect(plan.campStep("storage", withChest, 22, kit, new Set([9]))).toMatchObject({ kind: "busy", building: { objectID: 2 } })
    })

    test("a new building goes on the first free spot", () => {
        expect(plan.campStep("storage", layout([at(265, 2, 0, 0)]), 22, kit)).toMatchObject({ kind: "build", row: { wodID: 265 }, spot: { x: 4, y: 0 } })
    })

    test("with no room for a new tent the lowest idle tent goes a level up, and a ruby-priced level never", () => {
        const full = layout([at(263, 1, 0, 0), at(264, 2, 5, 0), at(263, 3, 0, 5, 13), at(264, 4, 5, 5)])
        expect(plan.campStep("tent", { ...full, buildings: full.buildings.map(b => ({ ...b, state: 0 })) }, 22, kit))
            .toMatchObject({ kind: "upgrade", building: { objectID: 1 }, row: { wodID: 264 } })
        const allLevel2 = layout([at(264, 1, 0, 0), at(264, 2, 5, 0), at(264, 3, 0, 5), at(264, 4, 5, 5)])
        expect(plan.campStep("tent", allLevel2, 22, kit)).toMatchObject({ kind: "expansion", row: { expansionLevel: "1" } })
    })

    test("decorations skip a ruby-priced one, and a full camp with no expansion left has no room", () => {
        expect(plan.campStep("decoration", layout([]), 22, kit)).toMatchObject({ kind: "build", row: { wodID: 329 } })
        const full = layout([at(264, 1, 0, 0), at(264, 2, 5, 0), at(264, 3, 0, 5), at(264, 4, 5, 5), at(264, 6, 10, 0), at(264, 7, 10, 5)])
        expect(plan.campStep("decoration", { ...full, grounds: [...ground, { wodID: 201, objectID: 5, x: 10, y: 0, rotation: 0 }] }, 22, kit))
            .toEqual({ kind: "noRoom" })
    })
})

describe("which island is next", () => {
    test("only the start island at first; once it is won the main path before a side island", () => {
        expect(plan.attackable(map, camp(), false).map(n => n.id)).toEqual([1])
        expect(plan.attackable(map, camp({ N: won(1) }), false).map(n => n.id)).toEqual([2, 3])
    })

    test("a cooling island is waited for, and one with a port still to pay stays locked", () => {
        expect(plan.attackable(map, camp({ N: [...won(1), { NID: 2, CD: 300 }] }), false).map(n => n.id)).toEqual([3])
        expect(plan.attackable(map, camp({ N: won(1, 3, 7) }), false).map(n => n.id)).toEqual([2])
        expect(plan.attackable(map, camp({ N: won(1, 3, 7, 6) }), false).map(n => n.id)).toEqual([2, 8])
    })

    test("the shortest route leaves out the side way, and counts what is still to win with the Kraken", () => {
        expect(plan.attackable(map, camp({ N: won(1) }), true).map(n => n.id)).toEqual([2])
        expect(plan.shortestRoute(map, camp())).toEqual({ nodes: new Set([1, 2, 4, 5]), left: 4 })
        expect(plan.shortestRoute(map, camp({ N: won(1, 3, 7, 6, 8) })).left).toBe(1)
    })

    test("the next port opens after its island and costs what is left of its price", () => {
        expect(plan.nextPort(map, camp(), partpay)).toBeUndefined()
        expect(plan.nextPort(map, camp({ N: [...won(1), { NID: 6, G: [["W", 5000]] }] }), partpay)).toMatchObject({ port: { id: 6 }, wood: 15_000, stone: 15_000 })
        expect(plan.nextPort(map, camp({ N: won(1, 6) }), partpay)).toBeUndefined()
    })
})

describe("troop and tool amounts", () => {
    test("one attack's tools: a flank's open slot takes the wall tool, the front's the gate tool, more slots open with the level", () => {
        expect(plan.toolsForIsland(5, loadout.tools)).toEqual([20, 10, 0])
        expect(plan.toolsForIsland(40, loadout.tools)).toEqual([35, 15, 20])
    })

    test("waves: one per player-level band, the chosen troop first, only open slots filled, tools in the first wave only", () => {
        const inventory = new Map([[3, 500], [1, 50], [2, 200], [20, 100], [21, 100], [22, 100]])
        const waves = plan.buildWaves(5, inventory, loadout, { playerLevel: 30, unitByWod })
        expect(waves).toHaveLength(3)
        expect(waves[0]).toEqual({
            L: { T: [[20, 10], [-1, 0]], U: [[2, 7], [-1, 0]] },
            R: { T: [[20, 10], [-1, 0]], U: [[2, 7], [-1, 0]] },
            M: { T: [[21, 10], [-1, 0], [-1, 0]], U: [[2, 19], [-1, 0], [-1, 0], [-1, 0], [-1, 0], [-1, 0]] },
        })
        expect(waves[1].L.T).toEqual([[-1, 0], [-1, 0]])
        expect(plan.buildWaves(5, inventory, loadout, { playerLevel: 51, unitByWod })).toHaveLength(4)
        expect(plan.buildWaves(5, inventory, loadout, { playerLevel: 12, unitByWod })).toHaveLength(1)
    })

    const refill = over => plan.refillPlan({ camp: camp(), mid: 22, soldiers: 0, toolsHave: [100, 100, 100], toolsNeeded: [20, 10, 0], firstLot: true, ...over })

    test("below the minimum the camp is filled to all places but one; at the minimum nothing goes", () => {
        expect(refill({ camp: camp({ S: { U: 100 } }), soldiers: 100 })).toEqual({ short: true, soldiers: 249, campFull: false, tools: [0, 0, 0], atLeast: [0, 0, 0] })
        expect(refill({ camp: camp({ S: { U: 300 } }), soldiers: 300 })).toEqual({ short: false })
    })

    test("short of tools: one soldier goes with a lot of each, 1,000 the first time and 500 after, never under the shortfall", () => {
        expect(refill({ camp: camp({ S: { U: 300 } }), soldiers: 300, toolsHave: [5, 100, 100] }))
            .toEqual({ short: true, soldiers: 1, campFull: false, tools: [1000, 1000, 1000], atLeast: [15, 0, 0] })
        expect(refill({ camp: camp({ S: { U: 300 } }), soldiers: 300, toolsHave: [5, 100, 100], firstLot: false }).tools).toEqual([500, 500, 500])
    })

    test("short of tools in a full camp: nothing goes until a battle frees a place", () => {
        expect(refill({ camp: camp({ S: { U: 350 } }), soldiers: 350, toolsHave: [5, 100, 100] }))
            .toEqual({ short: true, soldiers: 0, campFull: true, tools: [0, 0, 0], atLeast: [0, 0, 0] })
    })

    test("a load takes the best level first, all of a kind or none, and a tool goes up to its lot or what the castle has", () => {
        const castle = new Map([[2, 150], [1, 200], [20, 600], [21, 5]])
        const held = wods => wods.filter(w => castle.has(w)).map(w => [w, castle.get(w)])
        const trip = plan.loadTrip({ soldiers: 249, tools: [1000, 1000, 1000], atLeast: [15, 10, 0] }, loadout, held)
        expect(trip.I).toEqual([[2, 150], [1, 99], [20, 600]])
        expect(trip.short).toEqual([{ tool: 10, wod: 21 }])
        expect(plan.loadTrip({ soldiers: 400, tools: [0, 0, 0], atLeast: [0, 0, 0] }, loadout, held)).toEqual({ I: [], short: [{ troops: 400 }] })
    })

    test("the travel fee is half the kingdom fee per soldier and 50 per tool", () => {
        expect(plan.travelFee([[1, 100], [3, 10], [20, 30]], unitByWod)).toBe(100 * 20 + 10 * 10 + 30 * 50)
    })
})

describe("goods for the camp", () => {
    const castle = (id, goods, max = 100_000) => ({ id, kingdomID: 0, ...goods, getProductionData: { maxAmountWood: max, maxAmountStone: max, maxAmountFood: max } })

    test("nothing while the camp has half its wood and stone and 30% food", () => {
        expect(plan.goodsPlan(camp({ S: { W: 40_000, S: 40_000, F: 30_000 } }), [castle(1, { wood: 1e6, stone: 1e6, food: 1e6 })])).toBeUndefined()
    })

    test("fills the storage counting the quarter lost at sea, from the supply castle when it can give it all", () => {
        const low = camp({ S: { W: 18_000, S: 78_000, F: 78_000 } })
        const trip = plan.goodsPlan(low, [castle(1, { wood: 200_000, stone: 0, food: 0 }), castle(2, { wood: 500_000, stone: 0, food: 0 })])
        expect(trip).toEqual({ castle: expect.objectContaining({ id: 1 }), G: [["W", 80_000]] })
    })

    test("else the castle that can give the most, keeping a quarter of its storage; too little to bother goes nowhere", () => {
        const low = camp({ S: { W: 0, S: 0, F: 0 } })
        expect(plan.goodsPlan(low, [castle(1, { wood: 30_000, stone: 0, food: 0 }), castle(2, { wood: 60_000, stone: 60_000, food: 0 })]))
            .toEqual({ castle: expect.objectContaining({ id: 2 }), G: [["W", 35_000], ["S", 35_000]] })
        expect(plan.goodsPlan(low, [castle(1, { wood: 25_500, stone: 0, food: 0 })])).toEqual({ castle: undefined })
    })

    test("food alone when nothing else needs goods", () => {
        const low = camp({ S: { W: 0, S: 0, F: 10_000 } })
        expect(plan.goodsPlan(low, [castle(1, { wood: 1e6, stone: 1e6, food: 1e6 }, 1e6)], { foodOnly: true })).toMatchObject({ G: [["F", 90_667]] })
    })
})

describe("what may leave", () => {
    test("the requests the plugin uses, paid with resources, coins or skips", () => {
        for (const [cmd, payload] of [
            ["tmp", { MID: 22 }], ["csc", { ID: 29, PWR: 0, OC2: 0, SID: 22 }], ["sje", { MID: 22 }], ["jea", { MID: 22 }],
            ["ebu", { WID: 265, X: 0, Y: 0, R: 0, PWR: 0, PO: -1, DOID: -1 }], ["eup", { OID: 1, PWR: 0, PO: -1 }], ["ebe", { X: 0, Y: 0, R: 1, CT: 1 }],
            ["msb", { OID: 1, MST: "MS3" }], ["etc", { OID: 1 }], ["tut", { MID: 22, SCID: 1, KID: 0, I: [[1, 2]] }], ["tgt", { MID: 22, SCID: 1, KID: 0, G: [["W", 1000]] }],
            ["msm", { MID: 22, TT: 2, MST: "MS1" }], ["ule", { SCID: -1, SKID: 0, W: 1, S: 1, F: 0, C1: 0, IID: 70, SC: 0 }],
            ["tai", { MID: 22, NID: 1 }], ["gas", {}], ["thm", { LID: -12, BT: 2, BPC: 0, MID: 22, NID: 1, PTT: 0, A: [] }], ["tfm", { MID: 22 }],
        ])
            expect([cmd, plan.mayLeave(cmd, payload)]).toEqual([cmd, true])
    })

    test("never rubies, a travel boost, a cooldown skip or a request it doesn't know", () => {
        for (const [cmd, payload] of [
            ["csc", { ID: 29, PWR: 1, OC2: 0, SID: 22 }], ["csc", { ID: 29, PWR: 0, OC2: 1, SID: 22 }], ["csc", { ID: 29, SID: 22 }],
            ["ebu", { WID: 265, PWR: 1 }], ["eup", { OID: 1, PWR: 1 }], ["ebe", { CT: 0 }], ["msb", { OID: 1, MST: "C2" }],
            ["ule", { SCID: -1, W: 1, S: 1, F: 0, C1: 0, IID: 70, SC: 1 }], ["thm", { LID: -12, BT: 1, BPC: 0, PTT: 0 }], ["thm", { LID: 5, BT: 2, BPC: 0, PTT: 0 }],
            ["msm", { MID: 22, TT: 3, MST: "MS1" }], ["sje", { MID: 22, BT: 1 }], ["tkt", {}], ["sdc", {}], ["xyz", {}],
        ])
            expect([cmd, payload, plan.mayLeave(cmd, payload)]).toEqual([cmd, payload, false])
    })
})

describe("morale and the Live view", () => {
    test("morale's battle bonus as the game works it out", () => {
        expect(plan.moraleBonus(0)).toBe(100)
        expect(plan.moraleBonus(250)).toBe(150)
        expect(plan.moraleBonus(-250)).toBe(50)
    })

    test("the phase follows the camp: storehouses, tents, morale, filling, attacking, an attack out, map done", () => {
        const phase = (c, over = {}) => plan.phaseOf({ mid: 22, map, camp: c, loadout, stopped: false, shortest: false, unitByWod, ...over })
        expect(phase(camp({ S: { MRW: 3000 } }))).toBe("storehouses")
        expect(phase(camp({ S: { MU: 300 } }))).toBe("tents")
        expect(phase(camp({ M: 0 }))).toBe("morale")
        expect(phase(camp({ I: [[1, 100]] }))).toBe("filling")
        expect(phase(camp({ I: [[1, 300], [20, 20], [21, 10]] }))).toBe("attacking")
        expect(phase(camp(), { attackOut: { kraken: true } })).toBe("krakenAttackOut")
        expect(phase(camp({ N: won(5) }))).toBe("mapDone")
        expect(phase(camp(), { stopped: true })).toBe("stopped")
    })

    test("the status is a BladeCoastStatus the runner accepts", () => {
        const c = camp({ S: { U: 320 }, M: 250, N: won(1, 6), UT: { RS: 60, I: [[1, 20], [20, 5]] }, RT: { RS: 30, G: [["W", 1000]] } })
        const attackOut = { island: 2, level: 10, kraken: false, sentAt: 1_800_000_000_000, endsAt: 1_800_000_300_000 }
        const status = plan.statusOf({ mid: 22, map, camp: c, phase: "attackOut", attackOut, shortest: false, now: 1_800_000_000_000 })
        expect(BladeCoastStatus.parse(status)).toEqual(status)
        expect(status).toMatchObject({
            camp: { soldiers: 320, storehouses: 10, storehousesTarget: 10, spaceTarget: 350 },
            morale: { value: 250, bonus: 150, target: 350 }, warship: { level: 2, max: 2 },
            islands: { won: 1, total: 6, krakenWon: false }, nextIsland: { id: 2, level: 10, kraken: false },
            trips: [{ kind: "attack", island: 2 }, { kind: "troops", amount: 25, endsAt: 1_800_000_060_000 }, { kind: "goods", endsAt: 1_800_000_030_000 }],
        })
        expect(plan.statusOf({ mid: 22, map, camp: c, phase: "attacking", shortest: true }).islands).toEqual({ won: 1, total: 3, krakenWon: false })
    })
})
