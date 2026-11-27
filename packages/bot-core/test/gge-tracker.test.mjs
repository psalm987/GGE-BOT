import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { GgeTracker: ACTION } = require("../actions.json")

afterEach(() => vi.useRealTimers())

/** The worker's tracker client, with the runner's end of the port: `posted` holds what the worker sent, `reply` answers it. */
function client(consent) {
    const bot = fakeBot()
    if (consent)
        bot.botConfig.plugins.ggeTracker = consent
    const posted = []
    const listeners = []
    const parentPort = { postMessage: message => posted.push(message), on: (event, listener) => event == "message" && listeners.push(listener) }
    const { mod } = loadModule("plugins/ggeTracker.js", { bot, parentPort })
    const reply = body => listeners.forEach(listener => listener([ACTION, body]))
    return { askTracker: mod.askTracker, posted, reply, bot }
}

test("the account setting is two checkboxes, both off, the name shown only under a ticked first box", () => {
    const { mod } = loadModule("plugins/ggeTracker.js", { mainThread: true })
    expect(mod.force).toBe(true)
    expect(mod.pluginOptions).toEqual([
        { type: "Checkbox", key: "useTimetables", default: false },
        { type: "Checkbox", key: "includePlayerName", default: false, showWhen: { key: "useTimetables", in: [1] } },
    ])
})

test.each([[undefined], [{}], [{ useTimetables: false, includePlayerName: true }]])("with the box off (%j) a plugin is told so and nothing goes to the runner", async consent => {
    const { askTracker, posted } = client(consent)
    expect(await askTracker({ kind: "stormForts" })).toEqual({ ok: false, error: "off" })
    expect(posted).toEqual([])
})

test("with the box on the request goes to the runner, without the player's name, and its answer comes back", async () => {
    const { askTracker, posted, reply } = client({ useTimetables: true, includePlayerName: true })
    const asked = askTracker({ kind: "fortresses", kingdom: 2 })
    expect(posted).toEqual([[ACTION, { id: 1, kind: "fortresses", kingdom: 2 }]])
    reply({ id: 99, ok: true, kind: "fortresses", fortresses: [] })
    reply({ id: 1, ok: true, kind: "fortresses", server: "IN1", fetchedAt: 5, withName: true, fortresses: [{ x: 1, y: 2, availableAt: 3 }] })
    expect(await asked).toEqual({ id: 1, ok: true, kind: "fortresses", server: "IN1", fetchedAt: 5, withName: true, fortresses: [{ x: 1, y: 2, availableAt: 3 }] })
})

test("unticking the box while the bot runs stops the next request", async () => {
    const { askTracker, posted, bot } = client({ useTimetables: true })
    void askTracker({ kind: "stormForts" })
    bot.botConfig.plugins.ggeTracker.useTimetables = false
    expect(await askTracker({ kind: "stormForts" })).toEqual({ ok: false, error: "off" })
    expect(posted).toHaveLength(1)
})

test("a runner that doesn't answer within 30 seconds counts as no timetable", async () => {
    vi.useFakeTimers()
    const { askTracker } = client({ useTimetables: true })
    const asked = askTracker({ kind: "stormForts" })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await asked).toEqual({ ok: false, error: "noAnswer" })
})
