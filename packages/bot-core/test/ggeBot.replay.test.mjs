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
        expect(bot.exited).toBe(false)
    }, 15000)

    test("a long ban never schedules an overflowing retry (ggeBot.js:384)", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", code("IS_BANNED"), { CD: 0, RS: 30 * 24 * 3600 })
        await sleep(500)

        expect(bot.sentXT("lli")).toHaveLength(1)
    }, 15000)

    test("a ban is reported as banned, with when it ends", async () => {
        bot = startBot()
        await bot.login()
        const before = Date.now()
        bot.xt("lli", code("IS_BANNED"), { CD: 0, RS: 3600 })
        await bot.until(() => bot.botStates().length > 0)

        const [state] = bot.botStates()
        expect(state).toMatchObject({ state: "banned", reason: "IS_BANNED" })
        expect(state.bannedUntil).toBeGreaterThanOrEqual(before + 3600_000)
        expect(state.bannedUntil).toBeLessThan(Date.now() + 3600_000 + 1000)
    }, 15000)

    test("a rejected password is reported as auth_failed and never retried", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", code("INVALID_PASSWORD"))
        await bot.until(() => bot.botStates().length > 0)
        await sleep(300)

        expect(bot.botStates()).toEqual([{ state: "auth_failed", reason: "INVALID_PASSWORD" }])
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
        expect(bot.botStates()).toEqual([{ state: "error", reason: "tooManyImportantErrors" }])
    }, 15000)

    test("with exitOnFatal the worker closes the connection and exits instead of pausing", async () => {
        bot = startBot({ exitOnFatal: true })
        await bot.login()
        for (let i = 0; i < 7; i++) await fail()
        await bot.startWaitForResult("tst", 1000)
        bot.xt("tst", code("LORD_IS_USED"))
        await bot.until(() => bot.exited, 2000)
        expect(bot.closed).toBe(true)
        expect(bot.paused).toBe(false)
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

describe("metrics", () => {
    test("batches count messages per command and time replies, with no account in any label", async () => {
        bot = startBot()
        await bot.login()
        const { done } = await bot.startWaitForResult("tst", 1000)
        bot.xt("tst", 0)
        await done
        await bot.until(() => bot.metricBatches().some(b => b.observations.some(([name]) => name === "bot_game_rtt_seconds")), 2000)

        const counters = bot.metricBatches().flatMap(b => b.counters)
        const total = (direction, command) => counters
            .filter(([name, labels]) => name === "bot_messages_total" && labels.direction === direction && labels.command === command)
            .reduce((sum, [, , n]) => sum + n, 0)
        expect(total("out", "vck")).toBe(1)
        expect(total("out", "lli")).toBe(1)
        expect(total("in", "tst")).toBe(1)

        const rtt = bot.metricBatches().flatMap(b => b.observations).find(([name, labels]) => name === "bot_game_rtt_seconds" && labels.command === "tst")
        expect(rtt[2][0]).toBeGreaterThanOrEqual(0)
        expect(JSON.stringify(bot.metricBatches())).not.toContain("tester")
    }, 15000)
})

describe("reasons for stopping", () => {
    test("a server rejecting the client version is reported, and the worker exits", async () => {
        bot = startBot()
        await bot.until(() => bot.sent.some(m => m.includes('action="verChk"')))
        bot.frame("<msg t='sys'><body action='apiKO' r='0'></body></msg>")
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "CLIENT_VERSION_REJECTED" }])
        expect(bot.sent.some(m => m.includes('action="login"'))).toBe(false)
    }, 15000)

    test("an unknown system message is ignored", async () => {
        bot = startBot()
        await bot.until(() => bot.sent.some(m => m.includes('action="verChk"')))
        bot.frame("<msg t='sys'><body action='somethingNew' r='0'></body></msg>")
        await bot.login()
        expect(bot.botStates()).toEqual([])
    }, 15000)

    test("a login with no reply times out after 90s scaled by timeoutMultiplier", async () => {
        bot = startBot()
        const started = Date.now()
        await bot.login()
        await bot.until(() => bot.exited, 3000)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "LOGIN_TIMEOUT" }])
        expect(Date.now() - started).toBeGreaterThanOrEqual(800)
    }, 15000)

    test("a successful login clears the login deadline", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        await sleep(1500)

        expect(bot.botStates()).toEqual([])
        expect(bot.exited).toBe(false)
    }, 15000)

    test("a retry-later reply pushes the login deadline past the wait", async () => {
        bot = startBot()
        const started = Date.now()
        await bot.login()
        bot.xt("lli", 453, { CD: 1 })
        await bot.until(() => bot.sentXT("lli").length === 2, 2000)
        expect(bot.botStates()).toEqual([])

        await bot.until(() => bot.exited, 3000)
        expect(bot.botStates()).toEqual([{ state: "error", reason: "LOGIN_TIMEOUT" }])
        expect(Date.now() - started).toBeGreaterThanOrEqual(1500)
    }, 15000)

    test("the server closing the socket is reported with its close code", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        bot.serverClose(1006)
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "SOCKET_ERROR:1006" }])
    }, 15000)

    test("a socket error is reported with its error code", async () => {
        bot = startBot()
        await bot.until(() => bot.sent.some(m => m.includes('action="verChk"')))
        bot.socketError("connect ECONNREFUSED", "ECONNREFUSED")
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "SOCKET_ERROR:ECONNREFUSED" }])
    }, 15000)

    test("the socket closing after a ban keeps the ban as the reason", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", code("IS_BANNED"), { CD: 0, RS: 3600 })
        await bot.until(() => bot.botStates().length > 0)
        bot.serverClose(1000)
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toMatchObject([{ state: "banned", reason: "IS_BANNED" }])
    }, 15000)

    test("closing the socket after a fatal error keeps the fatal reason", async () => {
        bot = startBot({ exitOnFatal: true })
        await bot.login()
        bot.xt("lli", 0)
        await bot.startWaitForResult("tst", 1000)
        bot.xt("tst", code("MOVEMENT_HAS_NO_UNITS"))
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "MOVEMENT_HAS_NO_UNITS" }])
    }, 15000)

    test("six timeouts in a row are reported before the worker exits", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        for (let i = 0; i < 5; i++) {
            const { done } = await bot.startWaitForResult("tst", 100)
            expect((await done).error).toBe("TIMED_OUT")
        }
        await bot.startWaitForResult("tst", 100)
        await bot.until(() => bot.exited)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "TOO_MANY_TIMEOUTS" }])
    }, 15000)

    test("a rejected login token is retried at most three times, then reported", async () => {
        bot = startBot()
        await bot.login()
        for (let sent = 1; sent <= 4; sent++) {
            await bot.until(() => bot.sentXT("lli").length === sent)
            bot.xt("lli", code("INVALID_LOGIN_TOKEN"))
        }
        await bot.until(() => bot.botStates().length > 0)
        await sleep(300)

        expect(bot.botStates()).toEqual([{ state: "auth_failed", reason: "INVALID_LOGIN_TOKEN" }])
        expect(bot.sentXT("lli")).toHaveLength(4)
    }, 15000)
})

describe("liveness", () => {
    test("heartbeats report the phase from connecting through login to running", async () => {
        bot = startBot({ connect: false, timeoutMultiplier: 0.02 })
        await bot.until(() => bot.heartbeats().length > 0)
        expect(bot.heartbeats()[0]).toMatchObject({ phase: "connecting" })

        bot.connect()
        await bot.until(() => bot.heartbeats().some(h => h.phase === "login"))
        await bot.login()
        bot.xt("lli", 0)
        await bot.until(() => bot.heartbeats().some(h => h.phase === "running"))

        expect([...new Set(bot.heartbeats().map(h => h.phase))]).toEqual(["connecting", "login", "running"])
        const beat = bot.heartbeats().at(-1)
        expect(beat.ws).toBe(1)
        expect(beat.inboundAgeMs).toBeGreaterThanOrEqual(0)
        expect(beat.outboundAgeMs).toBeGreaterThanOrEqual(0)
    }, 15000)

    test("heartbeats show how long ago a frame last arrived and was last sent", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        await sleep(700)
        bot.xt("pin", 0)
        const seen = bot.heartbeats().length
        await bot.until(() => bot.heartbeats().length > seen)

        const beat = bot.heartbeats().at(-1)
        expect(beat.inboundAgeMs).toBeLessThan(600)
        expect(beat.outboundAgeMs).toBeGreaterThanOrEqual(600)
    }, 15000)

    test("with a silence limit set, a running bot that hears nothing past it reports CONNECTION_STALE and exits", async () => {
        bot = startBot({ inboundStaleMs: 3000 })
        await bot.login()
        bot.xt("lli", 0)
        const silentSince = Date.now()
        await bot.until(() => bot.exited, 10000)

        expect(bot.botStates()).toEqual([{ state: "error", reason: "CONNECTION_STALE" }])
        expect(Date.now() - silentSince).toBeGreaterThanOrEqual(3000)
    }, 15000)

    test("with no silence limit set, a quiet running bot keeps running", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        await sleep(4000)

        expect(bot.botStates()).toEqual([])
        expect(bot.exited).toBe(false)
        expect(bot.heartbeats().at(-1).phase).toBe("running")
    }, 15000)

    test("a running bot that keeps hearing from the server is not stale", async () => {
        bot = startBot({ inboundStaleMs: 3000 })
        await bot.login()
        bot.xt("lli", 0)
        bot.keepAlive()
        await sleep(4000)

        expect(bot.botStates()).toEqual([])
        expect(bot.exited).toBe(false)
    }, 15000)

    test("the longest silence between frames is recorded as a metric", async () => {
        bot = startBot()
        await bot.login()
        bot.xt("lli", 0)
        await sleep(600)
        bot.xt("pin", 0)
        const gaps = () => bot.metricBatches().flatMap(b => b.observations).filter(([name]) => name === "bot_inbound_gap_seconds").flatMap(([, , values]) => values)
        await bot.until(() => gaps().some(g => g >= 0.5))
        expect(Math.max(...gaps())).toBeLessThan(3)
    }, 15000)
})
