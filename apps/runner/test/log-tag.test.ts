import { expect, test } from "vitest"
import { logTag } from "../src/log-render.ts"

test("the tag is the script name between the brackets", () => {
    expect(logTag(["[12:00] ", "[", "attackNomads", "] ", "started"])).toBe("attackNomads")
    expect(logTag(["[12:00] ", "[", "ggeBot", "] "])).toBe("ggeBot")
})

test.each([
    ["a short array", ["[12:00] ", "["]],
    ["an empty array", []],
    ["no opening bracket", ["[12:00] ", "(", "attackNomads", "] "]],
    ["a tag that is not a string", ["[12:00] ", "[", 7, "] "]],
    ["an empty tag", ["[12:00] ", "[", "", "] "]],
    ["a string", "[12:00] [attackNomads]"],
    ["null", null],
    ["an object", { 1: "[", 2: "attackNomads" }],
])("no tag for %s", (_, parts) => {
    expect(logTag(parts)).toBeNull()
})
