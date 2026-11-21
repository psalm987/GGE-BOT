import { expect, test } from "vitest"
import { ALL_TILES, commanderTiles, toggleTile } from "../src/commander-tiles.ts"

const picked = (list: string) => commanderTiles(list, null).filter(tile => tile.order !== null).sort((a, b) => a.order! - b.order!).map(tile => tile.position)

test("tiles clicked in turn are stored in that order and show it", () => {
    const list = [36, 2, 5].reduce(toggleTile, "")
    expect(list).toBe("36;2;5")
    expect(commanderTiles(list, null).filter(tile => tile.order !== null).map(({ position, order }) => [position, order])).toEqual([[2, 2], [5, 3], [36, 1]])
})

test("a picked tile clicked again leaves the order, and the tiles after it move up", () => {
    const list = toggleTile("36;2;5", 2)
    expect(list).toBe("36;5")
    expect(picked(list)).toEqual([36, 5])
    expect(picked(toggleTile(list, 2))).toEqual([36, 5, 2])
})

test("an old list loads as the tiles it always meant, in its order", () => {
    expect(picked("1-50")).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    expect(picked("1-99")).toEqual(picked("1-50"))
    expect(picked("1;2;3")).toEqual([1, 2, 3])
    expect(picked("4-6, 1")).toEqual([4, 5, 6, 1])
    expect(picked("")).toEqual([])
})

test("every tile in order is the default list", () => {
    expect(ALL_TILES).toBe("1-50")
})

test("tiles past the account's commanders are marked, and none are before the bot has counted", () => {
    expect(commanderTiles("", 18).filter(tile => tile.beyond).map(tile => tile.position)).toEqual(Array.from({ length: 32 }, (_, i) => i + 19))
    expect(commanderTiles("", null).some(tile => tile.beyond)).toBe(false)
    expect(commanderTiles("", 80).some(tile => tile.beyond)).toBe(false)
})
