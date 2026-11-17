import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { fakeDiscordHub } = require("./harness/fake-discord-hub.cjs")

// The legacy host (main.js) has no Discord hub: each of its bots logs in itself and registers slash commands.

function fakeDiscord() {
    const puts = []
    const logins = []
    class Client extends EventEmitter {
        user = { setActivity() {} }
        login(token) {
            logins.push(token)
            setImmediate(() => this.emit("ready"))
        }
    }
    class Collection extends Map {
        map(f) { return [...this.values()].map(f) }
    }
    class REST {
        setToken() { return this }
        async put(...args) { puts.push(args) }
    }
    return {
        puts, logins,
        module: {
            Client, REST, Collection,
            Events: { ClientReady: "ready", Error: "error", InteractionCreate: "interactionCreate" },
            GatewayIntentBits: {},
            Routes: { applicationGuildCommands: (app, guild) => `/applications/${app}/guilds/${guild}/commands` },
        },
    }
}

function legacyBot() {
    const bot = fakeBot()
    bot.botConfig.ggeConfig = { discordToken: "legacy-token", discordClientId: "app" }
    return bot
}

test("on the legacy host a bot logs in with the host's token", async () => {
    const discord = fakeDiscord()
    const { mod } = loadModule("plugins/discord/discord.js", { bot: legacyBot(), extra: { "discord.js": discord.module } })

    expect(await mod.clientReady).toBe(mod.client)
    expect(discord.logins).toEqual(["legacy-token"])
})

test("under the runner a bot builds no Discord client and asks the hub instead", async () => {
    const discord = fakeDiscord()
    const hub = fakeDiscordHub()
    const bot = fakeBot()
    bot.botConfig.ggeConfig = { discordHub: true }
    const { mod } = loadModule("plugins/discord/discord.js", { bot, parentPort: hub.port, extra: { "discord.js": discord.module } })

    expect((await mod.clientReady).user.id).toBe("999")
    expect(discord.logins).toEqual([])
    expect(mod.commands).toBeUndefined()
})

test("an account without a Discord server skips registering commands", async () => {
    const discord = fakeDiscord()
    const { mod, bot } = loadModule("plugins/discord/discord.js", { bot: legacyBot(), extra: { "discord.js": discord.module } })
    mod.commands.set("ping", { data: { toJSON: () => ({ name: "ping" }) } })
    await mod.clientReady

    bot.events.emit("load")
    await new Promise(r => setTimeout(r, 50))

    expect(discord.puts).toEqual([])
})

test("an account with a Discord server registers its commands there", async () => {
    const discord = fakeDiscord()
    const { mod, bot } = loadModule("plugins/discord/discord.js", { bot: legacyBot(), extra: { "discord.js": discord.module } })
    bot.botConfig.discordData = { discordGuildId: "42" }
    mod.commands.set("ping", { data: { toJSON: () => ({ name: "ping" }) } })
    await mod.clientReady

    bot.events.emit("load")
    await new Promise(r => setTimeout(r, 50))

    expect(discord.puts).toEqual([["/applications/app/guilds/42/commands", { body: [{ name: "ping" }] }]])
})
