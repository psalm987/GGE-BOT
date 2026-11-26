import { createRequire } from "node:module"
import { afterEach, describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { errorClass } = require("../errClass.js")
const classes = require("../err-classes.json")
const err = require("../err.json")
const { startBot } = require("./harness/bot-session.cjs")
const ActionType = require("../actions.json")
const code = name => Number(Object.keys(err).find(k => err[k] === name))

describe("the classification", () => {
    test("names only codes the game has, each in one class", () => {
        const known = new Set(Object.values(err))
        const listed = [...classes.severe, ...classes.notNow]
        expect(listed.filter(name => !known.has(name))).toEqual([])
        expect(new Set(listed).size).toBe(listed.length)
    })

    test.each([
        ["IS_BANNED", "severe"],
        ["INVALID_PARAMETER_VALUE", "severe"],
        ["INVALID_LOGIN_TOKEN", "severe"],
        ["MOVEMENT_HAS_NO_UNITS", "severe"],
        ["NOT_ENOUGH_CURRENCY1", "notNow"],
        ["COOLING_DOWN", "notNow"],
        ["LORD_IS_USED", "notNow"],
        ["PLAYER_HAS_PEACE", "notNow"],
        ["TAX_COLLECTOR_NOT_FINISHED", "notNow"],
        ["INVALID_POSITION", null],
        ["ALL_OK", null],
        ["TIMED_OUT", null],
        ["NOT_A_CODE", null],
    ])("%s is %s", (name, expected) => {
        expect(errorClass(name)).toBe(expected)
    })

    test("a code that is only the way the game is right now is never severe", () => {
        for (const name of classes.notNow)
            expect(name).not.toMatch(/^(INVALID_|MISSING_PARAMETER|GENERAL_ERROR)/)
    })
})

describe("what the worker logs when the game refuses", () => {
    let bot
    afterEach(async () => { await bot?.stop() })
    const logged = name => bot.toParent.filter(m => m[0] === ActionType.GetLogs && m[2].includes(name))

    test.each([
        ["COOLING_DOWN", 3],
        ["INVALID_PARAMETER_VALUE", 2],
        ["TARGET_NOT_OWNED", 1],
    ])("a refusal with %s is logged at level %i", async (name, level) => {
        bot = startBot()
        await bot.login()
        const { done } = await bot.startWaitForResult("tst", 1000)
        bot.xt("tst", code(name))
        await done
        await bot.until(() => logged(name).length > 0, 2000)
        expect(logged(name).map(m => m[1])).toEqual([level])
    }, 15000)
})
