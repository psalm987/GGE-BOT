import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

function fakeDiscord() {
    const puts = []
    class Client extends EventEmitter {
        user = { setActivity() {} }
        login() { setImmediate(() => this.emit("ready")) }
    }
    class Collection extends Map {
        map(f) { return [...this.values()].map(f) }
    }
    class REST {
        setToken() { return this }
        async put(...args) { puts.push(args) }
    }
    return {
        puts,
        module: {
            Client, REST, Collection,
            Events: { ClientReady: "ready", Error: "error", InteractionCreate: "interactionCreate" },
            GatewayIntentBits: {},
            Routes: { applicationGuildCommands: (app, guild) => `/applications/${app}/guilds/${guild}/commands` },
        },
    }
}

test("an account without a Discord server skips registering commands", async () => {
    const discord = fakeDiscord()
    const { mod, bot } = loadModule("plugins/discord/discord.js", { extra: { "discord.js": discord.module } })
    mod.commands.set("ping", { data: { toJSON: () => ({ name: "ping" }) } })
    await mod.clientReady

    bot.events.emit("load")
    await new Promise(r => setTimeout(r, 50))

    expect(discord.puts).toEqual([])
})

test("an account with a Discord server registers its commands there", async () => {
    const discord = fakeDiscord()
    const { mod, bot } = loadModule("plugins/discord/discord.js", { extra: { "discord.js": discord.module } })
    bot.botConfig.discordData = { discordGuildId: "42" }
    mod.commands.set("ping", { data: { toJSON: () => ({ name: "ping" }) } })
    await mod.clientReady

    bot.events.emit("load")
    await new Promise(r => setTimeout(r, 50))

    expect(discord.puts).toEqual([["/applications/undefined/guilds/42/commands", { body: [{ name: "ping" }] }]])
})
