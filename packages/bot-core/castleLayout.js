/**
 * A castle's ground plan, read the way the game's client reads it. The plan comes in the `gca` block of a castle
 * message: `BD` buildings, `BG` ground pieces, `FP` fixed-position objects, `D` wall and moat, `G` gate and `T` towers.
 * Everything here is pure, so the Build and Blade Coast plugins and the tests share one copy. See
 * docs/protocol/castle-layout.md for the row layout and how sure each part is.
 */
const { loadItem } = require("./paths.js")

const buildings = loadItem("buildings")
const expansions = loadItem("expansions")

/** The game's building rows by wodID. Ground pieces, buildings, walls and towers all live in `buildings.json`. */
const byWod = new Map(buildings.map(row => [Number(row.wodID), row]))

/** The castle's own ground and an expansion piece (the client's ConstructionConst). */
const CASTLE_GROUND = 200, EXPANSION_GROUND = 201

/** Building states, from the client's IsoBuildingStateEnum. 2 and 13 are the two the build time applies to. */
const BUILD_IN_PROGRESS = 2, UPGRADE_IN_PROGRESS = 13
const IDLE_STATES = new Set([0, 4, 15])
const IN_PROGRESS_STATES = new Set([BUILD_IN_PROGRESS, 6, 10, UPGRADE_IN_PROGRESS])

/**
 * @typedef {{ wodID: number, objectID: number, x: number, y: number, rotation: number }} IsoObject
 * @typedef {IsoObject & {
 *   secondsDone: number, state: number, hitPoints: number, boost: number, efficiency: number, damageType: number,
 *   districtID: number, upgradeTargetWodID: number,
 * }} Building
 * `secondsDone` is the time already spent building, not the time left. `boost` is the construction boost the work
 * started with, 1 for none. `districtID` above 0 means the building sits inside a district building, off the grid.
 * `upgradeTargetWodID` is 0 when the game names none.
 * @typedef {{
 *   buildings: Building[], grounds: IsoObject[], fixedPositions: IsoObject[],
 *   defences: Building[], gates: Building[], towers: Building[],
 * }} CastleLayout
 */

/** @returns {IsoObject} */
const parseIsoObject = row => ({
    wodID: Number(row[0]),
    objectID: Number(row[1]),
    x: Number(row[2]),
    y: Number(row[3]),
    rotation: Number(row[4]) || 0,
})

/**
 * A building row: [wodID, objectID, x, y, rotation, secondsDone, state, hp, boost×100, efficiency, damage, …,
 * [14] districtID, [15] upgradeTargetWodID].
 * @returns {Building}
 */
const parseBuilding = row => ({
    ...parseIsoObject(row),
    secondsDone: Number(row[5]) || 0,
    state: Number(row[6]) || 0,
    hitPoints: Number(row[7]) || 0,
    boost: Number(row[8]) > 0 ? Number(row[8]) / 100 : 1,
    efficiency: Number(row[9]) || 0,
    damageType: Number(row[10]) || 0,
    districtID: Number(row[14]) || 0,
    upgradeTargetWodID: Number(row[15]) || 0,
})

const rows = (list, parse) => Array.isArray(list) ? list.map(parse) : []

/** @returns {CastleLayout} */
const parseCastleLayout = gca => ({
    buildings: rows(gca?.BD, parseBuilding),
    grounds: rows(gca?.BG, parseIsoObject),
    fixedPositions: rows(gca?.FP, parseIsoObject),
    defences: rows(gca?.D, parseBuilding),
    gates: rows(gca?.G, parseBuilding),
    towers: rows(gca?.T, parseBuilding),
})

/** A row's tiles as [width, height], swapped on odd rotations (the client's AIsoObjectVO.updateBounds). */
const sizeOf = (row, rotation) => {
    const w = Number(row?.width) || 0, h = Number(row?.height) || 0
    return rotation % 2 == 0 ? [w, h] : [h, w]
}

const tileKey = (x, y) => `${x}:${y}`
const markTiles = (tiles, x, y, w, h) => {
    for (let ty = y; ty < y + h; ty++)
        for (let tx = x; tx < x + w; tx++)
            tiles.add(tileKey(tx, ty))
}
const groundTiles = layout => {
    const tiles = new Set()
    for (const g of layout.grounds ?? [])
        markTiles(tiles, g.x, g.y, ...sizeOf(byWod.get(g.wodID), g.rotation))
    return tiles
}

/**
 * The first place a new `row` fits, scanning row by row from the top left: every tile on ground and none taken (the
 * client's IsoDataGrid.isDimensionFreeForBuild). It tries the turned shape only when the row's `rotateType` allows.
 * District buildings take no tiles.
 * @param {Pick<CastleLayout, "grounds" | "buildings"> & Partial<Pick<CastleLayout, "fixedPositions">>} layout
 * @returns {{ x: number, y: number, r: number } | undefined}
 */
function findSpot(layout, row) {
    const ground = groundTiles(layout), taken = new Set()
    for (const b of [...(layout.buildings ?? []).filter(b => !(b.districtID > 0)), ...(layout.fixedPositions ?? [])])
        markTiles(taken, b.x, b.y, ...sizeOf(byWod.get(b.wodID), b.rotation))
    if (ground.size == 0)
        return undefined
    const coords = [...ground].map(key => key.split(":").map(Number))
    const xs = coords.map(([x]) => x), ys = coords.map(([, y]) => y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const rotations = Number(row?.rotateType) > 0 ? [0, 1] : [0]
    for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++)
            for (const r of rotations) {
                const [w, h] = sizeOf(row, r)
                if (w <= 0 || h <= 0)
                    continue
                let fits = true
                for (let ty = y; fits && ty < y + h; ty++)
                    for (let tx = x; fits && tx < x + w; tx++)
                        fits = ground.has(tileKey(tx, ty)) && !taken.has(tileKey(tx, ty))
                if (fits)
                    return { x, y, r }
            }
    return undefined
}

const EXPANSIONS_TO_EACH_SIDE = 2, MAX_EXPANSIONS = 19

/** How many expansions a player of `level` may own (the client's ConstructionConst). */
const expansionLimit = level => level == 1 ? 1 : level == 2 ? 2 : level < 6 ? level - 1 : level < 13 ? Math.ceil(2 + level / 3) :
    level < 22 ? Math.ceil(level / 2 - 0.5) : level < 46 ? Math.ceil((level - 1) / 4 + 4) : MAX_EXPANSIONS

/**
 * Where the next expansion may go: the arrows the client draws around the ground (IsoDataObjectGroupExpansion).
 * `r` is the expansion's rotation. Empty when the layout has no castle ground.
 * @param {Pick<CastleLayout, "grounds">} layout
 * @returns {{ x: number, y: number, r: number }[]}
 */
function expansionSpots(layout) {
    const start = (layout.grounds ?? []).find(g => g.wodID == CASTLE_GROUND)
    if (!start)
        return []
    const [ew, eh] = sizeOf(byWod.get(EXPANSION_GROUND), 0), [sw] = sizeOf(byWod.get(CASTLE_GROUND), 0)
    const ground = groundTiles(layout)
    const on = (x, y) => ground.has(tileKey(x, y))
    const fromX = start.x - EXPANSIONS_TO_EACH_SIDE * ew, fromY = start.y - EXPANSIONS_TO_EACH_SIDE * ew
    const toX = start.x + sw + EXPANSIONS_TO_EACH_SIDE * ew + (layout.grounds.length >= 17 ? ew : 0)
    // The client works the last row out from x as well, so this keeps its quirk.
    const toY = start.x + sw + EXPANSIONS_TO_EACH_SIDE * ew
    const spots = []
    for (let x = fromX; x < toX; x += eh)
        for (let y = fromY; y < toY; y += ew) {
            if (on(x, y))
                continue
            const m = on(x, y - 1), f = on(x + eh - 1, y - 1), e = on(x, y + ew + 1), o = on(x + eh - 1, y + ew + 1)
            if (m && f && !e && !o) spots.push({ x, y, r: 1 })
            else if ((!m && !f && e && o) || (m && f && e && o)) spots.push({ x, y, r: 3 })
        }
    for (let y = fromY; y < toY; y += eh)
        for (let x = fromX; x < toX; x += ew) {
            if (on(x, y))
                continue
            const m = on(x - 1, y), f = on(x - 1, y + eh - 1), o = on(x + ew + 1, y), e = on(x + ew + 1, y + eh - 1)
            if (m && f && !e && !o) spots.push({ x, y, r: 0 })
            else if ((!m && !f && e && o) || (m && f && e && o)) spots.push({ x, y, r: 2 })
        }
    return spots
}

/** The `expansions.json` row for the `number`th expansion in `spaceID` (a kingdom, or a Blade Coast map). */
const expansionRow = (spaceID, number) => expansions.find(e => Number(e.expansionLevel) == number &&
    String(e.spaceIDs ?? "").split(",").map(Number).includes(Number(spaceID)))

/**
 * Seconds left on a building under way (the client's ABasicBuildingVO.getTimeLeftForBuilding): the build time of what
 * it becomes, divided by the boost it started with, minus the seconds already done. An upgrade becomes the row the game
 * names in [15], else the row's next level.
 * @param {Pick<Building, "wodID" | "state" | "secondsDone" | "boost" | "upgradeTargetWodID">} building
 */
function timeLeft(building) {
    const row = byWod.get(building.wodID)
    const target = building.state == UPGRADE_IN_PROGRESS ?
        byWod.get(building.upgradeTargetWodID > 0 ? building.upgradeTargetWodID : Number(row?.upgradeWodID)) : row
    const duration = Number(target?.buildDuration) || 0
    return Math.max(0, Math.floor(duration / (building.boost > 0 ? building.boost : 1)) - building.secondsDone)
}

module.exports = {
    byWod,
    CASTLE_GROUND,
    EXPANSION_GROUND,
    BUILD_IN_PROGRESS,
    UPGRADE_IN_PROGRESS,
    IDLE_STATES,
    IN_PROGRESS_STATES,
    parseBuilding,
    parseIsoObject,
    parseCastleLayout,
    sizeOf,
    findSpot,
    expansionLimit,
    expansionSpots,
    expansionRow,
    timeLeft,
}
