import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

// Hand-made rows in the shape of the game's buildings.json and expansions.json, not copied from it.
const shop = (wodID, name, level, rest = {}) => ({ wodID, name, level: String(level), group: "Building", type: "Level1", shopCategory: "CIVIL", width: "5", height: "5", ...rest })
const buildings = [
    { wodID: 200, name: "Castle", width: "20", height: "20" },
    { wodID: 201, name: "Castle", width: "10", height: "20" },
    { wodID: 202, name: "Castle", width: "5", height: "5" },
    shop(110, "Farm", 1, { upgradeWodID: "111", costWood: "30", requiredLevel: "2", buildDuration: "600" }),
    shop(111, "Farm", 2, { upgradeWodID: "112", downgradeWodID: "110", costWood: "100", costStone: "40", requiredLevel: "5", buildDuration: "1200" }),
    shop(112, "Farm", 3, { upgradeWodID: "113", downgradeWodID: "111", costWood: "5000", costStone: "900", requiredLevel: "30", buildDuration: "3600" }),
    shop(113, "Farm", 4, { downgradeWodID: "112", costC2: "500" }),
    shop(300, "Dwelling", 1, { costWood: "20", costStone: "10", rotateType: "1", width: "4", height: "12" }),
    shop(310, "Barracks", 1, { shopCategory: "MILITARY", upgradeWodID: "311", costWood: "50", maximumCount: "1" }),
    shop(311, "Barracks", 2, { shopCategory: "MILITARY", downgradeWodID: "310", costC1: "2000", costWood: "60", maximumCount: "1" }),
    shop(320, "Bakery", 1, { costC2: "900" }),
    shop(321, "Maypole", 1, { costWood: "5", eventIDs: "7" }),
    shop(322, "SkinFarm", 1, { costWood: "5", skinID: "4" }),
    shop(323, "District", 1, { costWood: "5", isDistrict: "1" }),
    shop(324, "Oracle", 1, { costWood: "5", effectLocked: "1" }),
    shop(325, "Statue", 1, { costWood: "5", shopCategory: "DECO" }),
    shop(326, "Freebie", 1, {}),
    shop(330, "Stable", 1, { shopCategory: "MILITARY", costWood: "40", kIDs: "0,1,2,3", maximumCount: "1" }),
    shop(331, "Kingdomhunter", 1, { costWood: "40", kIDs: "1,2,3", onlyInAreaTypes: "12", maximumCount: "1" }),
    shop(340, "Refinery", 1, { costLegendaryToken: "3", requiredLegendLevel: "10", kIDs: "0", maximumCount: "1" }),
    shop(341, "Refinery", 1, { costPlaster: "8", kIDs: "1,2,3", maximumCount: "1" }),
    shop(350, "Tower4", 1, { costWood: "5", width: "4", height: "4" }),
    { wodID: 171, name: "Keep", level: "1", group: "Building", type: "Level1", upgradeWodID: "172", width: "6", height: "6" },
    { wodID: 172, name: "Keep", level: "2", group: "Building", type: "Level1", downgradeWodID: "171", costWood: "400", costStone: "300", requiredLevel: "8", buildDuration: "9000" },
    { wodID: 501, name: "Castlewall", level: "1", group: "Defence", upgradeWodID: "502", costWood: "46" },
    { wodID: 502, name: "Castlewall", level: "2", group: "Defence", downgradeWodID: "501", costWood: "90", costStone: "60" },
    { wodID: 455, name: "Basic", level: "1", group: "Moat", costWood: "13350" },
    { wodID: 450, name: "Basic", level: "1", group: "Gate", upgradeWodID: "451", costWood: "18" },
    { wodID: 451, name: "Basic", level: "2", group: "Gate", downgradeWodID: "450", costWood: "70" },
    { wodID: 401, name: "Guard", level: "0", group: "Tower", upgradeWodID: "402" },
    { wodID: 402, name: "Guard", level: "1", group: "Tower", upgradeWodID: "403", downgradeWodID: "401", costWood: "11" },
    { wodID: 403, name: "Guard", level: "2", group: "Tower", downgradeWodID: "402", costWood: "25", costStone: "9" },
    { wodID: 627, name: "FactionBarracks", level: "1", group: "Building", upgradeWodID: "628", eventIDs: "3", kIDs: "10" },
    { wodID: 628, name: "FactionBarracks", level: "2", group: "Building", downgradeWodID: "627", eventIDs: "3", kIDs: "10", costWood: "2800" },
    shop(700, "FactionDeco", 1, { type: "FactionFlag", shopCategory: "DECO", eventIDs: "3", kIDs: "10", costWood: "788" }),
    shop(701, "FactionDeco", 1, { type: "FactionArmory", shopCategory: "DECO", eventIDs: "3", kIDs: "10", costC2: "990" }),
    shop(702, "FactionHospital", 1, { eventIDs: "3", kIDs: "10", costWood: "5" }),
    { wodID: 950, name: "TreasureChest", group: "Building", width: "2", height: "2" },
]
const expansions = [
    { expansionLevel: "1", spaceIDs: "0,1,2,3", costWood: "100", costStone: "80", costC2: "50" },
    { expansionLevel: "2", spaceIDs: "0,1,2,3", costWood: "9000", costStone: "9000" },
    { expansionLevel: "3", spaceIDs: "0,1,2,3", costWood: "10", costStone: "10", costLegendaryToken: "5" },
]
const lang = { farm_name: "Farmhouse", Dwelling_name: "Dwelling", keep_name: "The Keep", castlewall_name: "Castle wall", guard_tower_name: "Tower", factiondeco_factionflag_name: "Banner" }

const plan = loadModule("buildPlan.js", { items: { buildings, expansions } }).mod

let nextId = 1
const built = (wodID, x = 0, y = 0, rest = {}) => ({ wodID, objectID: nextId++, x, y, rotation: 0, secondsDone: 0, state: 0, hitPoints: 100, boost: 1, efficiency: 100, damageType: 0, districtID: 0, upgradeTargetWodID: 0, ...rest })
const ground = { wodID: 200, objectID: 900, x: 0, y: 0, rotation: 0 }
const castleWith = ({ buildings: list = [], grounds = [ground], slots = [-1, -1], stock = {}, storage = {}, kingdomID = 0, areaType = 1, ...layout } = {}) => ({
    id: 100, kingdomID, areaType, slots,
    layout: { buildings: list, grounds, fixedPositions: [], defences: [], gates: [], towers: [], ...layout },
    stock: { wood: 10_000, stone: 10_000, coal: 0, oil: 0, glass: 0, iron: 0, aqua: 0, ...stock },
    storage: { wood: 50_000, stone: 50_000, ...storage },
})
const context = (rest = {}) => ({
    player: { level: 70, legendLevel: 0 }, coins: 1_000_000, currencies: {}, coinFloor: 0, resourceFloor: 0,
    held: () => false, leftChests: new Set(), skips: true, ...rest,
})
const entry = (building, level = 1, count = 1) => ({ building, level, count })
const castlePlan = (entries, rest = {}) => ({ useSkips: false, buyExpansions: false, entries, ...rest })

describe("the catalog", () => {
    const names = plan.catalogChoices(lang).map(choice => choice.name)

    test("offers shop buildings paid with coins, resources or tracked currencies, and the upgrade-only kinds", () => {
        expect(names).toEqual(expect.arrayContaining(["Farm", "Dwelling", "Barracks", "Stable", "Kingdomhunter", "Refinery", "Keep", "Castlewall", "Moat", "Gate", "Towers", "FactionBarracks", "FactionFlag"]))
    })

    test.each(["Bakery", "Maypole", "SkinFarm", "District", "Oracle", "Statue", "Freebie", "FactionArmory", "FactionHospital", "TreasureChest", "FactionDeco"])(
        "leaves out %s: rubies, an event, a skin, a district, an uncheckable lock, a decoration, no price, or not buildable", name => {
            expect(names).not.toContain(name)
        })

    test("a building's levels stop before the first one that costs rubies", () => {
        const farm = plan.catalogChoices(lang).find(choice => choice.name == "Farm")
        expect(farm).toMatchObject({ maxLevel: 3, maxCount: 0, category: "CIVIL", upgradeOnly: false, nameKey: "farm_name", label: "Farmhouse" })
        expect(farm.requires).toEqual([[2, 0], [5, 0], [30, 0]])
    })

    test("the game's name key is found whatever its case, and a building without one keeps its own name", () => {
        const choices = plan.catalogChoices(lang)
        expect(choices.find(c => c.name == "Dwelling")).toMatchObject({ nameKey: "Dwelling_name", label: "Dwelling" })
        expect(choices.find(c => c.name == "Stable")).toMatchObject({ nameKey: "stable_name", label: "Stable" })
        expect(choices.find(c => c.name == "FactionFlag")).toMatchObject({ nameKey: "factiondeco_factionflag_name", label: "Banner", kingdoms: [10] })
    })

    test("kingdoms and castle types come from every version of a building", () => {
        const choices = plan.catalogChoices(lang)
        expect(choices.find(c => c.name == "Refinery")).toMatchObject({ kingdoms: [0, 1, 2, 3], maxCount: 1 })
        expect(choices.find(c => c.name == "Kingdomhunter")).toMatchObject({ kingdoms: [1, 2, 3], areaTypes: [12] })
    })

    test("upgrade-only kinds are one a castle, towers are all of them, and the castle's own are not Berimond's", () => {
        const choices = plan.catalogChoices(lang)
        expect(choices.find(c => c.name == "Keep")).toMatchObject({ upgradeOnly: true, all: false, maxCount: 1, maxLevel: 2, notKingdoms: [10], nameKey: "keep_name" })
        expect(choices.find(c => c.name == "Towers")).toMatchObject({ upgradeOnly: true, all: true, maxLevel: 2, nameKey: "guard_tower_name", label: "Tower" })
        expect(choices.find(c => c.name == "FactionBarracks")).toMatchObject({ upgradeOnly: true, kingdoms: [10], notKingdoms: [] })
    })

    test("the option carries the choices under its key and starts empty", () => {
        const option = plan.buildPlanOption("plan", lang)
        expect(option).toMatchObject({ type: "BuildPlan", key: "plan", default: [] })
        expect(option.buildings.map(b => b.name)).toEqual(names)
    })
})

describe("reading the saved plan", () => {
    const ref = { kingdom: 0, id: 100 }

    test("keeps each castle's rows and switches", () => {
        const read = plan.readPlan([{ castle: ref, useSkips: true, buyExpansions: false, rows: [{ building: "Farm", level: 3, count: 4 }] }])
        expect(read.castles).toEqual([{ ref, useSkips: true, buyExpansions: false, entries: [{ building: "Farm", level: 3, count: 4 }] }])
        expect(read.dropped).toEqual([])
    })

    test("an upgrade-only kind counts once and a building never past the game's limit", () => {
        const read = plan.readPlan([{ castle: ref, rows: [{ building: "Keep", level: 2, count: 5 }, { building: "Barracks", level: 1, count: 3 }] }])
        expect(read.castles[0].entries).toEqual([{ building: "Keep", level: 2, count: 1 }, { building: "Barracks", level: 1, count: 1 }])
    })

    test.each([
        [{ building: "Bakery", level: 1, count: 1 }],
        [{ building: "Farm", level: 0, count: 1 }],
        [{ building: "Farm", level: 1.5, count: 1 }],
        [{ building: "Farm", level: 1, count: 0 }],
        [null],
    ])("a row the bot can't build is dropped and named: %j", row => {
        const read = plan.readPlan([{ castle: ref, rows: [row, { building: "Farm", level: 1, count: 1 }] }])
        expect(read.castles[0].entries).toEqual([{ building: "Farm", level: 1, count: 1 }])
        expect(read.dropped).toHaveLength(1)
    })

    test("anything that isn't a plan reads as no plan", () => {
        expect(plan.readPlan(undefined)).toEqual({ castles: [], dropped: [] })
        expect(plan.readPlan([{ rows: [] }, "junk"]).castles).toEqual([])
    })

    test("a castle with nothing to do is left out", () => {
        expect(plan.readPlan([{ castle: ref, useSkips: true, rows: [] }]).castles).toEqual([])
        expect(plan.readPlan([{ castle: ref, buyExpansions: true, rows: [] }]).castles).toHaveLength(1)
    })
})

describe("what the game would refuse", () => {
    const row = wod => buildings.find(b => b.wodID == wod)
    const player = { level: 70, legendLevel: 0 }

    test.each([
        ["a level the player hasn't reached", 112, {}, { level: 29, legendLevel: 0 }, "needsLevel"],
        ["a legend level the player hasn't reached", 340, {}, { level: 70, legendLevel: 9 }, "needsLegendLevel"],
        ["another kingdom's building", 330, { kingdomID: 4 }, player, "notInKingdom"],
        ["a castle building in the Berimond camp", 110, { kingdomID: 10 }, player, "notInKingdom"],
        ["another castle type's building", 331, { kingdomID: 1, areaType: 4 }, player, "notInCastleType"],
        ["a ruby price", 113, {}, player, "notPossible"],
        ["a lock the bot can't check", 324, {}, player, "notPossible"],
        ["a row that isn't there", 9999, {}, player, "notPossible"],
    ])("%s", (_name, wod, castle, who, reason) => {
        expect(plan.missingRequirement(row(wod), castleWith(castle), who)).toBe(reason)
    })

    test("nothing is missing when every requirement holds", () => {
        expect(plan.missingRequirement(row(112), castleWith(), { level: 30, legendLevel: 0 })).toBeUndefined()
        expect(plan.missingRequirement(row(331), castleWith({ kingdomID: 2, areaType: 12 }), player)).toBeUndefined()
        expect(plan.missingRequirement(row(628), castleWith({ kingdomID: 10 }), player)).toBeUndefined()
    })

    test("a player level the bot hasn't read yet counts as not reached", () => {
        expect(plan.missingRequirement(row(110), castleWith(), {})).toBe("needsLevel")
    })
})

describe("paying", () => {
    const row = wod => buildings.find(b => b.wodID == wod)

    test("enough of everything is no shortage", () => {
        expect(plan.shortOf(row(111), castleWith(), context())).toBeUndefined()
    })

    test("a resource the castle lacks, coins or a currency the player lacks, all wait", () => {
        expect(plan.shortOf(row(111), castleWith({ stock: { stone: 39 } }), context())).toBe("now")
        expect(plan.shortOf(row(311), castleWith(), context({ coins: 1999 }))).toBe("now")
        expect(plan.shortOf(row(340), castleWith(), context({ currencies: { legendaryToken: 2 } }))).toBe("now")
        expect(plan.shortOf(row(340), castleWith(), context({ currencies: { legendaryToken: NaN } }))).toBe("now")
        expect(plan.shortOf(row(340), castleWith(), context({ currencies: { legendaryToken: 3 } }))).toBeUndefined()
    })

    test("the coin floor and the resource floor are kept", () => {
        expect(plan.shortOf(row(311), castleWith(), context({ coins: 5000, coinFloor: 3001 }))).toBe("now")
        expect(plan.shortOf(row(311), castleWith(), context({ coins: 5000, coinFloor: 3000 }))).toBeUndefined()
        expect(plan.shortOf(row(110), castleWith({ stock: { wood: 1029 } }), context({ resourceFloor: 1000 }))).toBe("now")
        expect(plan.shortOf(row(110), castleWith({ stock: { wood: 1030 } }), context({ resourceFloor: 1000 }))).toBeUndefined()
    })

    test("a coin floor doesn't hold back a building that costs no coins", () => {
        expect(plan.shortOf(row(110), castleWith(), context({ coins: 0, coinFloor: 100_000 }))).toBeUndefined()
    })

    test("a price above what the castle can store, with the floor kept, can never be paid", () => {
        expect(plan.shortOf(row(112), castleWith({ storage: { wood: 4999 } }), context())).toBe("never")
        expect(plan.shortOf(row(112), castleWith({ storage: { wood: 5500 } }), context({ resourceFloor: 1000 }))).toBe("never")
        expect(plan.shortOf(row(112), castleWith({ storage: { wood: NaN }, stock: { wood: 0 } }), context())).toBe("now")
    })
})

describe("the next step for one plan row", () => {
    const step = (e, castle, ctx = context()) => plan.nextStep(e, castle, ctx)

    test("a castle that already has enough at the level is done", () => {
        const castle = castleWith({ buildings: [built(111), built(112), built(110)] })
        expect(step(entry("Farm", 2, 2), castle)).toEqual({ kind: "done" })
    })

    test("the best ones are raised first, one level at a time", () => {
        const low = built(110, 0, 0), high = built(111, 5, 0)
        const castle = castleWith({ buildings: [low, high] })
        expect(step(entry("Farm", 3, 1), castle)).toMatchObject({ kind: "upgrade", building: { objectID: high.objectID }, row: { wodID: 112 }, command: "eup" })
    })

    test("when the ones it has are at the level, a new one is built at level 1 on the first free spot", () => {
        const castle = castleWith({ buildings: [built(111, 0, 0)] })
        expect(step(entry("Farm", 2, 2), castle)).toMatchObject({ kind: "build", row: { wodID: 110 }, spot: { x: 5, y: 0, r: 0 } })
    })

    test("a building that only fits turned is turned when the game lets it turn", () => {
        const strip = { wodID: 201, objectID: 901, x: 0, y: 0, rotation: 1 }
        const castle = castleWith({ grounds: [strip] })
        expect(step(entry("Dwelling", 1, 1), castle)).toMatchObject({ kind: "build", spot: { x: 0, y: 0, r: 1 } })
    })

    test("a building under way, in the queue or damaged is waited for", () => {
        for (const rest of [{ state: 13 }, { damageType: 1 }]) {
            const castle = castleWith({ buildings: [built(110, 0, 0, rest)] })
            expect(step(entry("Farm", 2, 1), castle)).toEqual({ kind: "wait", reason: "busy" })
        }
        const queued = built(110)
        expect(step(entry("Farm", 2, 1), castleWith({ buildings: [queued], slots: [queued.objectID, -1] }))).toEqual({ kind: "wait", reason: "busy" })
    })

    test("too few resources wait, a price over storage blocks, a missing requirement blocks", () => {
        expect(step(entry("Farm", 2, 1), castleWith({ buildings: [built(110)], stock: { wood: 1 } }))).toEqual({ kind: "wait", reason: "resources" })
        expect(step(entry("Farm", 3, 1), castleWith({ buildings: [built(111)], storage: { wood: 100 } }))).toEqual({ kind: "blocked", reason: "overStorage" })
        expect(step(entry("Farm", 3, 1), castleWith({ buildings: [built(111)] }), context({ player: { level: 10, legendLevel: 0 } }))).toEqual({ kind: "blocked", reason: "needsLevel" })
        expect(step(entry("Farm", 4, 1), castleWith({ buildings: [built(112)] }))).toEqual({ kind: "blocked", reason: "notPossible" })
    })

    test("a new building past the game's limit, or with no room, is blocked and says how many there are", () => {
        expect(step(entry("Barracks", 1, 2), castleWith({ buildings: [built(310)] }))).toEqual({ kind: "blocked", reason: "atLimit" })
        const full = castleWith({ buildings: [built(350, 0, 0)], grounds: [{ wodID: 202, objectID: 9, x: 0, y: 0, rotation: 0 }] })
        expect(step(entry("Farm", 1, 1), full)).toEqual({ kind: "blocked", reason: "noSpace", have: 0, want: 1 })
    })

    test("the kingdom's own version of a building is the one built", () => {
        expect(step(entry("Refinery"), castleWith({ kingdomID: 2 }), context({ currencies: { plaster: 8 } }))).toMatchObject({ kind: "build", row: { wodID: 341 } })
        expect(step(entry("Refinery"), castleWith({ kingdomID: 4 }))).toEqual({ kind: "blocked", reason: "notPossible" })
    })

    test("the keep is upgraded and never built", () => {
        expect(step(entry("Keep", 2), castleWith({ buildings: [built(171)] }))).toMatchObject({ kind: "upgrade", row: { wodID: 172 }, command: "eup" })
        expect(step(entry("Keep", 2), castleWith())).toEqual({ kind: "blocked", reason: "upgradeOnlyMissing" })
    })

    test("the wall has its own request and is found among the defences", () => {
        const wall = built(501)
        expect(step(entry("Castlewall", 2), castleWith({ defences: [wall, built(455)] }))).toMatchObject({ kind: "upgrade", building: { objectID: wall.objectID }, command: "eud" })
    })

    test("towers means every tower the castle has built, not its empty tower spots", () => {
        const towers = [built(403), built(402), built(401)]
        const castle = castleWith({ towers })
        expect(step(entry("Towers", 2), castle)).toMatchObject({ kind: "upgrade", building: { objectID: towers[1].objectID }, row: { wodID: 403 } })
        expect(step(entry("Towers", 2), castleWith({ towers: [built(403), built(403), built(401)] }))).toEqual({ kind: "done" })
        expect(step(entry("Towers", 2), castleWith({ towers: [built(401)] }))).toEqual({ kind: "blocked", reason: "upgradeOnlyMissing" })
    })

    test("the castle's own kinds are not for the Berimond camp, and the camp's not for a castle", () => {
        expect(step(entry("Keep", 2), castleWith({ kingdomID: 10, buildings: [built(171)] }))).toEqual({ kind: "blocked", reason: "notInKingdom" })
        expect(step(entry("FactionBarracks", 2), castleWith({ buildings: [built(627)] }))).toEqual({ kind: "blocked", reason: "notInKingdom" })
        expect(step(entry("FactionBarracks", 2), castleWith({ kingdomID: 10, buildings: [built(627)] }))).toMatchObject({ kind: "upgrade", row: { wodID: 628 } })
    })

    test("a Berimond decoration is planned by its kind", () => {
        expect(step(entry("FactionFlag"), castleWith({ kingdomID: 10 }))).toMatchObject({ kind: "build", row: { wodID: 700 } })
        expect(step(entry("FactionFlag"), castleWith({ kingdomID: 10, buildings: [built(700)] }))).toEqual({ kind: "done" })
    })

    test("a district building takes no room on the ground", () => {
        const castle = castleWith({ buildings: [built(350, 0, 0, { districtID: 3 })] })
        expect(step(entry("Farm"), castle)).toMatchObject({ kind: "build", spot: { x: 0, y: 0 } })
    })
})

describe("the next expansion", () => {
    const next = (castle, ctx = context()) => plan.nextExpansion(castle, ctx)

    test("is bought with wood and stone on the first spot the game offers", () => {
        const found = next(castleWith())
        expect(found).toMatchObject({ kind: "expansion", row: { expansionLevel: "1" } })
        expect(found.spot).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), r: expect.any(Number) }))
    })

    test("is done at the player's limit, when the kingdom has none left, or when the next needs what the bot can't check", () => {
        expect(next(castleWith(), context({ player: { level: 1, legendLevel: 0 } }))).toMatchObject({ kind: "expansion" })
        const one = castleWith({ grounds: [ground, { wodID: 201, objectID: 2, x: 20, y: 0, rotation: 0 }] })
        expect(next(one, context({ player: { level: 1, legendLevel: 0 } }))).toEqual({ kind: "done" })
        expect(next(castleWith({ kingdomID: 4 }))).toEqual({ kind: "done" })
        const two = castleWith({ grounds: [ground, { wodID: 201, objectID: 2, x: 20, y: 0, rotation: 0 }, { wodID: 201, objectID: 3, x: 30, y: 0, rotation: 0 }] })
        expect(next(two)).toEqual({ kind: "done" })
        expect(next(castleWith(), context({ player: {} }))).toEqual({ kind: "done" })
    })

    test("waits for wood and stone above the floor, and is blocked when the storehouse can't hold the price", () => {
        expect(next(castleWith({ stock: { stone: 79 } }))).toEqual({ kind: "wait", reason: "resources" })
        expect(next(castleWith({ stock: { wood: 600 } }), context({ resourceFloor: 501 }))).toEqual({ kind: "wait", reason: "resources" })
        const one = castleWith({ grounds: [ground, { wodID: 201, objectID: 2, x: 20, y: 0, rotation: 0 }], storage: { wood: 8000 } })
        expect(next(one)).toEqual({ kind: "blocked", reason: "overStorage" })
    })

    test("a castle whose ground isn't known has no data", () => {
        expect(next(castleWith({ grounds: [] }))).toEqual({ kind: "noData" })
    })
})

describe("one look at a castle", () => {
    const look = (castle, entries, rest = {}, ctx = context()) => plan.lookAt(castle, castlePlan(entries, rest), ctx)

    test("a castle the bot hasn't read has no data", () => {
        expect(plan.lookAt({ id: 1, kingdomID: 0 }, castlePlan([entry("Farm")]), context())).toEqual({ kind: "noData" })
    })

    test("the chest comes first, unless the game refused it before", () => {
        const chest = built(950, 10, 10)
        const castle = castleWith({ buildings: [chest] })
        expect(look(castle, [entry("Farm")])).toEqual({ kind: "chest", building: chest })
        expect(look(castle, [entry("Farm")], {}, context({ leftChests: new Set([chest.objectID]) }))).toMatchObject({ kind: "build" })
    })

    test("then a build under way is skipped where the player ticked skips and skips are left", () => {
        const underWay = built(110, 0, 0, { state: 2, secondsDone: 100 })
        const castle = castleWith({ buildings: [underWay], slots: [underWay.objectID, -1] })
        expect(look(castle, [entry("Farm", 1, 2)], { useSkips: true })).toEqual({ kind: "skip", building: underWay, seconds: 500 })
        expect(look(castle, [entry("Farm", 1, 2)], { useSkips: false })).toMatchObject({ kind: "build" })
        expect(look(castle, [entry("Farm", 1, 2)], { useSkips: true }, context({ skips: false }))).toMatchObject({ kind: "build" })
    })

    test("then an expansion, which takes no queue slot", () => {
        const underWay = built(110, 0, 0, { state: 2 })
        const castle = castleWith({ buildings: [underWay], slots: [underWay.objectID] })
        expect(look(castle, [entry("Farm")], { buyExpansions: true })).toMatchObject({ kind: "expansion" })
        expect(look(castle, [entry("Farm")], { buyExpansions: true }, context({ held: key => key == "expansion" }))).toMatchObject({ kind: "queueFull" })
    })

    test("a full queue waits for its first building to end", () => {
        const a = built(110, 0, 0, { state: 2, secondsDone: 100 }), b = built(111, 5, 0, { state: 13, secondsDone: 0, upgradeTargetWodID: 112 })
        const castle = castleWith({ buildings: [a, b], slots: [a.objectID, b.objectID] })
        expect(look(castle, [entry("Farm", 3, 3)])).toEqual({ kind: "queueFull", seconds: 500 })
        expect(look(castleWith({ slots: [5] }), [entry("Farm")])).toEqual({ kind: "queueFull", seconds: undefined })
    })

    test("the first row that can act acts, and rows before it are noted", () => {
        const castle = castleWith({ buildings: [built(112, 0, 0)] })
        const seen = look(castle, [entry("Farm", 4), entry("Dwelling")])
        expect(seen).toMatchObject({ kind: "build", entry: { building: "Dwelling" }, row: { wodID: 300 } })
    })

    test("a row the game refused is left alone while it is held, and the castle isn't done", () => {
        const castle = castleWith()
        const seen = look(castle, [entry("Farm")], {}, context({ held: key => key == "Farm" }))
        expect(seen).toMatchObject({ kind: "rest", done: false, notes: [{ building: "Farm", state: "held" }] })
    })

    test("when every row is at its level the castle is done", () => {
        const castle = castleWith({ buildings: [built(111)] })
        expect(look(castle, [entry("Farm", 2)])).toEqual({ kind: "rest", done: true, waiting: false, busySeconds: undefined, notes: [] })
    })

    test("a castle waiting on an expansion's resources isn't done", () => {
        const castle = castleWith({ buildings: [built(111)], stock: { wood: 0 } })
        expect(look(castle, [entry("Farm", 2)], { buyExpansions: true })).toMatchObject({ kind: "rest", done: false, waiting: true })
    })

    test("a rest says what each row waits for and when the building under way ends", () => {
        const underWay = built(110, 0, 0, { state: 13, secondsDone: 200 })
        const castle = castleWith({ buildings: [underWay, built(310, 5, 0)], slots: [underWay.objectID, -1], stock: { wood: 0 } })
        const seen = look(castle, [entry("Farm", 2), entry("Barracks", 2), entry("Dwelling")])
        expect(seen).toEqual({
            kind: "rest", done: false, waiting: true, busySeconds: 1000,
            notes: [
                { building: "Farm", state: "busy" },
                { building: "Barracks", state: "waiting", reason: "resources" },
                { building: "Dwelling", state: "waiting", reason: "resources" },
            ],
        })
    })

    test("a blocked row is noted with its reason, and blocks nothing else", () => {
        const castle = castleWith({ buildings: [built(112)] })
        expect(look(castle, [entry("Farm", 4)])).toEqual({
            kind: "rest", done: false, waiting: false, busySeconds: undefined, notes: [{ building: "Farm", state: "blocked", reason: "notPossible" }],
        })
    })

    test("nothing the planner returns has a ruby price", () => {
        const castle = castleWith({ buildings: [built(112)] })
        for (const e of [entry("Farm", 4), entry("Bakery"), entry("FactionArmory")])
            expect(look(castle, [e]).kind).toBe("rest")
    })
})

describe("what Build Supply is told", () => {
    test("the wood and stone the rest of the plan needs: upgrades left, new buildings from level 1, and expansions", () => {
        const castle = castleWith({ buildings: [built(110)] })
        const need = plan.supplyNeed(castle, castlePlan([entry("Farm", 2, 2), entry("Dwelling", 1, 1)], { buyExpansions: true }), context({ player: { level: 5, legendLevel: 0 } }))
        // Farm 110 to level 2 (100, 40), a new Farm through level 2 (30 + 100, 40), a Dwelling (20, 10), expansions 1 and 2.
        expect(need).toEqual({ wood: 100 + 130 + 20 + 100 + 9000, stone: 40 + 40 + 10 + 80 + 9000 })
    })

    test("levels the player can't build yet, or that the castle can't store, don't count", () => {
        const castle = castleWith({ buildings: [built(111)], storage: { wood: 50_000 } })
        expect(plan.supplyNeed(castle, castlePlan([entry("Farm", 3)]), context({ player: { level: 10, legendLevel: 0 } }))).toEqual({ wood: 0, stone: 0 })
        expect(plan.supplyNeed(castle, castlePlan([entry("Farm", 3)]), context())).toEqual({ wood: 5000, stone: 900 })
    })

    test("nothing is payable when every next step costs more wood or stone than the castle has", () => {
        const castle = castleWith({ buildings: [built(111)], stock: { wood: 4000, stone: 5 } })
        expect(plan.nothingPayable(castle, castlePlan([entry("Farm", 3), entry("Dwelling")]), context())).toBe(true)
        expect(plan.nothingPayable(castleWith({ buildings: [built(111)], stock: { wood: 4000 } }), castlePlan([entry("Farm", 3), entry("Dwelling")]), context())).toBe(false)
        expect(plan.nothingPayable(castleWith({ buildings: [built(112)] }), castlePlan([entry("Farm", 3)]), context())).toBe(false)
    })
})

describe("what may leave", () => {
    test("every building request without rubies, and the castle read", () => {
        const allowed = [
            ["jca", { CID: 1, KID: 0 }], ["ebu", { WID: 110, X: 0, Y: 0, R: 0, PWR: 0, PO: -1, DOID: -1 }], ["eup", { OID: 1, PWR: 0, PO: -1 }],
            ["eud", { OID: 1, PWR: 0, PO: -1 }], ["ebe", { X: 0, Y: 0, R: 1, CT: 1 }], ["etc", { OID: 1 }], ["msb", { OID: 1, MST: "MS3" }],
        ]
        for (const [cmd, payload] of allowed)
            expect([cmd, plan.mayLeave(cmd, payload)]).toEqual([cmd, true])
        expect(Object.keys(plan.ALLOWED).sort()).toEqual(allowed.map(([cmd]) => cmd).sort())
    })

    test.each([
        ["ebu", { WID: 110, X: 0, Y: 0, R: 0, PWR: 1, PO: -1, DOID: -1 }], ["ebu", { WID: 110 }], ["eup", { OID: 1, PWR: 1 }], ["eud", { OID: 1 }],
        ["ebe", { X: 0, Y: 0, R: 0, CT: 0 }], ["ebe", { X: 0, Y: 0, R: 0 }], ["msb", { OID: 1, MST: "C2" }], ["bup", {}], ["sbp", {}], ["toString", {}],
    ])("%s %j never leaves", (cmd, payload) => {
        expect(plan.mayLeave(cmd, payload)).toBe(false)
    })
})
