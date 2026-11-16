import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const gems = [{ gemID: 9 }]
const equipment = Array.from({ length: 30 }, (_, i) => [100 + i, 0, 0, 2, "", 0, 0, -1])

function start(options = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    const sentAt = []
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        sentAt.push([cmd, Date.now()])
        if (cmd == "gei") queueMicrotask(() => bot.xtHandler.emit("gei", { I: equipment }, 0))
        if (cmd == "ggm") queueMicrotask(() => bot.xtHandler.emit("ggm", { GEM: [[9, 50]] }, 0))
    }
    bot.botConfig.plugins.sellStoredEquipment = { sellStartDelayMinutes: "2", sellMaxPerRun: "20", ...options }
    loadModule("plugins/sellStoredEquipment.js", { bot, items: { gems } })
    bot.events.emit("load")
    return { sentAt, t0: Date.now() }
}

const sales = sentAt => sentAt.filter(([cmd]) => cmd == "seq" || cmd == "sge")

test("waits the start delay, spaces sells at least 2 s apart, and caps each run", async () => {
    const { sentAt, t0 } = start()
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1)
    expect(sentAt).toEqual([])
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 20 * 6_000)
    const first = sales(sentAt)
    expect(first).toHaveLength(20)
    expect(first[0][1] - t0).toBeGreaterThanOrEqual(2 * 60_000)
    for (let i = 1; i < first.length; i++)
        expect(first[i][1] - first[i - 1][1]).toBeGreaterThanOrEqual(2000)
})

test("a run in progress never overlaps the next one", async () => {
    const { sentAt } = start({ sellMaxPerRun: "50" })
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 60_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const s = sales(sentAt)
    for (let i = 1; i < s.length; i++)
        expect(s[i][1] - s[i - 1][1]).toBeGreaterThanOrEqual(2000)
})

test("the remainder waits for the next run", async () => {
    const { sentAt } = start()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    const s = sales(sentAt)
    expect(s.length).toBeGreaterThan(20)
    expect(sentAt.filter(([cmd]) => cmd == "gei").length).toBeGreaterThan(1)
})
