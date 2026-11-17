import { createRequire } from "node:module"
import { MessageChannel, Worker } from "node:worker_threads"
import { afterEach, expect, test, vi } from "vitest"
import { DiscordHub } from "../src/discord-hub.ts"
import { FakeDiscord } from "./fixtures/fake-discord.ts"

const require = createRequire(import.meta.url)
const pluginWorker = require.resolve("@gge/bot-core/test/harness/discord-worker.cjs")
const Action = require("@gge/bot-core/actions.json") as Record<string, number>

let worker: Worker | undefined
let hub: DiscordHub | undefined

afterEach(async () => {
    await worker?.terminate()
    await hub?.stop()
})

test("a bot's chat plugin bridges game chat and a Discord channel through the runner's one client", async () => {
    const client = new FakeDiscord()
    const channel = client.channel("1")
    const created = vi.fn(() => client)
    hub = new DiscordHub({ token: "token", createClient: created, logger: { log() {}, warn() {}, error() {} } })
    hub.start()

    const { port1: control, port2 } = new MessageChannel()
    const fromBot: { type: string; cmd?: string; params?: unknown; files?: string[] }[] = []
    control.on("message", message => fromBot.push(message))
    const bot = worker = new Worker(pluginWorker, {
        workerData: { name: "TheBot", plugins: { chat: { channelID: "1" } }, plugin: "plugins/discord/chat.js", ggeConfig: { discordHub: true }, control: port2 },
        transferList: [port2],
    })
    bot.on("message", ([type, payload]: [number, unknown]) => {
        if (type === Action.Discord)
            hub!.request(bot, payload)
    })

    // The plugin listens to the game only once it has the channel, so the line is repeated until it lands.
    await vi.waitFor(() => {
        control.postMessage({ type: "game", cmd: "acm", data: { CM: { PN: "Bob", MT: "to arms" } } })
        expect(channel.log.length).toBeGreaterThan(0)
    }, { timeout: 10_000, interval: 100 })
    expect(channel.log[0]).toMatchObject({ content: "Bob: to arms", author: { id: "999" } })

    channel.receive("on my way", { id: "501", bot: false, displayName: "Ada" }, { nickname: "Countess", displayHexColor: "#aa00ff" })
    await vi.waitFor(() => expect(fromBot.filter(m => m.type === "sent")).toHaveLength(1))
    expect(fromBot.find(m => m.type === "sent")).toEqual({ type: "sent", cmd: "acm", params: { M: "<color=#aa00ff>Countess<color>:  on my way" } })

    control.postMessage({ type: "discordModules" })
    await vi.waitFor(() => expect(fromBot.find(m => m.type === "discordModules")).toEqual({ type: "discordModules", files: [] }))
    expect(created).toHaveBeenCalledTimes(1)

    control.close()
})
