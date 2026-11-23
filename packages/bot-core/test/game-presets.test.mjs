import { createRequire } from "node:module"
import { describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const capture = require("./fixtures/protocol/presets-20261122.json")
const ActionType = require("../actions.json")

/** gamePresets.js on a stand-in game that answers `gas` with `reply`, or never when `reply` is undefined. */
function load(reply) {
    const bot = fakeBot()
    const posted = []
    const record = bot.sendXT
    bot.sendXT = async (command, params) => {
        await record(command, params)
        if (command == "gas" && reply !== undefined)
            setImmediate(() => bot.xtHandler.emit("gas", reply, 0))
    }
    const { mod } = loadModule("gamePresets.js", { bot, parentPort: { postMessage: message => posted.push(message), on() {} } })
    return { mod, bot, posted }
}
const plan = (...presets) => ({ mode: "waves", waves: { kind: "manual", waves: presets.map(preset => ({ kind: "preset", preset })), ast: [null, null, null], rw: Array(8).fill(null) } })

describe("the presets the game lists", () => {
    test("go to the app in the bot's status by number and name, once per change", () => {
        const { bot, posted } = load()
        bot.xtHandler.emit("gas", capture.gas.reply, 0)
        bot.xtHandler.emit("gas", capture.gas.reply, 0)
        expect(bot.status.gamePresets).toEqual([{ preset: 1, name: "shield" }, { preset: 2, name: "wall+moat" }, { preset: 3, name: "sand fire" }, { preset: 4, name: "samu" }])
        expect(posted.filter(([type]) => type == ActionType.StatusUser)).toHaveLength(1)
    })

    test("a refused reply changes nothing", () => {
        const { bot, posted } = load()
        bot.xtHandler.emit("gas", {}, 1)
        expect(bot.status.gamePresets).toBeUndefined()
        expect(posted).toEqual([])
    })
})

describe("a plan that names in-game presets", () => {
    test("reads the list first when it hasn't been read, then goes ahead when the game lists them", async () => {
        const { mod, bot } = load(capture.gas.reply)
        const report = vi.fn()
        expect(await mod.presetsListed(plan(1, 4), report)).toBe(true)
        expect(bot.sent).toEqual([["gas", {}]])
        expect(report).not.toHaveBeenCalled()
    })

    test("stops with the reason when the game doesn't list one", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const { mod } = load(capture.gas.reply)
        const report = vi.fn()
        expect(await mod.presetsListed(plan(2, 7), report)).toBe(false)
        expect(report).toHaveBeenCalledWith("error", "statusArmyServerPreset", { preset: 7 })
    })

    test("autofill, or a plan without presets, asks the game nothing", async () => {
        const { mod, bot } = load(capture.gas.reply)
        expect(await mod.presetsListed({ mode: "autofill" }, vi.fn())).toBe(true)
        expect(await mod.presetsListed(plan(0), vi.fn())).toBe(true)
        expect(bot.sent).toEqual([])
    })
})
