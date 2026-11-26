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

describe("the account's commanders", () => {
    test("their count goes to the host when the game lists them, and again when it changes", async () => {
        bot = startBot()
        await bot.login()
        const counts = () => bot.toParent.filter(m => m[0] === 7 && m[1].commanders !== undefined).map(m => m[1].commanders)
        bot.xt("gli", 0, { C: [{ ID: 1, VIS: 0 }, { ID: 2, VIS: 1 }, { ID: 3, VIS: 2 }] })
        await bot.until(() => counts().length > 0)
        bot.xt("gli", 0, { C: [{ ID: 1, VIS: 0 }, { ID: 2, VIS: 1 }, { ID: 3, VIS: 2 }] })
        bot.xt("gli", 0, { C: [{ ID: 1, VIS: 0 }, { ID: 2, VIS: 1 }] })
        await bot.until(() => counts().includes(2))

        expect([...new Set(counts())]).toEqual([3, 2])
    }, 15000)
})

describe("the day's wheel spins", () => {
    test("the count the runner hands over stays in every status report, even with the wheel plugin off", async () => {
        const wheelSpins = { day: 20_413, count: 7 }
        bot = startBot({ wheelSpins })
        await bot.login()
        bot.xt("gli", 0, { C: [{ ID: 1, VIS: 0 }] })
        await bot.until(() => bot.toParent.some(m => m[0] === ActionType.StatusUser))

        expect(bot.toParent.filter(m => m[0] === ActionType.StatusUser).map(m => m[1].wheelSpins)).toEqual([wheelSpins])
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
        await bot.login()
        const replied = Date.now()
        bot.xt("lli", 453, { CD: 50 })
        await bot.until(() => bot.sentXT("lli").length === 2, 2000)
        expect(bot.botStates()).toEqual([])

        await bot.until(() => bot.exited, 3000)
        expect(bot.botStates()).toEqual([{ state: "error", reason: "LOGIN_TIMEOUT" }])
        // At least (50 + 5) s of waiting and then the 60 s deadline, at timeoutMultiplier 0.01.
        expect(Date.now() - replied).toBeGreaterThanOrEqual(1150)
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

describe("humanization flags", () => {
    const lliOf = frame => JSON.parse(frame.split("%")[5])
    const pinTimes = () => bot.sentAt.filter((_, i) => bot.sent[i] === "%xt%EmpireEx_1%pin%1%<RoundHouseKick>%")
    const gaps = times => times.slice(1).map((at, i) => at - times[i])
    const roundTripRes = "<msg t='sys'><body action='roundTripRes' r='1'></body></msg>"
    const NCH = "%xt%EmpireEx_1%nch%1%"
    const PIN = "%xt%EmpireEx_1%pin%1%<RoundHouseKick>%"
    const timesOf = frame => bot.sentAt.filter((_, i) => bot.sent[i] === frame)
    const sentAtOf = cmd => bot.sentAt[bot.sent.findIndex(m => m.split("%")[3] === cmd)]

    test("with every flag off the bot sends the frames it always has", async () => {
        bot = startBot({ pinIntervalMs: 200 })
        await bot.login()
        bot.frame(roundTripRes)
        bot.xt("lli", 0)
        await sleep(1500)

        expect(bot.sent.slice(0, 3)).toEqual([
            '<msg t="sys"><body action="verChk" r="0"><ver v="166"/></body></msg>',
            '<msg t="sys"><body action="login" r="0"><login z="EmpireEx_1"><nick><![CDATA[]]></nick><pword><![CDATA[1173009%en%0]]></pword></login></body></msg>',
            '<msg t="sys"><body action="roundTrip" r="1"></body></msg>',
        ])
        expect(bot.sent[3]).toMatch(/^%xt%EmpireEx_1%vck%1%1173009%web-html5%<RoundHouseKick>%\d\.\d+e\+30\d%$/)
        expect(bot.sent[4]).toBe('%xt%EmpireEx_1%lli%1%{"CONM":212,"RTM":25,"ID":0,"PL":1,"NOM":"tester","PW":"pw","LT":null,"LANG":"en","DID":"0","AID":"1745592024940879420","KID":"","REF":"https://empire.goodgamestudios.com","GCI":"","SID":9,"PLFID":1}%')
        expect(bot.sent[5]).toBe("%xt%EmpireEx_1%gie%1%{}%")
        expect(bot.sent.slice(6).every(frame => frame === "%xt%EmpireEx_1%pin%1%<RoundHouseKick>%")).toBe(true)
        expect(pinTimes().length).toBeGreaterThanOrEqual(5)
        expect(pinTimes().length).toBeLessThanOrEqual(8)
    }, 15000)

    test("the configured client build goes where the real client puts it, and one vck number lasts the session", async () => {
        bot = startBot({ gameClientBuild: 1180000 })
        await bot.login()
        bot.frame("<msg t='sys'><body action='joinOK' r='1'><pid id='0'/><vars /><uLs r='1'></uLs></body></msg>")
        await bot.until(() => bot.sentXT("vck").length === 2)

        expect(bot.sent.find(m => m.includes('action="login"'))).toContain("<pword><![CDATA[1180000%en%0]]></pword>")
        const [first, second] = bot.sentXT("vck")
        expect(first).toMatch(/%vck%1%1180000%web-html5%<RoundHouseKick>%\d\.\d+e\+30\d%$/)
        expect(second).toBe(first)
    }, 15000)

    test("a second successful login does not start a second pin loop", async () => {
        for (const humanize of [undefined, { pin_jitter: true }]) {
            bot = startBot({ pinIntervalMs: 200, humanize })
            await bot.login()
            bot.xt("lli", 0)
            bot.xt("lli", 0)
            await sleep(1500)

            expect(pinTimes().length).toBeGreaterThanOrEqual(5)
            expect(pinTimes().length).toBeLessThanOrEqual(9)
            await bot.stop()
        }
    }, 15000)

    test("with pin_jitter the gap between pins varies around the interval", async () => {
        bot = startBot({ pinIntervalMs: 300, humanize: { pin_jitter: true } })
        await bot.login()
        bot.xt("lli", 0)
        await sleep(4500)

        const waits = gaps(pinTimes())
        expect(waits.length).toBeGreaterThanOrEqual(10)
        expect(waits.length).toBeLessThanOrEqual(18)
        expect(Math.min(...waits)).toBeGreaterThanOrEqual(300 - 3 * 30 - 5)
        expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(20)
    }, 15000)

    test("with measured_timing the login reports how long this connection and its round trip took", async () => {
        bot = startBot({ connect: false, timeoutMultiplier: 0.05, humanize: { measured_timing: true } })
        await bot.until(() => bot.socket)
        await sleep(300)
        bot.connect()
        await bot.until(() => bot.sent.some(m => m.includes('action="verChk"')))
        bot.frame("<msg t='sys'><body action='apiOK' r='0'></body></msg>")
        await bot.until(() => bot.sent.some(m => m.includes('action="login"')))
        bot.frame("<msg t='sys'><body action='joinOK' r='1'><pid id='0'/><vars /><uLs r='1'></uLs></body></msg>")
        await bot.until(() => bot.sent.some(m => m.includes('action="roundTrip"')))
        await sleep(120)
        bot.frame(roundTripRes)
        bot.xt("vck", 0)
        await bot.until(() => bot.sentXT("lli").length === 1)

        const { CONM, RTM, ...rest } = lliOf(bot.sentXT("lli")[0])
        expect(Number.isInteger(CONM) && Number.isInteger(RTM)).toBe(true)
        expect(CONM).toBeGreaterThanOrEqual(290)
        expect(CONM).toBeLessThan(1500)
        expect(RTM).toBeGreaterThanOrEqual(110)
        expect(RTM).toBeLessThan(900)
        expect(rest).toMatchObject({ NOM: "tester", PW: "pw", SID: 9 })
    }, 15000)

    test("with measured_timing a connection too fast to be a browser's reports the floor, and an unanswered round trip the old value", async () => {
        bot = startBot({ humanize: { measured_timing: true } })
        await bot.login()

        expect(lliOf(bot.sentXT("lli")[0])).toMatchObject({ CONM: 50, RTM: 25 })
    }, 15000)

    test("with nch an empty nch follows the login, then one about every interval", async () => {
        bot = startBot({ nchIntervalMs: 300, humanize: { nch: true } })
        await bot.login()
        await sleep(400)
        expect(timesOf(NCH)).toEqual([])
        bot.xt("lli", 0)
        await sleep(4500)

        const waits = gaps(timesOf(NCH))
        expect(waits.length).toBeGreaterThanOrEqual(10)
        expect(waits.length).toBeLessThanOrEqual(18)
        expect(Math.min(...waits)).toBeGreaterThanOrEqual(300 - 3 * 37.5 - 5)
        expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(20)
        expect(bot.sent.filter(m => m.includes("%nch%")).every(m => m === NCH)).toBe(true)
        expect(bot.sentXT("gbl")).toEqual([])
    }, 15000)

    test("a second successful login does not start a second nch loop", async () => {
        bot = startBot({ nchIntervalMs: 200, humanize: { nch: true } })
        await bot.login()
        bot.xt("lli", 0)
        bot.xt("lli", 0)
        await sleep(1500)

        expect(timesOf(NCH).length).toBeGreaterThanOrEqual(5)
        expect(timesOf(NCH).length).toBeLessThanOrEqual(9)
    }, 15000)

    test("the nch loop stops when the bot exits, while timers nobody stops keep running", async () => {
        bot = startBot({ surviveExit: true, nchIntervalMs: 500, pinIntervalMs: 500, humanize: { nch: true } })
        await bot.login()
        bot.xt("lli", 0)
        await bot.until(() => timesOf(NCH).length >= 3, 4000)
        bot.serverClose(1006)
        await bot.until(() => bot.botStates().length > 0)
        await sleep(50)
        const [nchBefore, pinsBefore] = [timesOf(NCH).length, timesOf(PIN).length]
        await sleep(2000)

        expect(timesOf(NCH).length).toBe(nchBefore)
        expect(timesOf(PIN).length).toBeGreaterThan(pinsBefore + 2)
    }, 15000)

    test("unanswered nch frames neither count as timeouts nor hide a silent connection", async () => {
        bot = startBot({ inboundStaleMs: 3000, nchIntervalMs: 250, humanize: { nch: true } })
        await bot.login()
        bot.xt("lli", 0)
        await bot.until(() => bot.exited, 10000)

        expect(timesOf(NCH).length).toBeGreaterThan(8)
        expect(bot.botStates()).toEqual([{ state: "error", reason: "CONNECTION_STALE" }])
    }, 15000)

    /** The 2026-11-13 capture's login, with its zone and player name replaced by the harness's. */
    const CAPTURED_LOGIN = [
        "<msg t='sys'><body action='verChk' r='0'><ver v='166' /></body></msg>",
        "<msg t='sys'><body action='login' r='0'><login z='EmpireEx_1'><nick><![CDATA[]]></nick><pword><![CDATA[1173009%en%0]]></pword></login></body></msg>",
        "<msg t='sys'><body action='autoJoin' r='-1'></body></msg>",
        "<msg t='sys'><body action='roundTrip' r='1'></body></msg>",
        "vck",
        '%xt%EmpireEx_1%vln%1%{"NOM":"tester"}%',
        "lli",
    ]
    const CAPTURED_BURST = [
        "%xt%EmpireEx_1%gbl%1%{}%",
        '%xt%EmpireEx_1%jca%1%{"CID":-1,"KID":0}%',
        "%xt%EmpireEx_1%alb%1%{}%",
        "%xt%EmpireEx_1%sli%1%{}%",
        "%xt%EmpireEx_1%gie%1%{}%",
        "%xt%EmpireEx_1%asc%1%{}%",
        "%xt%EmpireEx_1%sie%1%{}%",
        '%xt%EmpireEx_1%ffi%1%{"FIDS":[1]}%',
        "%xt%EmpireEx_1%kli%1%{}%",
        "%xt%EmpireEx_1%gcs%1%{}%",
    ]
    /** Answers the way the game does, including the `rlu` that makes the bot send `autoJoin`. */
    async function loginLikeTheGame() {
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
        await bot.until(() => bot.sentXT("gcs").length === 1, 4000)
    }
    const withoutPins = () => bot.sent.filter(m => m !== PIN)

    test("with login_sequence and nch the login and the burst after it are the captured client's, frame for frame", async () => {
        bot = startBot({ timeoutMultiplier: 0.05, pinIntervalMs: 500, nchIntervalMs: 60_000, humanize: { login_sequence: true, nch: true } })
        await loginLikeTheGame()

        const sent = withoutPins()
        expect(sent.slice(0, 4)).toEqual(CAPTURED_LOGIN.slice(0, 4))
        expect(sent[4]).toMatch(/^%xt%EmpireEx_1%vck%1%1173009%web-html5%<RoundHouseKick>%\d\.\d+e\+30\d%$/)
        expect(sent[5]).toBe(CAPTURED_LOGIN[5])
        expect(sent[6]).toBe('%xt%EmpireEx_1%lli%1%{"CONM":212,"RTM":25,"ID":0,"PL":1,"NOM":"tester","PW":"pw","LT":null,"LANG":"en","DID":"0","AID":"1745592024940879420","KID":"","REF":"https://empire.goodgamestudios.com","GCI":"","SID":9,"PLFID":1}%')
        expect(sent.slice(7)).toEqual([NCH, ...CAPTURED_BURST])
        // The pin loop runs from the connection, so a login slower than one interval has a pin before its lli, as the capture has.
        expect(bot.sent.indexOf(PIN)).toBeLessThan(bot.sent.findIndex(m => m.includes("%lli%")))

        expect(sentAtOf("vln") - sentAtOf("vck")).toBeGreaterThanOrEqual(6000 * 0.05)
        expect(sentAtOf("lli") - sentAtOf("vln")).toBeGreaterThanOrEqual(8000 * 0.05)
        expect(sentAtOf("lli") - sentAtOf("vck")).toBeLessThan(90_000 * 0.05 / 2)
        expect(sentAtOf("nch") - sentAtOf("lli")).toBeGreaterThanOrEqual(2000 * 0.05)
        expect(sentAtOf("gcs") - sentAtOf("kli")).toBeGreaterThanOrEqual(6000 * 0.05)
    }, 15000)

    test("with login_sequence the login completes, and replies to the burst change nothing", async () => {
        bot = startBot({ humanize: { login_sequence: true } })
        await loginLikeTheGame()
        for (const cmd of ["vln", "gbl", "jaa", "alb", "sli", "gie", "asc", "sie", "ffi", "kli", "gcs"]) {
            bot.xt(cmd, 0)
            bot.xt(cmd, code("LORD_IS_USED"))
        }
        await bot.until(() => bot.loads === 1)
        await sleep(300)

        expect(withoutPins().slice(7)).toEqual(CAPTURED_BURST)
        expect(bot.toParent.some(m => m[0] === ActionType.Started)).toBe(true)
        expect(bot.heartbeats().at(-1).phase).toBe("running")
        expect(bot.loads).toBe(1)
        expect(bot.botStates()).toEqual([])
        expect(bot.exited).toBe(false)
    }, 15000)

    test("with login_sequence a second successful login does not send the burst again", async () => {
        bot = startBot({ humanize: { login_sequence: true } })
        await loginLikeTheGame()
        bot.xt("lli", 0)
        await sleep(600)

        expect(withoutPins().slice(7)).toEqual(CAPTURED_BURST)
    }, 15000)
})
