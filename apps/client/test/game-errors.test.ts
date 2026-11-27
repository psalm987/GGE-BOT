import { expect, test } from "vitest"
import { problemRows } from "../src/game-errors.ts"

const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 10, minute))
const problem = (command: string, error: string, count = 1) => ({ plugin: "attackKhan", command, error, count, firstAt: at(0), lastAt: at(5) })
const words = new Set(["problems.action.cra", "problems.reason.LORD_IS_USED", "problems.reason.COOLING_DOWN"])

test("each problem says in words what was asked and why the game refused it, keeping its count", () => {
    expect(problemRows([problem("cra", "LORD_IS_USED", 50)], key => words.has(key))).toEqual([{
        ...problem("cra", "LORD_IS_USED", 50), errorClass: "notNow", action: "problems.action.cra", reason: "problems.reason.LORD_IS_USED",
    }])
})

test("a command or an error with no words of its own falls back to a general phrase that names the error", () => {
    const [row] = problemRows([problem("zzz", "SOMETHING_NEW")], key => words.has(key))
    expect(row).toMatchObject({ action: "problems.action.other", reason: "problems.reason.other" })
})

test("each problem says how serious its error is", () => {
    const rows = problemRows([problem("cra", "COOLING_DOWN"), problem("lli", "IS_BANNED"), problem("cra", "SOMETHING_NEW")], key => words.has(key))
    expect(rows.map(row => row.errorClass)).toEqual(["notNow", "severe", null])
})
