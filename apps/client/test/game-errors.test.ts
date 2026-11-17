import { expect, test } from "vitest"
import { errorCodeOf, topErrors } from "../src/game-errors.ts"

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 10, minute))
const refusal = (code: string, minute: number) => ({ parts: ["[10:00] ", "[", "ggeBot", "] ", "cra", code], ts: at(minute) })

test("the code a line reports is the game's name for it, and a line with none reports nothing", () => {
    expect(errorCodeOf(refusal("COOLING_DOWN", 0))).toBe("COOLING_DOWN")
    expect(errorCodeOf({ parts: ["[10:00] ", "[", "feast", "] ", "consumed", 120] })).toBeUndefined()
    expect(errorCodeOf({ parts: null })).toBeUndefined()
    expect(errorCodeOf(refusal("ALL_OK", 0))).toBeUndefined()
})

test("the top errors count each code, most often first, with its class and when it last happened", () => {
    const lines = [
        refusal("COOLING_DOWN", 1), refusal("IS_BANNED", 2), refusal("COOLING_DOWN", 5), refusal("NOT_ENOUGH_CURRENCY1", 3),
        refusal("COOLING_DOWN", 4), refusal("NOT_ENOUGH_CURRENCY1", 6), refusal("TARGET_NOT_OWNED", 7),
    ]
    expect(topErrors(lines, 3)).toEqual([
        { code: "COOLING_DOWN", errorClass: "notNow", count: 3, lastAt: at(5) },
        { code: "NOT_ENOUGH_CURRENCY1", errorClass: "notNow", count: 2, lastAt: at(6) },
        { code: "TARGET_NOT_OWNED", errorClass: null, count: 1, lastAt: at(7) },
    ])
    expect(topErrors(lines, 10).find(e => e.code === "IS_BANNED")?.errorClass).toBe("severe")
    expect(topErrors([], 5)).toEqual([])
})
