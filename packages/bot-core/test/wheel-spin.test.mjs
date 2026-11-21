import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")
const captured = require("./fixtures/protocol/daily-20261121.json").lws_1

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const AFFLUENCE = 89, CLASSIC = 15

const currencies = [
    { Name: "LuckyWheelTicket", JSONKey: "LWT" },
    { Name: "SaleDaysLuckyWheelTicket", JSONKey: "SLWT" },
]

afterEach(() => vi.useRealTimers())

/** The entry the game's event list holds for a running wheel, as captured for event 89. */
const wheelEvent = (EID, RS = 11 * 3600, extra = {}) => ({ EID, RS, OP: [0], OR: [-1], CWC: 1, WCP: 0, HFS: 0, HVPM: 0, JSID: 2, JHID: 2, PMA: 0, ...extra })

/**
 * The plugin, logged in at 10:00 UTC, against a game that holds `tickets` ([SLWT, LWT]) and answers each `lws` the way
 * the capture did: the ticket count drops, comes back by the prize, then the reply. `prize` is what a spin wins,
 * `answer` replaces the reply's result code (or silences it with null).
 */
function run({ options = {}, tickets = [12, 0], events = [wheelEvent(AFFLUENCE)], prize = ["SLWT", 1], answer = 0, extra = {}, stopping = () => false } = {}) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-21T10:00:00Z"))
    const bot = fakeBot({ stopping })
    bot.botConfig.plugins.wheelSpin = { state: true, ...options }
    const held = { SLWT: tickets[0], LWT: tickets[1] }
    const reports = [], logs = [], sentAt = []
    const cost = { 0: ["LWT", 30], 1: ["SLWT", 1] }
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        sentAt.push(Date.now())
        if (cmd != "lws" || answer === null)
            return
        const [key, price] = cost[p.LWET]
        setTimeout(() => {
            if (answer == 0) {
                held[key] -= price
                bot.xtHandler.emit("sce", [[key, held[key]]], 0)
                if (prize[0] == key) {
                    held[key] += prize[1]
                    bot.xtHandler.emit("sce", [[key, held[key]]], 0)
                }
            }
            bot.xtHandler.emit("lws", answer == 0 ? { ...captured.reply.payload, LWET: p.LWET, R: [prize], ...extra } : {}, answer)
        }, 300)
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args))
    loadModule("plugins/wheelSpin.js", { bot, parentPort, items: { currencies } })
    bot.events.emit("load")
    bot.xtHandler.emit("sce", [["SLWT", held.SLWT], ["LWT", held.LWT]], 0)
    bot.xtHandler.emit("sei", { E: events }, 0)
    const spins = () => bot.sent.filter(([cmd]) => cmd == "lws").map(([, p]) => p)
    return { bot, spins, held, logs, sentAt, status: () => reports.at(-1) }
}

describe("the catalog entry", () => {
    test("is accepted by the API and off by default, with only the captured wheel on and no limits", () => {
        const { mod } = loadModule("plugins/wheelSpin.js", { mainThread: true })
        const entry = { key: "wheelSpin", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(entry.force).toBe(false)
        expect(Object.fromEntries(mod.pluginOptions.map(o => [o.key, o.default]))).toEqual({ wheelClassic: false, wheelAffluence: true, wheelKeepTickets: 0, wheelMaxPerDay: 0 })
    })

    test.each([
        "wheelSpin", "wheelSpin.description", "wheelClassic", "wheelAffluence", "wheelKeepTickets", "wheelMaxPerDay",
        "wheelSpin.wheelClassic.help", "wheelSpin.wheelAffluence.help", "wheelSpin.wheelKeepTickets.help", "wheelSpin.wheelMaxPerDay.help",
        "statusWheelSpinStarting", "statusWheelSpinBothOff", "statusWheelSpinNoWheel", "statusWheelSpinNoTickets", "statusWheelSpinDayLimit",
        "statusWheelSpinProMode", "statusWheelSpinRefused", "statusWheelSpinSpun", "wheelSpinPrize", "wheelSpinRefused", "wheelSpinNoReply",
    ])("en.json names %s", key => {
        expect(en[key]).toEqual(expect.any(String))
    })
})

describe("a spin", () => {
    test("is the captured request, sent a few minutes after login, and the prize is logged", async () => {
        const { spins, logs, held } = run({ options: { wheelMaxPerDay: 1 } })
        await vi.advanceTimersByTimeAsync(2 * MINUTE)
        expect(spins()).toEqual([])

        await vi.advanceTimersByTimeAsync(HOUR)
        expect(spins()).toEqual([captured.payload])
        expect(logs).toContainEqual(["wheelSpinPrize", "SLWT x1"])
        expect(held.SLWT).toBe(12)
    })

    test("is one ticket at a time, with a pause between spins", async () => {
        const { spins, sentAt } = run({ options: { wheelClassic: false }, prize: ["STO", 1000] })
        await vi.advanceTimersByTimeAsync(20 * MINUTE)
        expect(spins().length).toBe(12)
        const gaps = sentAt.slice(1).map((at, i) => at - sentAt[i])
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4000)
    })
})

describe("the tickets to keep", () => {
    test("stop the spinning at the count, counting the cost of one more spin", async () => {
        const { spins, held } = run({ options: { wheelKeepTickets: 10 }, prize: ["STO", 1000] })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(spins().length).toBe(2)
        expect(held.SLWT).toBe(10)
    })

    test("keep every ticket when the count is not above the cost of a spin", async () => {
        const { spins, status } = run({ tickets: [5, 0], options: { wheelKeepTickets: 5 }, prize: ["STO", 1000] })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(spins()).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusWheelSpinNoTickets", params: { keep: 5 } })
    })

    test("wait until the game has said how many tickets there are", async () => {
        const { spins, bot } = run({ tickets: [NaN, 0] })
        bot.xtHandler.removeAllListeners("sce")
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(spins()).toEqual([])
    })
})

describe("only while a wheel event runs", () => {
    test.each([
        ["no wheel event is listed", [{ EID: 101, RS: 40000 }]],
        ["the wheel has under a minute left", [wheelEvent(AFFLUENCE, 45)]],
        ["the wheel is in Pro mode", [wheelEvent(AFFLUENCE, 11 * 3600, { PMA: 1 })]],
    ])("nothing is sent when %s", async (_name, events) => {
        const { spins } = run({ events })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(spins()).toEqual([])
    })

    test("spinning stops when the event's own end time passes, even if the list is never refreshed", async () => {
        const { spins } = run({ events: [wheelEvent(AFFLUENCE, 20 * 60)], tickets: [500, 0], prize: ["STO", 1000], options: { wheelKeepTickets: 0 } })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        const count = spins().length
        expect(count).toBeGreaterThan(0)
        await vi.advanceTimersByTimeAsync(5 * HOUR)
        expect(spins().length).toBe(count)
    })

    test("an event that leaves the list stops the spinning, and its return starts it again", async () => {
        const { spins, bot } = run({ tickets: [500, 0], options: { wheelMaxPerDay: 3 }, prize: ["STO", 1000] })
        bot.xtHandler.emit("sei", { E: [] }, 0)
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(spins()).toEqual([])

        bot.xtHandler.emit("sei", { E: [wheelEvent(AFFLUENCE)] }, 0)
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(spins().length).toBe(3)
    })
})

describe("the classic wheel", () => {
    test("is spun with LWET 0 and its own tickets, 30 a spin", async () => {
        const { spins, held } = run({ options: { wheelClassic: true, wheelAffluence: false }, tickets: [0, 65], events: [wheelEvent(CLASSIC)], prize: ["STO", 1000] })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(spins()).toEqual([{ LWET: 0 }, { LWET: 0 }])
        expect(held.LWT).toBe(5)
    })

    test("stays off when the player never set it, since no spin of it has been captured", async () => {
        const { spins } = run({ tickets: [0, 65], events: [wheelEvent(CLASSIC)] })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(spins()).toEqual([])
    })

    test("is left alone when it is switched off, and so is the other wheel", async () => {
        const { spins } = run({ options: { wheelClassic: false }, tickets: [0, 65], events: [wheelEvent(CLASSIC), wheelEvent(AFFLUENCE)] })
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(spins()).toEqual([])
    })

    test("both off sends nothing and says so", async () => {
        const { spins, status } = run({ options: { wheelClassic: false, wheelAffluence: false } })
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(spins()).toEqual([])
        expect(status().reasonKey).toBe("statusWheelSpinBothOff")
    })
})

describe("the daily limit", () => {
    test("caps the spins and starts again after midnight UTC", async () => {
        const { spins, status } = run({ tickets: [500, 0], options: { wheelMaxPerDay: 4 }, prize: ["STO", 1000], events: [wheelEvent(AFFLUENCE, 40 * 3600)] })
        await vi.advanceTimersByTimeAsync(10 * HOUR)
        expect(spins().length).toBe(4)
        expect(status()).toMatchObject({ reasonKey: "statusWheelSpinDayLimit", params: { limit: 4 } })

        await vi.advanceTimersByTimeAsync(6 * HOUR)
        expect(spins().length).toBe(8)
    })
})

describe("a refusal or silence", () => {
    test.each([["an error reply", 95], ["no reply", null]])("%s ends the run after one spin", async (_name, answer) => {
        const { spins, status } = run({ answer, tickets: [500, 0] })
        await vi.advanceTimersByTimeAsync(40 * MINUTE)
        expect(spins().length).toBe(1)
        expect(status().reasonKey).toBe("statusWheelSpinRefused")
    })
})

describe("what the bot never sends", () => {
    test("a reply that puts the wheel in Pro mode ends the spinning, and no mode change or jackpot is sent", async () => {
        const { spins, bot, status } = run({ tickets: [500, 0], prize: ["STO", 1000], extra: { PMA: 1 } })
        await vi.advanceTimersByTimeAsync(3 * HOUR)
        expect(spins().length).toBe(1)
        expect(bot.sent.map(([cmd]) => cmd).filter(cmd => cmd != "lws")).toEqual([])
        expect(status().reasonKey).toBe("statusWheelSpinProMode")
    })

    test("only lws is ever sent, with both wheels running and every option on", async () => {
        const { bot } = run({ options: { wheelClassic: true }, tickets: [20, 90], events: [wheelEvent(CLASSIC), wheelEvent(AFFLUENCE)], prize: ["STO", 1000] })
        await vi.advanceTimersByTimeAsync(6 * HOUR)
        expect(bot.sent.length).toBeGreaterThan(0)
        expect(new Set(bot.sent.map(([cmd]) => cmd))).toEqual(new Set(["lws"]))
    })
})

describe("lifecycle", () => {
    test("after unload nothing is sent", async () => {
        const { spins, bot } = run()
        bot.events.emit("unload")
        await vi.advanceTimersByTimeAsync(24 * HOUR)
        expect(spins()).toEqual([])
    })

    test("a bot that is stopping sends nothing", async () => {
        const { spins } = run({ stopping: () => true })
        await vi.advanceTimersByTimeAsync(24 * HOUR)
        expect(spins()).toEqual([])
    })
})
