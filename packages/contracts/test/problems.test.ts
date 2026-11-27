import { describe, expect, test } from "vitest"
import { AccountProblem, GameRefusal } from "../src/index.ts"

describe("a game refusal", () => {
    test("names the plugin, the command and the game's error, with when it came", () => {
        expect(GameRefusal.parse({ plugin: "attackKhan", command: "cra", error: "LORD_IS_USED", at: 1 })).toEqual({ plugin: "attackKhan", command: "cra", error: "LORD_IS_USED", at: 1 })
        expect(GameRefusal.safeParse({ plugin: "", command: "cra", error: "LORD_IS_USED", at: 1 }).success).toBe(false)
        expect(GameRefusal.safeParse({ plugin: "attackKhan", command: "x".repeat(40), error: "LORD_IS_USED", at: 1 }).success).toBe(false)
    })
    test("is listed as one problem with how often it came", () => {
        const problem = { plugin: "attackKhan", command: "cra", error: "LORD_IS_USED", count: 50, firstAt: new Date(0), lastAt: new Date(1) }
        expect(AccountProblem.parse(problem)).toEqual(problem)
        expect(AccountProblem.safeParse({ ...problem, count: 0 }).success).toBe(false)
    })
})
