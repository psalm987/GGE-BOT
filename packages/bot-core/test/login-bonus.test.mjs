import { createRequire } from "node:module"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot, repo } = require("./harness/load.cjs")
const { startBot } = require("./harness/bot-session.cjs")
const en = require("../locales/en.json")
const captured = require("./fixtures/protocol/daily-20261121.json")

const HOUR = 60 * 60_000
const CHOICES = ["VIP time or VIP points", "Troops", "Time skips", "Resources", "Decorations"]
/** The captured offer list on day 5 (D 4), before the VIP points were picked. */
const ALB = captured.alb_1.reply.payload
/** The same list on another day of the cycle; on day 4 (D 3) the captured player had already taken the troops. */
const onDay = D => ({ ...ALB, D })
const claimOf = (I, ID = -1) => ["clb", { ID, I, SP: null }]

afterEach(() => vi.useRealTimers())

/**
 * The plugin after a login at 10:00 UTC, against a game that answers `alb` with `alb` (a payload, or null for
 * silence) and each `clb` with `clb` (a result code, or null). `reward` is the player's choice; `fromLogin` is an
 * `alb` payload the login burst got back before the plugin's first claim.
 */
function loggedIn({ alb = ALB, clb = 0, reward, fromLogin, stopping = false } = {}) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"))
    const bot = fakeBot({ stopping: () => stopping })
    if (reward !== undefined)
        bot.botConfig.plugins.loginBonus = { loginBonusReward: reward }
    const answers = { alb: alb && [alb, 0], clb: clb !== null && [{}, clb] }
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        if (answers[cmd])
            setTimeout(() => bot.xtHandler.emit(cmd, ...answers[cmd]), 300)
    }
    loadModule("plugins/loginBonus.js", { bot })
    if (fromLogin)
        bot.xtHandler.emit("alb", fromLogin, 0)
    const counted = () => {
        const batches = []
        require(path.join(repo, "metrics.js")).flush(batch => batches.push(batch))
        return batches.flatMap(batch => batch.counters)
    }
    bot.events.emit("load")
    return { bot, counted, claims: () => bot.sent.filter(([cmd]) => cmd == "clb") }
}

test("the catalog entry is off by default and offers a reward choice that starts on VIP", () => {
    const { mod } = loadModule("plugins/loginBonus.js", { mainThread: true })
    const entry = { key: "loginBonus", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions }
    expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
    expect(entry).toEqual({ key: "loginBonus", force: false, hidden: false, options: [{ type: "Select", key: "loginBonusReward", selection: CHOICES, default: 0 }] })
})

test.each(["loginBonus", "loginBonusClaimed", "loginBonusRefused", "loginBonusNoReply", "loginBonusAlreadyClaimed", "loginBonusNoOffer", "loginBonusReward", "loginBonus.loginBonusReward.help", ...CHOICES])("en.json names %s", key => {
    expect(en[key]).toEqual(expect.any(String))
})

test("by default it asks for the offer a while after login, then claims what the captured player claimed", async () => {
    const { bot, counted } = loggedIn()
    await vi.advanceTimersByTimeAsync(44_000)
    expect(bot.sent).toEqual([])

    await vi.advanceTimersByTimeAsync(HOUR)
    expect(bot.sent).toEqual([["alb", {}], [captured.clb_1.cmd, captured.clb_1.payload]])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result: "claimed" }, 1]])
    expect(bot.xtHandler.listenerCount("clb")).toBe(0)
})

test.each([
    ["VIP time or VIP points", 0, 4, claimOf("VP")],
    ["troops, sent with the unit's wodID", 1, 4, claimOf("U", 655)],
    ["decorations", 4, 4, claimOf("D")],
    ["time skips", 2, 0, claimOf("MS1")],
    ["resources", 3, 2, claimOf("W")],
])("a player who puts %s first gets them", async (_name, reward, D, claim) => {
    const { claims } = loggedIn({ reward, alb: onDay(D) })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(claims()).toEqual([claim])
})

test.each([
    ["time skips, not offered on day 5, fall back to the VIP points", 2, 4, claimOf("VP")],
    ["resources, not offered on day 6, fall back to the VIP time", 3, 5, claimOf("VT")],
    ["VIP, not offered on day 1, falls back to the troops", 0, 0, claimOf("U", 614)],
    ["decorations, not offered on day 3, fall back to the VIP points", 4, 2, claimOf("VP")],
])("%s", async (_name, reward, D, claim) => {
    const { claims } = loggedIn({ reward, alb: onDay(D) })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(claims()).toEqual([claim])
})

test("HF is never claimed, on any captured day with any choice", async () => {
    const picks = []
    for (const D of [0, 2, 4, 5, 6])
        for (const reward of CHOICES.keys()) {
            const { claims } = loggedIn({ reward, alb: onDay(D) })
            await vi.advanceTimersByTimeAsync(HOUR)
            picks.push(claims()[0]?.[1].I)
            vi.useRealTimers()
        }
    expect(picks).toHaveLength(25)
    expect(picks.every(I => typeof I == "string" && I != "HF")).toBe(true)
})

test("an offer that holds only HF and a sort order claims nothing", async () => {
    const alb = { D: 0, R: [{ D1: [{ REW: [{ HF: [288], SO: "1" }] }, {}, {}, {}] }] }
    const { claims, counted } = loggedIn({ alb })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(claims()).toEqual([])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result: "no_offer" }, 1]])
})

test("a key the bot does not know is taken only when nothing it knows is offered", async () => {
    const offer = REW => ({ D: 0, R: [{ D1: [{ REW: [REW] }, {}, {}, {}] }] })
    const known = loggedIn({ reward: 1, alb: offer({ XY: [5], D: [[321, 1]] }) })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(known.claims()).toEqual([claimOf("D")])
    vi.useRealTimers()

    const unknown = loggedIn({ alb: offer({ XY: [5], HF: [288] }) })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(unknown.claims()).toEqual([claimOf("XY")])
})

test("a day already claimed, as day 4 was in the capture, sends no claim", async () => {
    const { bot, counted } = loggedIn({ alb: onDay(3) })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(bot.sent).toEqual([["alb", {}]])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result: "already" }, 1]])
})

test("the offer the login burst got back is used, so no second alb is sent", async () => {
    const { bot } = loggedIn({ fromLogin: ALB })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(bot.sent).toEqual([claimOf("VP")])
})

test("the list in the claim's reply shows the day as picked: a login burst that saw it claims nothing", async () => {
    const { bot, counted } = loggedIn({ fromLogin: captured.clb_1.reply.payload.alb })
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(bot.sent).toEqual([])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result: "already" }, 1]])
})

test("next day it asks for the new offer before claiming, not on the stroke of midnight", async () => {
    const { bot } = loggedIn({ fromLogin: ALB, alb: onDay(5) })
    await vi.advanceTimersByTimeAsync(13 * HOUR + 59 * 60_000)
    expect(bot.sent).toEqual([claimOf("VP")])

    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(bot.sent).toEqual([claimOf("VP"), ["alb", {}], claimOf("VT")])
})

test("no answer to alb sends no claim", async () => {
    const { bot, counted } = loggedIn({ alb: null })
    await vi.advanceTimersByTimeAsync(13 * HOUR + 59 * 60_000)
    expect(bot.sent).toEqual([["alb", {}]])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result: "no_offer" }, 1]])
})

test.each([
    ["an error reply", 95, "refused"],
    ["no reply at all", null, "no_reply"],
])("%s ends the attempt: nothing more is sent that day", async (_name, clb, result) => {
    const { claims, counted, bot } = loggedIn({ clb })
    await vi.advanceTimersByTimeAsync(13 * HOUR + 59 * 60_000)

    expect(claims()).toEqual([claimOf("VP")])
    expect(counted()).toEqual([["bot_daily_bonus_total", { result }, 1]])
    expect(bot.xtHandler.listenerCount("clb")).toBe(0)
})

test("after unload nothing is sent, not even the claim that was due", async () => {
    const { bot } = loggedIn()
    bot.events.emit("unload")
    await vi.advanceTimersByTimeAsync(48 * HOUR)
    expect(bot.sent).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
})

test("a bot that is stopping sends nothing", async () => {
    const { bot } = loggedIn({ stopping: true })
    await vi.advanceTimersByTimeAsync(48 * HOUR)
    expect(bot.sent).toEqual([])
})

describe("in the real bot", () => {
    const sessions = []
    afterEach(() => Promise.all(sessions.splice(0).map(bot => bot.stop())))

    /** Logs in the way the game client does, so the bot sends its login burst, `alb` among it, and answers that `alb`. */
    async function loggedInLikeTheGame(plugins) {
        const bot = startBot({ humanize: { login_sequence: true }, plugins })
        sessions.push(bot)
        await bot.until(() => bot.sent.length === 1)
        bot.frame("<msg t='sys'><body action='apiOK' r='0'></body></msg>")
        await bot.until(() => bot.sent.some(m => m.includes("action='login'")))
        bot.xt("rlu", 0)
        await bot.until(() => bot.sent.some(m => m.includes("action='autoJoin'")))
        bot.frame("<msg t='sys'><body action='joinOK' r='1'><pid id='0'/><vars /><uLs r='1'></uLs></body></msg>")
        await bot.until(() => bot.sentXT("vck").length === 1)
        bot.xt("vck", 0)
        await bot.until(() => bot.sentXT("lli").length === 1)
        bot.xt("lli", 0)
        bot.keepAlive()
        await bot.until(() => bot.sentXT("alb").length === 1, 4000)
        bot.xt("alb", 0, ALB)
        return bot
    }

    test("a player who turned it on and chose troops gets one clb frame for them, from the burst's offer; a player who left it off gets none", async () => {
        const [on, off] = await Promise.all([
            loggedInLikeTheGame({ loginBonus: { state: true, filename: "plugins/loginBonus.js", loginBonusReward: 1 } }),
            loggedInLikeTheGame({ loginBonus: { state: false, filename: "plugins/loginBonus.js" } }),
        ])
        await on.until(() => on.sentXT("clb").length > 0, 10_000)
        on.xt("clb", 95)
        await new Promise(resolve => setTimeout(resolve, 3000))

        expect(on.sentXT("clb")).toEqual(['%xt%EmpireEx_1%clb%1%{"ID":655,"I":"U","SP":null}%'])
        expect(on.sentXT("alb")).toHaveLength(1)
        expect(off.sentXT("clb")).toEqual([])
        expect(on.exited || off.exited).toBe(false)
    }, 30_000)
})
