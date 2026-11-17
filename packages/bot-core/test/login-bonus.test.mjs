import { createRequire } from "node:module"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot, repo } = require("./harness/load.cjs")
const { startBot } = require("./harness/bot-session.cjs")
const en = require("../locales/en.json")

const CLAIM = ["clb", { ID: -1, I: "MS3", SP: null }]
const HOUR = 60 * 60_000

afterEach(() => vi.useRealTimers())

/** The plugin after a login at 10:00 UTC, against a game that answers each `clb` with `reply` (a result code, or nothing). */
function loggedIn({ reply, stopping = false } = {}) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"))
    const bot = fakeBot({ stopping: () => stopping })
    const sentAt = []
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        sentAt.push(Date.now())
        if (reply !== undefined)
            setTimeout(() => bot.xtHandler.emit(cmd, {}, reply), 300)
    }
    loadModule("plugins/loginBonus.js", { bot })
    const counted = () => {
        const batches = []
        require(path.join(repo, "metrics.js")).flush(batch => batches.push(batch))
        return batches.flatMap(batch => batch.counters)
    }
    bot.events.emit("load")
    return { bot, sentAt, counted, t0: Date.now() }
}

test("the catalog entry is off by default and has no options", () => {
    const { mod } = loadModule("plugins/loginBonus.js", { mainThread: true })
    const entry = { key: "loginBonus", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions }
    expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
    expect(entry).toEqual({ key: "loginBonus", force: false, hidden: false, options: [] })
})

test.each(["loginBonus", "loginBonusClaimed", "loginBonusRefused", "loginBonusNoReply"])("en.json names %s", key => {
    expect(en[key]).toEqual(expect.any(String))
})

test("claims once, a while after login, with the captured payload", async () => {
    const { bot, sentAt, counted, t0 } = loggedIn({ reply: 0 })
    await vi.advanceTimersByTimeAsync(44_000)
    expect(bot.sent).toEqual([])

    await vi.advanceTimersByTimeAsync(HOUR)
    expect(bot.sent).toEqual([CLAIM])
    expect(sentAt[0] - t0).toBeGreaterThanOrEqual(45_000)
    expect(counted()).toEqual([["bot_daily_bonus_total", { result: "claimed" }, 1]])
    expect(bot.xtHandler.listenerCount("clb")).toBe(0)
})

test("claims again only on the next day, not on the stroke of midnight", async () => {
    const { bot, sentAt } = loggedIn({ reply: 0 })
    await vi.advanceTimersByTimeAsync(13 * HOUR + 59 * 60_000)
    expect(bot.sent).toEqual([CLAIM])

    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(bot.sent).toEqual([CLAIM, CLAIM])
    const midnight = Date.parse("2026-11-18T00:00:00Z")
    expect(sentAt[1] - midnight).toBeGreaterThanOrEqual(10 * 60_000)
    expect(sentAt[1] - midnight).toBeLessThanOrEqual(2 * HOUR)
})

test.each([
    ["an error reply", 95, "refused"],
    ["no reply at all", undefined, "no_reply"],
])("%s ends the attempt: nothing more is sent that day", async (_name, reply, result) => {
    const { bot, counted } = loggedIn({ reply })
    await vi.advanceTimersByTimeAsync(13 * HOUR + 59 * 60_000)

    expect(bot.sent).toEqual([CLAIM])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result }, 1]])
    expect(bot.xtHandler.listenerCount("clb")).toBe(0)
})

test("after unload nothing is sent, not even the claim that was due", async () => {
    const { bot } = loggedIn({ reply: 0 })
    bot.events.emit("unload")
    await vi.advanceTimersByTimeAsync(48 * HOUR)
    expect(bot.sent).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
})

test("a bot that is stopping sends no claim", async () => {
    const { bot } = loggedIn({ reply: 0, stopping: true })
    await vi.advanceTimersByTimeAsync(48 * HOUR)
    expect(bot.sent).toEqual([])
})

describe("in the real bot", () => {
    const sessions = []
    afterEach(() => Promise.all(sessions.splice(0).map(bot => bot.stop())))

    async function running(state) {
        const bot = startBot({ plugins: { loginBonus: { state, filename: "plugins/loginBonus.js" } } })
        sessions.push(bot)
        await bot.login()
        bot.xt("lli", 0)
        bot.keepAlive()
        await bot.until(() => bot.loads === 1, 5000)
        return bot
    }

    test("a player who turned it on gets one clb frame; a player who left it off gets none", async () => {
        const [on, off] = await Promise.all([running(true), running(false)])
        await on.until(() => on.sentXT("clb").length > 0, 25_000)
        on.xt("clb", 95)
        await new Promise(resolve => setTimeout(resolve, 1500))

        expect(on.sentXT("clb")).toEqual(['%xt%EmpireEx_1%clb%1%{"ID":-1,"I":"MS3","SP":null}%'])
        expect(off.sentXT("clb")).toEqual([])
        expect(on.exited || off.exited).toBe(false)
    }, 40_000)
})
