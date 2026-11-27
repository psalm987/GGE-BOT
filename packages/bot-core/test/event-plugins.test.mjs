import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginFinished } = require("../actions.json")

afterEach(() => vi.useRealTimers())

const BLADE_COAST = 4

/** A bot with Blade Coast (event-only, event 4) and Feast switched on, watching its event plugins. */
function eventPluginBot() {
    vi.useFakeTimers()
    const messages = []
    const bot = fakeBot()
    bot.botConfig.plugins = {
        bladeCoast: { state: true, filename: "plugins/bladeCoast", eventOnly: BLADE_COAST },
        feast: { state: true, filename: "plugins/feast" },
    }
    loadModule("eventPlugins.js", { bot, parentPort: { postMessage: message => messages.push(message), on() {} } })
    const list = async (...E) => {
        bot.xtHandler.emit("sei", { E }, 0)
        await vi.advanceTimersByTimeAsync(0)
    }
    const load = async () => {
        bot.events.emit("load")
        await vi.advanceTimersByTimeAsync(0)
    }
    const finished = () => messages.filter(([type]) => type == PluginFinished).map(([, payload]) => payload)
    return { list, load, finished }
}

describe("an event-only plugin", () => {
    test("is done once the game's event list is in without its event, and only it", async () => {
        const { list, load, finished } = eventPluginBot()
        await list({ EID: 72, RS: 3600 })
        expect(finished()).toEqual([])

        await load()

        expect(finished()).toEqual([{ plugin: "bladeCoast", reason: "eventOver" }])
    })

    test("runs while its event does, and is done when the event stops", async () => {
        const { list, load, finished } = eventPluginBot()
        await list({ EID: BLADE_COAST, RS: 3600 })
        await load()
        expect(finished()).toEqual([])

        await list({ EID: 72, RS: 3600 })

        expect(finished()).toEqual([{ plugin: "bladeCoast", reason: "eventOver" }])
    })

    test("waits for the event list when the bot loaded without one", async () => {
        const { list, load, finished } = eventPluginBot()
        await load()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(finished()).toEqual([])

        await list({ EID: 72, RS: 3600 })

        expect(finished()).toEqual([{ plugin: "bladeCoast", reason: "eventOver" }])
    })
})
