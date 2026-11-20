import { describe, expect, test } from "vitest"
import { commanderPositions, commanderUsage, readCommanderList } from "../src/index.ts"

describe("reading a commander list", () => {
    test("reads a list the way the commander pool does", () => {
        expect([...commanderPositions("3-5,1")]).toEqual([3, 4, 5, 1])
        expect(commanderPositions("1-1000000").size).toBe(500)
    })
})

describe("a commander list", () => {
    test("takes semicolons as well as commas, and ranges with either", () => {
        expect([...commanderPositions("1;2;3")]).toEqual([1, 2, 3])
        expect([...commanderPositions("1-3; 7, 9")]).toEqual([1, 2, 3, 7, 9])
        expect([...commanderPositions("1;;2,")]).toEqual([1, 2])
    })
    test("names the positions written out and the first of each range", () => {
        expect(readCommanderList("1-99; 19, 4-6").named).toEqual([1, 19, 4])
        expect(readCommanderList("abc; 9-3").named).toEqual([])
    })
})

describe("how the kingdoms use the account's commanders between them", () => {
    test("counts each commander once, against the account's count", () => {
        expect(commanderUsage(["1-6", "5;6;7"], 18)).toEqual({ configured: 7, max: 18, remaining: 11 })
        expect(commanderUsage(["1-99"], 18)).toEqual({ configured: 18, max: 18, remaining: 0 })
        expect(commanderUsage([], 18)).toEqual({ configured: 0, max: 18, remaining: 18 })
    })
    test("has no maximum until the bot has counted", () => {
        expect(commanderUsage(["1;2;3"], null)).toEqual({ configured: 3, max: null, remaining: null })
    })
})
