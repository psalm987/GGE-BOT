import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.restoreAllMocks())

const NONE = { "1MinSkip": 0, "5MinSkip": 0, "10MinSkip": 0, "30MinSkip": 0, "60MinSkip": 0, "5HourSkip": 0, "24HourSkip": 0 }
const ALL_TICKED = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true }

/** The Skips plugin with the account holding `held` skips and the Skips settings `options`. */
function skips(held, options = ALL_TICKED) {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "debug").mockImplementation(() => {})
    const bot = fakeBot()
    bot.botConfig.plugins.skips = options
    const resources = { ...NONE, ...held }
    const { mod } = loadModule("plugins/skips.js", { bot, extra: { protocols: { resources } } })
    return { ...mod, resources }
}

const MINUTES = 60

test("a spent skip comes off the count at once, so the next pick doesn't offer a used-up type", () => {
    const { spendSkip } = skips({ "5MinSkip": 1, "10MinSkip": 3 })
    expect(spendSkip(5 * MINUTES)).toBe("MS2")
    expect(spendSkip(5 * MINUTES)).toBe("MS3")
})

test("the game saying a type has run out zeroes it, and the caller may retry with another", () => {
    const { spendSkip, skipRefused, resources } = skips({ "10MinSkip": 4, "30MinSkip": 2 })
    expect(spendSkip(10 * MINUTES)).toBe("MS3")
    expect(skipRefused("MS3", 335)).toBe(true)
    expect(resources["10MinSkip"]).toBe(0)
    expect(spendSkip(10 * MINUTES)).toBe("MS4")
})

test("the game saying the timer was already over gives the skip back, with nothing to retry", () => {
    const { spendSkip, skipRefused, resources } = skips({ "60MinSkip": 2 })
    spendSkip(60 * MINUTES)
    expect(resources["60MinSkip"]).toBe(1)
    expect(skipRefused("MS5", 311)).toBe(false)
    expect(resources["60MinSkip"]).toBe(2)
})

test("any other refusal leaves the count as spent and asks for no retry", () => {
    const { spendSkip, skipRefused, resources } = skips({ "60MinSkip": 2 })
    spendSkip(60 * MINUTES)
    expect(skipRefused("MS5", 1)).toBe(false)
    expect(resources["60MinSkip"]).toBe(1)
})

test.each([
    ["two hours with 1 h and 5 h skips: a 1 h skip, keeping the 5 h one", 120, { "60MinSkip": 5, "5HourSkip": 5 }, "MS5"],
    ["55 minutes: a 1 h skip finishes it within 10% waste", 55, { "30MinSkip": 5, "60MinSkip": 5 }, "MS5"],
    ["9 minutes: a 10 min skip finishes it within 2 minutes", 9, { "1MinSkip": 20, "5MinSkip": 5, "10MinSkip": 5 }, "MS3"],
    ["40 minutes when the small ones add up: the largest of them", 40, { "10MinSkip": 5, "60MinSkip": 5 }, "MS3"],
    ["40 minutes when they don't: the smallest that finishes it", 40, { "10MinSkip": 1, "60MinSkip": 5 }, "MS5"],
])("%s", (_name, minutes, held, expected) => {
    const { spendSkip } = skips(held)
    expect(spendSkip(minutes * MINUTES)).toBe(expected)
})

test("never spends a skip more than four times the time left, unless the filter is bypassed", () => {
    expect(skips({ "24HourSkip": 5 }).spendSkip(10 * MINUTES)).toBeUndefined()
    expect(skips({ "24HourSkip": 5 }, { ...ALL_TICKED, bypassSkipTypeFilter: true }).spendSkip(10 * MINUTES)).toBe("MS7")
})

test("a plugin's own skip types replace the Skips settings", () => {
    const { spendSkip } = skips({ "1MinSkip": 5, "5MinSkip": 5 }, { ...ALL_TICKED, "5Minute": false })
    expect(spendSkip(5 * MINUTES)).toBe("MS1")
    expect(spendSkip(5 * MINUTES, [5])).toBe("MS2")
})

test("haveEnoughSkips adds up the skips it would spend, without spending them", () => {
    const { haveEnoughSkips, resources } = skips({ "60MinSkip": 2 })
    expect(haveEnoughSkips(120 * MINUTES)).toBe(true)
    expect(haveEnoughSkips(150 * MINUTES)).toBe(false)
    expect(resources["60MinSkip"]).toBe(2)
})
