import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"
import { PLUGIN_MEMORY_MAX_BYTES } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginMemory, PluginFinished } = require("../actions.json")

function hostPort() {
    const messages = []
    return { messages, port: { postMessage: message => messages.push(message), on() {} } }
}

function memoryOf(filename, pluginMemory) {
    const host = hostPort()
    const bot = fakeBot()
    if (pluginMemory)
        bot.botConfig.pluginMemory = pluginMemory
    const { mod } = loadModule("pluginMemory.js", { bot, parentPort: host.port })
    return { memory: mod.pluginMemory(filename), messages: host.messages, mod }
}

describe("a plugin's memory", () => {
    test("starts as the runner handed it for the plugin named after the file, and each change is sent to the runner", () => {
        const { memory, messages } = memoryOf("/bot/plugins/bladeCoast.js", { bladeCoast: { closedMaps: [22] }, other: { closedMaps: [99] } })

        expect(memory.get("closedMaps")).toEqual([22])
        expect(memory.get("eventEndsAt")).toBeUndefined()
        expect(memory.set("closedMaps", [22, 27])).toBe(true)
        expect(memory.set("eventEndsAt", 1_900_000_000_000)).toBe(true)
        expect(memory.set("closedMaps", null)).toBe(true)

        expect(memory.get("closedMaps")).toBeUndefined()
        expect(memory.get("eventEndsAt")).toBe(1_900_000_000_000)
        expect(messages).toEqual([
            [PluginMemory, { plugin: "bladeCoast", key: "closedMaps", value: [22, 27] }],
            [PluginMemory, { plugin: "bladeCoast", key: "eventEndsAt", value: 1_900_000_000_000 }],
            [PluginMemory, { plugin: "bladeCoast", key: "closedMaps", value: null }],
        ])
    })

    test("is empty when the runner handed none", () => {
        const { memory } = memoryOf("/bot/plugins/bladeCoast.js")
        expect(memory.get("closedMaps")).toBeUndefined()
    })

    test("keeps a copy, so changing the value afterwards changes nothing kept", () => {
        const { memory } = memoryOf("/bot/plugins/bladeCoast.js")
        const maps = [22]
        memory.set("closedMaps", maps)
        maps.push(27)
        expect(memory.get("closedMaps")).toEqual([22])
    })

    test("refuses a value that would take the plugin past the runner's size cap, and sends nothing", () => {
        const { memory, messages } = memoryOf("/bot/plugins/bladeCoast.js")
        expect(memory.set("a", "x".repeat(PLUGIN_MEMORY_MAX_BYTES / 2))).toBe(true)
        expect(memory.set("b", "y".repeat(PLUGIN_MEMORY_MAX_BYTES / 2))).toBe(false)

        expect(memory.get("b")).toBeUndefined()
        expect(messages).toHaveLength(1)
    })
})

describe("a plugin that is done", () => {
    test("tells the runner once, named after its file", () => {
        const host = hostPort()
        const { mod } = loadModule("pluginStatus.js", { parentPort: host.port })
        mod.finishPlugin("/bot/plugins/bladeCoast.js")
        mod.finishPlugin("/bot/plugins/bladeCoast.js")
        expect(host.messages).toEqual([[PluginFinished, { plugin: "bladeCoast" }]])
    })
})
