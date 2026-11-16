const mapGrid = Boolean(require("./config.js").humanize?.map_grid)

const MAP_MAX = 1286
/** The game client asks for the map in boxes this many tiles wide and tall. */
const BOX = 13
/**
 * How many boxes out from the castle's own box a grid scan looks: 7×7 boxes,
 * 49 requests at most, reaching 39 to 51 tiles from the castle.
 */
const SCAN_RADIUS = 3
/** A grid scan stops once it has this many targets. */
const SCAN_TARGETS = 30

function spiralCoordinates(n) {
    if (n === 0) return { x: 0, y: 0 }

    const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2)
    const layerStart = (2 * (k - 1) + 1) ** 2
    const offset = n - layerStart
    const sideLength = 2 * k
    const side = Math.floor(offset / sideLength)
    const posInSide = offset % sideLength

    let x, y

    switch (side) {
        case 0:
            x = k
            y = -k + 1 + posInSide
            break
        case 1:
            x = k - 1 - posInSide
            y = k
            break
        case 2:
            x = -k
            y = k - 1 - posInSide
            break
        case 3:
            x = -k + 1 + posInSide
            y = -k
            break
    }

    return { x, y }
}

/** The whole-map walk: up to 169 rectangles 101 tiles wide, 100 apart, spiralling out from (cx, cy). */
function* wholeMapRects(cx, cy) {
    const onMap = v => Math.min(MAP_MAX, Math.max(0, v))
    for (let i = 0, j = 0; i < 13 * 13; i++) {
        let x, y
        do {
            const step = spiralCoordinates(j++)
            x = cx + step.x * 100
            y = cy + step.y * 100
            if (j > Math.pow(13 * 13, 2))
                return
        } while (x <= -50 || y <= -50 || x >= MAP_MAX + 50 || y >= MAP_MAX + 50)
        yield { x: onMap(x - 50), y: onMap(y - 50), w: onMap(x + 50), h: onMap(y + 50) }
    }
}

/** The grid boxes within `radius` boxes of the one holding (cx, cy), nearest first. */
function* gridBoxes(cx, cy, radius = SCAN_RADIUS) {
    const last = Math.floor(MAP_MAX / BOX)
    for (let n = 0; n < (2 * radius + 1) ** 2; n++) {
        const step = spiralCoordinates(n)
        const column = Math.floor(cx / BOX) + step.x
        const row = Math.floor(cy / BOX) + step.y
        if (column < 0 || row < 0 || column > last || row > last)
            continue
        yield {
            x: column * BOX,
            y: row * BOX,
            w: Math.min(column * BOX + BOX - 1, MAP_MAX),
            h: Math.min(row * BOX + BOX - 1, MAP_MAX),
        }
    }
}

let turn = Promise.resolve()
// The reply for an empty box names no tile, so it can only belong to the one
// request in flight. Waiting also lets a second plugin scanning the same boxes
// find them in the cache instead of asking again.
function inTurn(task) {
    const result = turn.then(task)
    turn = result.catch(() => {})
    return result
}

/** The wanted areas in the grid boxes around `centre`, nearest box first, stopping once `stopAfter` are found. */
async function scanGrid(getAreaInfo, kingdomID, centre, wanted, { radius = SCAN_RADIUS, stopAfter = SCAN_TARGETS } = {}) {
    const found = []
    for (const box of gridBoxes(centre.x, centre.y, radius)) {
        const { areaInfo } = await inTurn(() => getAreaInfo(kingdomID, box.x, box.y, box.w, box.h, true, true))
        found.push(...(areaInfo ?? []).filter(wanted))
        if (found.length >= stopAfter)
            break
    }
    if (found.length == 0)
        console.warn("mapGridFoundNothing")
    return found
}

/**
 * The wanted areas within 50 tiles of `centre`, from one request. With
 * map_grid on they come from a grid scan instead, unless it finds none.
 */
async function areasAround(getAreaInfo, kingdomID, centre, wanted) {
    const found = mapGrid ? await scanGrid(getAreaInfo, kingdomID, centre, wanted) : []
    if (found.length > 0)
        return found
    return (await getAreaInfo(kingdomID, centre.x - 50, centre.y - 50, centre.x + 50, centre.y + 50)).areaInfo.filter(wanted)
}

module.exports = { mapGrid, spiralCoordinates, wholeMapRects, gridBoxes, scanGrid, areasAround, BOX, SCAN_RADIUS, SCAN_TARGETS }
