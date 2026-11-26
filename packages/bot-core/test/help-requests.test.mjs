import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const ME = 7, OTHER = 8
const RECRUIT = 6
const helpTypes = [{ allianceHelpRequestID: RECRUIT, maxHelpersCount: 3 }]

function run(options = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerID = ME
    bot.botConfig.plugins.helpRequests = options
    loadModule("plugins/helpRequests.js", { bot, items: { alliancehelprequests: helpTypes } })
    const presses = () => bot.sent.filter(([cmd]) => cmd == "aha")
    const push = (cmd, body) => bot.xtHandler.emit(cmd, body, 0)
    return { bot, presses, push }
}

const request = (fields = {}) => ({ LID: 1, PID: OTHER, TID: RECRUIT, P: 0, AC: 0, RT: 3600, ...fields })
const WAIT = 3 * 60_000

test("helps another member's open request", async () => {
    const { presses, push } = run()
    push("ahh", request())
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toEqual([["aha", { KID: 15 }]])
})

test.each([
    ["my own request", request({ PID: ME })],
    ["a request I already helped", request({ AC: 1 })],
    ["a request with all the helpers it takes", request({ P: 3 })],
])("never presses for %s", async (_name, body) => {
    const { presses, push } = run()
    push("ahh", body)
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toEqual([])
})

test("never presses for a request that ran out before the press", async () => {
    const { presses, push } = run()
    push("ahh", request({ RT: 30 }))
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toEqual([])
})

test("a request the game removed is not helped", async () => {
    const { presses, push } = run()
    push("ahh", request())
    push("ahd", { LID: 1 })
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toEqual([])
})

test("helps the open requests in the list the game sends at login", async () => {
    const { presses, push } = run()
    push("ahl", { AHL: [request({ LID: 1, PID: ME }), request({ LID: 2 })] })
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toHaveLength(1)
})

test("a new list replaces the old one", async () => {
    const { presses, push } = run()
    push("ahh", request({ LID: 1 }))
    push("ahl", { AHL: [request({ LID: 2, PID: ME })] })
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toEqual([])
})

test("the same requests are pressed for only once", async () => {
    const { presses, push } = run()
    push("ahh", request())
    await vi.advanceTimersByTimeAsync(WAIT)
    push("ahh", request({ P: 1 }))
    await vi.advanceTimersByTimeAsync(WAIT)
    expect(presses()).toHaveLength(1)
})

test("fast help presses within seconds", async () => {
    const { presses, push } = run({ fastHelp: true })
    push("ahh", request())
    await vi.advanceTimersByTimeAsync(5000)
    expect(presses()).toHaveLength(1)
})
