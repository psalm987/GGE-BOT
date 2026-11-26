import { createRequire } from "node:module"
import { afterEach, describe, test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { startBot } = require("./harness/bot-session.cjs")
const ActionType = require("../actions.json")
const err = require("../err.json")
const code = name => Number(Object.keys(err).find(k => err[k] === name))

const sleep = ms => new Promise(r => setTimeout(r, ms))
/** The harness runs at timeoutMultiplier 0.01, so a wait of S seconds takes S * 10 ms. */
const scaled = seconds => seconds * 1000 * 0.01
let bot
afterEach(async () => { await bot?.stop() })

const lliTimes = () => bot.sentAt.filter((_, i) => bot.sent[i].startsWith("%xt%") && bot.sent[i].split("%")[3] === "lli")
const logged = name => bot.toParent.filter(m => m[0] === ActionType.GetLogs && m[2].includes(name))

describe("another login takes the account", () => {
    test("the game's kick (10020) is reported as KICKED and the worker exits at once", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        bot.xt("gbd", 10020)
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "KICKED" }])
    }, 15000)

    test("the socket closing after the kick keeps KICKED as the reason", async () => {
        bot = startBot({ surviveExit: true })
        await bot.login()
        bot.xt("lli", 0)
        bot.xt("pin", 10020)
        bot.serverClose(1000)
        await bot.until(() => bot.botStates().length > 0)
        await sleep(100)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "KICKED" }])
    }, 15000)
})

describe("login retries", () => {
    test("a retry-later reply without a cooldown waits at least 10 s, not 0", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 453, {})
        await bot.until(() => lliTimes().length === 2, 3000)

        const [first, second] = lliTimes()
        expect(second - first).toBeGreaterThanOrEqual(scaled(5 + 5))
        expect(second - first).toBeLessThan(scaled(5 + 30) + 200)
    }, 15000)

    test("a retry-later reply waits its cooldown plus 5 to 30 s", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 453, { CD: 20 })
        await bot.until(() => lliTimes().length === 2, 3000)

        const [first, second] = lliTimes()
        expect(second - first).toBeGreaterThanOrEqual(scaled(20 + 5))
        expect(second - first).toBeLessThan(scaled(20 + 30) + 200)
    }, 15000)

    test("a rejected login token is retried after about 30, 60 and 120 s", async () => {
        bot = startBot()
        await bot.login()
        for (let sent = 1; sent <= 3; sent++) {
            await bot.until(() => lliTimes().length === sent, 3000)
            bot.xt("lli", code("INVALID_LOGIN_TOKEN"))
        }
        await bot.until(() => lliTimes().length === 4, 3000)

        const times = lliTimes()
        const waits = times.slice(1).map((at, i) => at - times[i])
        expect(waits[0]).toBeGreaterThanOrEqual(scaled(30 * 0.8))
        expect(waits[1]).toBeGreaterThanOrEqual(scaled(60 * 0.8))
        expect(waits[2]).toBeGreaterThanOrEqual(scaled(120 * 0.8))
    }, 15000)
})

describe("important errors", () => {
    test("one refusal heard by three waiting plugins counts once", async () => {
        bot = startBot()
        await bot.login()
        for (let round = 0; round < 3; round++) {
            const waits = []
            for (let i = 0; i < 3; i++)
                waits.push((await bot.startWaitForResult("tst", 1000)).done)
            bot.xt("tst", code("LORD_IS_USED"))
            await Promise.all(waits)
        }
        await sleep(50)

        expect(bot.paused).toBe(false)
        expect(bot.botStates()).toEqual([])
    }, 15000)

    test("MISSING_UNITS no longer counts toward closing the connection", async () => {
        bot = startBot()
        await bot.login()
        for (let i = 0; i < 8; i++) {
            const { done } = await bot.startWaitForResult("tst", 1000)
            bot.xt("tst", code("MISSING_UNITS"))
            await done
        }
        await sleep(50)

        expect(bot.paused).toBe(false)
        expect(bot.botStates()).toEqual([])
    }, 15000)

    test("a wait with no timeout is refused and leaves no listener behind to log later replies", async () => {
        bot = startBot()
        await bot.login()
        const { done } = await bot.startWaitForResult("tst", undefined)
        expect((await done).error).toMatch(/No timeout specified/)
        bot.xt("tst", code("TARGET_NOT_OWNED"))
        await sleep(200)

        expect(logged("TARGET_NOT_OWNED")).toEqual([])
    }, 15000)
})

describe("expected refusals", () => {
    test("an error the caller names as expected resolves without being logged", async () => {
        bot = startBot()
        await bot.login()
        const { done } = await bot.startWaitForResult("tst", 1000, ["INVALID_POSITION"])
        bot.xt("tst", code("INVALID_POSITION"))
        expect((await done).result).toBe(code("INVALID_POSITION"))
        await sleep(200)

        expect(logged("INVALID_POSITION")).toEqual([])
    }, 15000)

    test("an error the caller did not name is still logged", async () => {
        bot = startBot()
        await bot.login()
        const { done } = await bot.startWaitForResult("tst", 1000, ["COOLING_DOWN"])
        bot.xt("tst", code("INVALID_POSITION"))
        await done
        await bot.until(() => logged("INVALID_POSITION").length > 0)
    }, 15000)
})

describe("options changed while running", () => {
    test("each plugin's options are replaced whole, in the object the plugin read at load", async () => {
        bot = startBot({ plugins: { demo: { state: false, keep: 1, gone: 2, plan: { waves: [1, 2] } } } })
        await bot.login()
        bot.post([ActionType.SetPluginOptions, { plugins: { demo: { state: false, keep: 3, plan: { waves: [3] }, target: { x: 1, y: 2 } } } }])
        await sleep(100)

        const { plugins, loaded } = await bot.config()
        const expected = { state: false, keep: 3, plan: { waves: [3] }, target: { x: 1, y: 2 } }
        expect(plugins.demo).toEqual(expected)
        expect(loaded).toEqual(expected)
    }, 15000)

    test("prototype keys in new options are ignored", async () => {
        bot = startBot({ plugins: { demo: { state: false, keep: 1 } } })
        await bot.login()
        const hostile = JSON.parse('{"plugins":{"__proto__":{"polluted":"plugins"},"demo":{"state":false,"keep":2,"__proto__":{"polluted":"options"},"constructor":{"prototype":{"polluted":"ctor"}}}}}')
        bot.post([ActionType.SetPluginOptions, hostile])
        await sleep(100)

        const { plugins, polluted } = await bot.config()
        expect(polluted).toBeUndefined()
        expect(plugins.demo).toEqual({ state: false, keep: 2 })
    }, 15000)
})

describe("what the bot asks for after login", () => {
    test("without login_sequence the general inventory (gie) is still requested once", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        await bot.until(() => bot.sentXT("gie").length > 0)
        await sleep(200)

        expect(bot.sentXT("gie")).toEqual(["%xt%EmpireEx_1%gie%1%{}%"])
    }, 15000)
})
