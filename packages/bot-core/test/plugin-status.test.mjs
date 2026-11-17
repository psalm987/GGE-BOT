import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")

afterEach(() => vi.restoreAllMocks())

function hostPort() {
    const messages = []
    return { messages, port: { postMessage: message => messages.push(message), on() {} } }
}

function attackEngine(options = {}) {
    const bot = fakeBot()
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0", ...options }
    const host = hostPort()
    const { mod } = loadModule("plugins/attack/attack.js", { bot, parentPort: host.port, extra: { "protocols": { resources: {} } } })
    const statuses = () => host.messages.filter(([type]) => type == PluginStatus).map(([, report]) => report)
    return { ...mod, bot, statuses }
}

describe("a plugin's status reports", () => {
    test("reach the runner named after the plugin's file, and a repeat of the last one is not sent", () => {
        const host = hostPort()
        const { mod } = loadModule("pluginStatus.js", { parentPort: host.port })
        const reportStatus = mod.statusReporter("/bot/plugins/attack/attackForeign.js")

        reportStatus("waiting", "statusEventClosed")
        reportStatus("waiting", "statusEventClosed")
        reportStatus("running")
        reportStatus("stopped", "statusScoreReached", { score: 900 })

        expect(host.messages).toEqual([
            [PluginStatus, { plugin: "attackForeign", state: "waiting", reasonKey: "statusEventClosed", params: {} }],
            [PluginStatus, { plugin: "attackForeign", state: "running", reasonKey: null, params: {} }],
            [PluginStatus, { plugin: "attackForeign", state: "stopped", reasonKey: "statusScoreReached", params: { score: 900 } }],
        ])
    })

    test("the attack engine reports the day's attacks in steps of 50, and waits once the limit is reached", () => {
        const { bot, statuses } = attackEngine({ attackLimit: "3500" })

        bot.xtHandler.emit("gai", { AC: 1240, ACTH: 9999 }, 0)
        bot.xtHandler.emit("gai", { AC: 1249, ACTH: 9999 }, 0)
        bot.xtHandler.emit("gai", { AC: 3500, ACTH: 9999 }, 0)

        expect(statuses()).toEqual([
            { plugin: "attack", state: "running", reasonKey: "statusAttacksToday", params: { used: 1200, limit: 3500 } },
            { plugin: "attack", state: "waiting", reasonKey: "statusDailyLimitReached", params: { limit: 3500 } },
        ])
    })
})

describe("a dry-run attack", () => {
    test("sends no cra and logs the one it would have sent", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {})
        const { sendAttack, bot } = attackEngine()
        const attackInfo = { SX: 1, SY: 2, TX: 10, TY: 20, KID: 0, LID: 5, A: [], AST: [-1, -1, -1] }

        const result = await sendAttack(attackInfo, 0, 10, 20, { level: 50, dryRun: true })

        expect(bot.sent.map(([cmd]) => cmd)).not.toContain("cra")
        expect(result).toEqual({ dryRun: true })
        expect(log).toHaveBeenCalledWith("dryRunAttack", JSON.stringify(attackInfo))
    })
})
