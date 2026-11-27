import { createRequire } from "node:module"
import { afterEach, describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { startBot } = require("./harness/bot-session.cjs")
const ActionType = require("../actions.json")
const err = require("../err.json")
const code = name => Number(Object.keys(err).find(k => err[k] === name))

const sleep = ms => new Promise(r => setTimeout(r, ms))
let bot
afterEach(async () => { await bot?.stop() })

const refusals = () => bot.toParent.filter(m => m[0] === ActionType.GameRefusal).map(m => m[1])

async function loggedIn() {
    bot = startBot()
    await bot.login()
    bot.xt("lli", 0)
    bot.keepAlive()
}

async function sent(cmd) {
    bot.sendXT(cmd)
    await bot.until(() => bot.sentXT(cmd).length > 0)
}

describe("the game refusing a request the bot sent", () => {
    test("reaches the host with the script that sent it, the command, the game's error and when", async () => {
        await loggedIn()
        await sent("cra")
        const before = Date.now()
        bot.xt("cra", code("LORD_IS_USED"))
        await bot.until(() => refusals().length === 1)

        const [refusal] = refusals()
        expect(refusal).toMatchObject({ plugin: "bot-worker", command: "cra", error: "LORD_IS_USED" })
        expect(refusal.at).toBeGreaterThanOrEqual(before)
    }, 15000)

    test("an error err.json doesn't name goes by its number", async () => {
        await loggedIn()
        await sent("sbp")
        bot.xt("sbp", 987654)
        await bot.until(() => refusals().length === 1)
        expect(refusals()[0]).toMatchObject({ command: "sbp", error: "987654" })
    }, 15000)

    test("one the waiting plugin expects and handles itself is left out", async () => {
        await loggedIn()
        const { done } = await bot.startWaitForResult("ssi", 1000, ["INVALID_POSITION"])
        await sent("ssi")
        bot.xt("ssi", code("INVALID_POSITION"))
        await done
        await sleep(200)
        expect(refusals()).toEqual([])
    }, 15000)

    test("an answer with nothing behind it, a request the bot never sent, or one the bot repeats on its own is left out", async () => {
        await loggedIn()
        bot.xt("gam", code("GENERAL_ERROR"))
        await sent("pin")
        bot.xt("pin", code("GENERAL_ERROR"))
        await sent("jca")
        bot.xt("jca", code("NOT_IN_OWNED_CASTLE"))
        await sent("cra")
        bot.xt("cra", 0)
        await sleep(300)
        expect(refusals()).toEqual([])
    }, 15000)
})
