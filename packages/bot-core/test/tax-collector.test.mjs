import { createRequire } from "node:module"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot, repo } = require("./harness/load.cjs")
const { startBot } = require("./harness/bot-session.cjs")
const en = require("../locales/en.json")

const MINUTE = 60_000
const TXI = ["txi", {}], TXC = ["txc", { TR: 29 }], TXS = ["txs", { TT: 0, TX: 3 }]

afterEach(() => vi.useRealTimers())

/**
 * The plugin against a game whose answers come from `server`: a function from
 * a command to `[result, reply]`, or to nothing for silence.
 */
function loggedIn(server, { stopping = () => false } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot({ stopping })
    const sentAt = []
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        sentAt.push(Date.now())
        const answer = server(cmd)
        if (answer)
            setTimeout(() => bot.xtHandler.emit(cmd, answer[1] ?? {}, answer[0]), 300)
    }
    loadModule("plugins/taxCollector.js", { bot })
    const counted = () => {
        const batches = []
        require(path.join(repo, "metrics.js")).flush(batch => batches.push(batch))
        return batches.flatMap(batch => batch.counters)
    }
    bot.events.emit("load")
    return { bot, sentAt, counted, t0: Date.now() }
}

const ready = () => [0, {}]

test("the catalog entry is off by default and has no options", () => {
    const { mod } = loadModule("plugins/taxCollector.js", { mainThread: true })
    const entry = { key: "taxCollector", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions }
    expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
    expect(entry).toEqual({ key: "taxCollector", force: false, hidden: false, options: [] })
})

test.each(["taxCollector", "taxesCollected", "taxCollectorRefused"])("en.json names %s", key => {
    expect(en[key]).toEqual(expect.any(String))
})

test("with taxes waiting it reads the state, collects, and sends the collector out for 10 minutes", async () => {
    const { bot, sentAt, counted, t0 } = loggedIn(ready)
    await vi.advanceTimersByTimeAsync(2 * MINUTE - 1)
    expect(bot.sent).toEqual([])

    await vi.advanceTimersByTimeAsync(8 * MINUTE)
    expect(bot.sent).toEqual([TXI, TXC, TXS])
    expect(sentAt[0] - t0).toBeGreaterThanOrEqual(2 * MINUTE)
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(3000)
    expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(3000)
    expect(counted()).toEqual([["bot_tax_collect_total", { result: "collected" }, 1]])
})

test("the next cycle starts a few minutes after the run ends, at a different moment each time", async () => {
    const { bot, sentAt } = loggedIn(ready)
    await vi.advanceTimersByTimeAsync(4 * 60 * MINUTE)

    const cycles = []
    for (let i = 0; i < bot.sent.length; i += 3) {
        expect(bot.sent.slice(i, i + 3).map(([cmd]) => cmd)).toEqual(["txi", "txc", "txs"].slice(0, bot.sent.length - i))
        cycles.push(sentAt.slice(i, i + 3))
    }
    const waits = cycles.slice(1).filter(c => c.length == 3).map((c, i) => c[0] - cycles[i][2])
    expect(waits.length).toBeGreaterThan(8)
    for (const wait of waits) {
        expect(wait).toBeGreaterThanOrEqual(11 * MINUTE)
        expect(wait).toBeLessThanOrEqual(15 * MINUTE + 1000)
    }
    expect(new Set(waits).size).toBe(waits.length)
})

test.each([
    ["at the top level", { RT: 240 }],
    ["one object down", { TX: { RS: 240 } }],
])("while the collector is still out (%s) it neither collects nor sends, and comes back when he is due", async (_name, reply) => {
    let out = true
    const { bot, sentAt } = loggedIn(cmd => cmd == "txi" && out ? [0, reply] : [0, {}])
    await vi.advanceTimersByTimeAsync(6 * MINUTE + 1000)
    expect(bot.sent).toEqual([TXI])

    out = false
    await vi.advanceTimersByTimeAsync(12 * MINUTE)
    expect(bot.sent).toEqual([TXI, TXI, TXC, TXS])
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(240_000 + MINUTE)
    expect(sentAt[1] - sentAt[0]).toBeLessThanOrEqual(240_000 + 5 * MINUTE + 1000)
})

test("a number that never counts down is not taken for the collector's remaining time twice", async () => {
    const { bot } = loggedIn(cmd => cmd == "txi" ? [0, { RT: 240 }] : [0, {}])
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(bot.sent.slice(0, 4)).toEqual([TXI, TXI, TXC, TXS])
})

test("a collector who was never sent out refuses the collect and is sent out anyway", async () => {
    const { bot, counted } = loggedIn(cmd => cmd == "txc" ? [95] : [0])
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(bot.sent).toEqual([TXI, TXC, TXS])
    expect(counted()).toEqual([["bot_tax_collect_total", { result: "refused" }, 1]])
})

test.each([
    ["refuses txi", cmd => cmd == "txi" ? [95] : [0], 1],
    ["never answers txi", cmd => cmd == "txi" ? undefined : [0], 1],
    ["refuses txs", cmd => cmd == "txs" ? [95] : [0], 3],
    ["never answers txs", cmd => cmd == "txs" ? undefined : [0], 3],
])("a game that %s is asked less and less often, down to about hourly", async (_name, server, framesPerCycle) => {
    const { bot, sentAt } = loggedIn(server)
    await vi.advanceTimersByTimeAsync(8 * 60 * MINUTE)

    const starts = sentAt.filter((_, i) => bot.sent[i][0] == "txi")
    expect(bot.sent.length).toBeLessThanOrEqual(starts.length * framesPerCycle)
    const gaps = starts.slice(1).map((at, i) => at - starts[i])
    expect(gaps.length).toBeGreaterThanOrEqual(4)
    expect(gaps[0]).toBeGreaterThanOrEqual(11 * MINUTE)
    expect(gaps[1]).toBeGreaterThanOrEqual(21 * MINUTE)
    expect(gaps[2]).toBeGreaterThanOrEqual(41 * MINUTE)
    for (const gap of gaps)
        expect(gap).toBeLessThanOrEqual(68 * MINUTE)
    expect(new Set(gaps.slice(3)).size).toBe(gaps.length - 3)
    for (const cmd of ["txi", "txc", "txs"])
        expect(bot.xtHandler.listenerCount(cmd)).toBe(0)
})

test("a game that answers again is asked at the usual pace again", async () => {
    let refusing = true
    const { bot, sentAt } = loggedIn(cmd => refusing && cmd == "txi" ? [95] : [0])
    await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE)
    refusing = false
    await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE)

    const sends = sentAt.filter((_, i) => bot.sent[i][0] == "txs")
    expect(sends.length).toBeGreaterThan(5)
    expect(sends.at(-1) - sends.at(-2)).toBeLessThanOrEqual(16 * MINUTE)
})

test("unload stops the timers", async () => {
    const { bot } = loggedIn(ready)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(bot.sent).toEqual([TXI, TXC, TXS])
    bot.events.emit("unload")
    await vi.advanceTimersByTimeAsync(24 * 60 * MINUTE)
    expect(bot.sent).toEqual([TXI, TXC, TXS])
    expect(vi.getTimerCount()).toBe(0)
})

test("a bot that starts stopping after txi sends neither txc nor txs", async () => {
    let stopping = false
    const { bot } = loggedIn(cmd => { stopping = cmd == "txi"; return [0] }, { stopping: () => stopping })
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(bot.sent).toEqual([TXI])
})

describe("in the real bot", () => {
    let bot
    afterEach(() => bot?.stop())

    test("a game that never answers the tax collector costs the bot none of its six timeouts", async () => {
        bot = startBot({ plugins: { taxCollector: { state: true, filename: "plugins/taxCollector.js" } } })
        await bot.login()
        bot.xt("lli", 0)
        await bot.until(() => bot.sentXT("txi").length === 1, 15_000)
        await new Promise(resolve => setTimeout(resolve, 1000))

        for (let i = 0; i < 5; i++) {
            const { done } = await bot.startWaitForResult("tst", 100)
            expect((await done).error).toBe("TIMED_OUT")
        }
        await new Promise(resolve => setTimeout(resolve, 300))
        expect(bot.sentXT("txi")).toEqual(["%xt%EmpireEx_1%txi%1%{}%"])
        expect(bot.sentXT("txc")).toEqual([])
        expect(bot.exited).toBe(false)
        expect(bot.botStates()).toEqual([])
    }, 30_000)
})
