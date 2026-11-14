import { createRequire } from "node:module"
import { afterEach, describe, test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { startBot } = require("./harness/bot-session.cjs")
const ActionType = require("../actions.json")
const err = require("../err.json")
const code = name => Number(Object.keys(err).find(k => err[k] === name))

const sleep = ms => new Promise(r => setTimeout(r, ms))
let bot
afterEach(async () => { await bot?.stop() })

describe("login", () => {
    test("logs in, reports Started and loads once when event data arrives", async () => {
        bot = startBot()
        await bot.login()
        expect(JSON.parse(bot.sentXT("lli")[0].split("%")[5]).NOM).toBe("tester")

        bot.xt("lli", 0)
        bot.xt("sei", 0, { E: [] })
        await bot.until(() => bot.loads > 0, 7000)
        await sleep(500)

        expect(bot.toParent.some(m => m[0] === ActionType.Started)).toBe(true)
        expect(bot.loads).toBe(1)
    }, 15000)

    test("event data arriving after the fallback does not load a second time (ggeBot.js:392-403)", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        await bot.until(() => bot.loads === 1, 2000)

        bot.xt("sei", 0, { E: [] })
        await sleep(5500)

        expect(bot.loads).toBe(1)
    }, 15000)

    test("a long ban never schedules an overflowing retry (ggeBot.js:384)", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", code("IS_BANNED"), { CD: 0, RS: 30 * 24 * 3600 })
        await sleep(500)

        expect(bot.sentXT("lli")).toHaveLength(1)
    }, 15000)
})

describe("important error counter", () => {
    const reply = async result => {
        const { done } = await bot.startWaitForResult("tst", 1000)
        bot.xt("tst", result)
        expect((await done).error).toBeUndefined()
    }
    const fail = () => reply(code("LORD_IS_USED"))
    const succeed = () => reply(0)

    test("eight LORD_IS_USED errors in a row pause the connection", async () => {
        bot = startBot()
        await bot.login()
        for (let i = 0; i < 8; i++) await fail()
        await sleep(50)
        expect(bot.paused).toBe(true)
    }, 15000)

    test("a success resets the count, so scattered errors never pause (ggeBot.js:89-104)", async () => {
        bot = startBot()
        await bot.login()
        for (let i = 0; i < 7; i++) await fail()
        await succeed()
        await fail()
        await sleep(50)
        expect(bot.paused).toBe(false)
    }, 15000)
})
