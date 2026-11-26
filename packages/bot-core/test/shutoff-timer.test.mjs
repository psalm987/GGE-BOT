import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { KillBot } = require("../actions.json")

const HOUR = 60 * 60_000
/** setTimeout fires at once for a delay above this, about 596 hours. */
const TIMER_MAX = 2 ** 31 - 1

afterEach(() => vi.useRealTimers())

function start(hours) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.shutoffTimer = { hours }
    const kills = []
    const parentPort = { postMessage: message => message[0] == KillBot && kills.push(Date.now()), on() {} }
    vi.spyOn(console, "error").mockImplementation(() => {})
    loadModule("plugins/shutoffTimer.js", { bot, parentPort })
    const t0 = Date.now()
    bot.events.emit("load")
    return { kills, t0 }
}

test("stops the bot after the hours set", async () => {
    const { kills, t0 } = start("2")
    await vi.advanceTimersByTimeAsync(2 * HOUR - 1)
    expect(kills).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(kills).toEqual([t0 + 2 * HOUR])
})

test.each(["", "-3", "0"])("a value of %j is off and never stops the bot", async hours => {
    const { kills } = start(hours)
    await vi.advanceTimersByTimeAsync(1000 * HOUR)
    expect(kills).toEqual([])
})

test("a value past what a timer holds waits the longest a timer can, instead of stopping at once", async () => {
    const { kills, t0 } = start("1000")
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(kills).toEqual([])
    await vi.advanceTimersByTimeAsync(TIMER_MAX)
    expect(kills).toEqual([t0 + TIMER_MAX])
})
