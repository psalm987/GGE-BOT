import { describe, expect, test } from "vitest"
import { commanderPicks, commanderPositions, writeCommanderPicks } from "../src/index.ts"

describe("a commander list", () => {
    test("reads a list the way the commander pool does", () => {
        expect([...commanderPositions("3-5,1")]).toEqual([3, 4, 5, 1])
        expect(commanderPositions("1-1000000").size).toBe(500)
    })
    test("takes semicolons as well as commas, and ranges with either", () => {
        expect([...commanderPositions("1;2;3")]).toEqual([1, 2, 3])
        expect([...commanderPositions("1-3; 7, 9")]).toEqual([1, 2, 3, 7, 9])
        expect([...commanderPositions("1;;2,")]).toEqual([1, 2])
    })
    test("leaves out what isn't a position or a range", () => {
        expect([...commanderPositions("abc; 9-3")]).toEqual([])
    })
})

describe("a commander list as picked tiles", () => {
    test("picks the tiles in the order the list names them, each once", () => {
        expect(commanderPicks("36;2;5")).toEqual([36, 2, 5])
        expect(commanderPicks("5, 2-4; 3")).toEqual([5, 2, 3, 4])
    })
    test("reads an old range as every tile it covers, up to the 50th", () => {
        expect(commanderPicks("1-50")).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
        expect(commanderPicks("1-99")).toEqual(commanderPicks("1-50"))
        expect(commanderPicks("48-60;0")).toEqual([48, 49, 50])
        expect(commanderPicks("")).toEqual([])
    })
    test("is written back in the picked order", () => {
        expect(writeCommanderPicks([36, 2, 5])).toBe("36;2;5")
        expect(writeCommanderPicks([])).toBe("")
    })
    test("writes a run of three or more in a row as its range, so every tile in order is the default", () => {
        expect(writeCommanderPicks(Array.from({ length: 50 }, (_, i) => i + 1))).toBe("1-50")
        expect(writeCommanderPicks([7, 1, 2, 3, 9, 10])).toBe("7;1-3;9;10")
        expect(writeCommanderPicks([3, 2, 1])).toBe("3;2;1")
    })
    test.each([[[36, 2, 5]], [[1, 2, 3, 4, 50, 49]], [[12]], [Array.from({ length: 50 }, (_, i) => 50 - i)], [[]]])("tiles %j survive a save and a load", picks => {
        expect(commanderPicks(writeCommanderPicks(picks))).toEqual(picks)
    })
    test.each(["1-50", "1;2;3", "1-3; 7, 9", "36;2;5", "4-6"])("an old list %j means the same commanders once saved from the tiles", list => {
        expect([...commanderPositions(writeCommanderPicks(commanderPicks(list)))]).toEqual([...commanderPositions(list)])
    })
})
