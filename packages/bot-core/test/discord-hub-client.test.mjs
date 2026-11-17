import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { fakeDiscordHub } = require("./harness/fake-discord-hub.cjs")
const en = require("../locales/en.json")

afterEach(() => vi.useRealTimers())

const PNG = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

/** A bot running under the runner: Discord goes through the hub, never through a client of its own. */
function underRunner(plugins = {}) {
    const bot = fakeBot({ i18n: { __: key => en[key] ?? String(key) } })
    bot.botConfig.plugins = plugins
    bot.botConfig.ggeConfig = { discordHub: true }
    return bot
}

function loadShim(hub) {
    return loadModule("plugins/discord/discord.js", { bot: underRunner(), parentPort: hub.port }).mod
}

describe("the Discord client a bot gets under the runner", () => {
    test("is ready once the runner has said who the bot user is", async () => {
        const hub = fakeDiscordHub({ userId: "4242" })
        const { clientReady, client } = loadShim(hub)

        expect(await clientReady).toBe(client)
        expect(client.user.id).toBe("4242")
    })

    test("waits out a runner whose login is still under way", async () => {
        const hub = fakeDiscordHub({ notReadyTimes: 2 })
        const { clientReady } = loadShim(hub)

        expect((await clientReady).user.id).toBe("999")
        expect(hub.sent("whoAmI")).toHaveLength(3)
    })

    test("sends text to a fetched channel and gets the posted message back", async () => {
        const hub = fakeDiscordHub()
        const { client } = loadShim(hub)

        const channel = await client.channels.fetch("1")
        const message = await channel.send("hello")

        expect(hub.contents("1")).toEqual(["hello"])
        expect(message).toMatchObject({ content: "hello", editable: true, author: { id: "999", bot: true }, channel: { id: "1" } })
        expect(message.attachments.size).toBe(0)
    })

    test("sends a streamed picture as its bytes, with its name", async () => {
        const hub = fakeDiscordHub()
        const { client } = loadShim(hub)
        const channel = await client.channels.fetch("1")

        const message = await channel.send({ content: "army", flags: [4096], files: [{ attachment: Readable.from([Buffer.from(PNG.slice(0, 4)), Buffer.from(PNG.slice(4))]), name: "attack.png" }] })

        const [{ payload }] = hub.sent("channelSend")
        expect(payload).toMatchObject({ content: "army", flags: [4096] })
        expect(payload.files).toHaveLength(1)
        expect(payload.files[0].name).toBe("attack.png")
        expect(payload.files[0].data).toBeInstanceOf(Uint8Array)
        expect([...payload.files[0].data]).toEqual(PNG)
        expect(message.attachments.size).toBe(1)
    })

    test("reads the latest message and edits it", async () => {
        const hub = fakeDiscordHub()
        const { client } = loadShim(hub)
        const channel = await client.channels.fetch("1")
        hub.receive("1", "someone else")
        await channel.send("mine")

        const latest = (await channel.messages.fetch({ limit: 1 })).first()
        expect(latest).toMatchObject({ content: "mine", author: { id: "999" } })
        const edited = await latest.edit("mine, edited")

        expect(edited.content).toBe("mine, edited")
        expect(hub.contents("1")).toEqual(["someone else", "mine, edited"])
        expect((await channel.messages.fetch({ limit: 5 })).size).toBe(2)
    })

    test("an empty channel has no latest message", async () => {
        const hub = fakeDiscordHub()
        const { client } = loadShim(hub)
        const channel = await client.channels.fetch("1")
        expect((await channel.messages.fetch({ limit: 1 })).first()).toBeUndefined()
    })

    test("a channel the bot can't use fails to fetch, with Discord's code", async () => {
        const hub = fakeDiscordHub()
        const { client } = loadShim(hub)
        await expect(client.channels.fetch("404")).rejects.toMatchObject({ code: "10003", message: "Unknown Channel" })
    })

    test("hears messages from the channels it fetched, before or after it started listening, and from no others", async () => {
        const hub = fakeDiscordHub({ channelIds: ["1", "2", "3"] })
        const { client } = loadShim(hub)
        const heard = []
        await client.channels.fetch("1")
        client.on("messageCreate", message => heard.push(message))
        await client.channels.fetch("2")
        await settle()

        hub.receive("1", "one", { author: { id: "501", name: "Ada", bot: false }, member: { nickname: "Countess", displayHexColor: "#aa00ff" } })
        hub.receive("2", "two")
        hub.receive("3", "three")
        await settle()

        expect(heard.map(m => [m.channel.id, m.content])).toEqual([["1", "one"], ["2", "two"]])
        expect(heard[0]).toMatchObject({ author: { id: "501", bot: false, displayName: "Ada" }, member: { nickname: "Countess", displayHexColor: "#aa00ff" } })
        expect(heard[0].attachments.size).toBe(0)
    })

    test("finds a channel member by display name", async () => {
        const hub = fakeDiscordHub({ members: [{ id: "7", displayName: "Ada", presenceStatus: "idle" }] })
        const { client, findMember } = loadShim(hub)
        const channel = await client.channels.fetch("1")

        expect(await findMember(channel, "Ada")).toEqual({ id: "7", displayName: "Ada", presence: { status: "idle" } })
        expect(await findMember(channel, "Nobody")).toBeUndefined()
    })
})

const KingdomID = { 0: "greatEmpire", 1: "burningSands", 2: "everWinterGlacier", 3: "firePeaks", 4: "stormIslands", stormIslands: 4 }

function attack(overrides = {}) {
    return {
        type: 0, kingdomID: 0, canSeeArmy: false,
        sourceOwner: { ownerID: 1, allianceID: 2, name: "Raider", allianceName: "Wolves" },
        targetOwner: { ownerID: 5, allianceID: 9, name: "Ada", allianceName: "Lambs" },
        sourceAttack: { x: 0, y: 0, extraData: [, , , , , , , "Wolf Den"] },
        targetAttack: { x: 3, y: 4, extraData: [, , , , , , , "Ada's Keep"] },
        left: [], middle: [], right: [], courtyard: [],
        totalTime: 100_000, deltaTime: Date.now(),
        ...overrides,
    }
}

/** An attack plugin, loaded for a bot in alliance 9 with a picture renderer that returns PNG. */
function loadAttackPlugin(name, hub, options) {
    const bot = underRunner({ [name]: options })
    bot.playerInfo.alliance = { id: 9 }
    const movementEvents = new EventEmitter()
    const layouts = []
    loadModule(`plugins/discord/${name}.js`, {
        bot, parentPort: hub.port,
        extra: {
            "protocols.js": { movementEvents, KingdomID },
            "imageGen.js": { createLayout: (...waves) => (layouts.push(waves), Readable.from([Buffer.from(PNG)])) },
        },
    })
    return { movementEvents, layouts }
}

describe("incoming attack alerts", () => {
    test("an attack on an alliance member is posted, mentioning the member", async () => {
        const hub = fakeDiscordHub({ members: [{ id: "7", displayName: "Ada", presenceStatus: "online" }] })
        const { movementEvents } = loadAttackPlugin("incomingAttacks", hub, { channelID: "1" })

        movementEvents.emit("outgoing", attack())
        await settle()

        const [content] = hub.contents("1")
        expect(content).toMatch(/^<@7> ```ansi\nRaider \(Wolf Den\) from Wolves is attacking Ada \(Ada's Keep\) incoming in .*greatEmpire.* 5 clicks```<t:\d+:R>$/)
        expect(hub.contents("1")).toHaveLength(1)
        expect(hub.sent("channelSend")[0].payload.files).toBeUndefined()
    })

    test("an attack between strangers, and one by the alliance itself, are not posted", async () => {
        const hub = fakeDiscordHub()
        const { movementEvents } = loadAttackPlugin("incomingAttacks", hub, { channelID: "1" })

        movementEvents.emit("outgoing", attack({ targetOwner: { ownerID: 5, allianceID: 3, name: "Stranger" } }))
        movementEvents.emit("outgoing", attack({ sourceOwner: { ownerID: 1, allianceID: 9, name: "Friend" } }))
        await settle()

        expect(hub.sent("channelSend")).toEqual([])
    })

    test("a visible army is posted as a picture, and one seen later is added to the post once", async () => {
        const hub = fakeDiscordHub()
        const { movementEvents, layouts } = loadAttackPlugin("incomingAttacks", hub, { channelID: "1", mentionEveryone: true })
        const hidden = attack()

        movementEvents.emit("outgoing", hidden)
        await settle()
        expect(hub.contents("1")[0]).toContain("@everyone")
        expect(hub.sent("messageEdit")).toEqual([])

        hidden.canSeeArmy = true
        movementEvents.emit("outgoing", hidden)
        await settle()
        movementEvents.emit("outgoing", hidden)
        await settle()

        const edits = hub.sent("messageEdit")
        expect(edits).toHaveLength(1)
        expect(edits[0].payload.content).toBe(hub.contents("1")[0])
        expect(edits[0].payload.files.map(f => [f.name, [...f.data]])).toEqual([["attack.png", PNG]])
        expect(hub.contents("1")).toHaveLength(1)

        movementEvents.emit("outgoing", attack({ canSeeArmy: true }))
        await settle()
        expect(hub.sent("channelSend")[1].payload.files.map(f => [f.name, [...f.data]])).toEqual([["attack.png", PNG]])
        expect(layouts).toHaveLength(2)
    })

    test("a storm attack goes to the storm channel", async () => {
        const hub = fakeDiscordHub({ channelIds: ["1", "2"] })
        const { movementEvents } = loadAttackPlugin("incomingAttacks", hub, { channelID: "1", stormChannelID: "2" })

        movementEvents.emit("outgoing", attack({ kingdomID: 4 }))
        await settle()

        expect(hub.contents("1")).toEqual([])
        expect(hub.contents("2")).toHaveLength(1)
    })

    test("a target who is away is pinged again as the attack nears, until they come online", async () => {
        vi.useFakeTimers()
        const hub = fakeDiscordHub({ members: [{ id: "7", displayName: "Ada", presenceStatus: "idle" }] })
        const { movementEvents } = loadAttackPlugin("incomingAttacks", hub, { channelID: "1" })

        movementEvents.emit("outgoing", attack())
        await vi.advanceTimersByTimeAsync(1000)
        expect(hub.contents("1")).toHaveLength(1)

        // 100 s out: reminders at 25 s and 33.3 s.
        await vi.advanceTimersByTimeAsync(34_000)
        expect(hub.contents("1").slice(1)).toEqual(["<@7> ", "<@7> "])

        hub.members[0].presenceStatus = "online"
        await vi.advanceTimersByTimeAsync(66_000)
        expect(hub.contents("1")).toHaveLength(3)
    })

    test("a target who is online gets no reminders", async () => {
        vi.useFakeTimers()
        const hub = fakeDiscordHub({ members: [{ id: "7", displayName: "Ada", presenceStatus: "dnd" }] })
        const { movementEvents } = loadAttackPlugin("incomingAttacks", hub, { channelID: "1" })

        movementEvents.emit("outgoing", attack())
        await vi.advanceTimersByTimeAsync(100_000)

        expect(hub.contents("1")).toHaveLength(1)
    })
})

describe("outgoing attack posts", () => {
    test("an attack by an alliance member is posted with its army picture", async () => {
        const hub = fakeDiscordHub()
        const { movementEvents } = loadAttackPlugin("outgoingAttacks", hub, { channelID: "1" })

        movementEvents.emit("outgoing", attack({
            sourceOwner: { ownerID: 5, allianceID: 9, name: "Ada", allianceName: "Lambs" },
            targetOwner: { ownerID: 1, allianceID: 2, name: "Raider", allianceName: "Wolves" },
        }))
        movementEvents.emit("outgoing", attack())
        await settle()

        const sends = hub.sent("channelSend")
        expect(sends).toHaveLength(1)
        expect(sends[0].payload.content).toMatch(/^```ansi\nRaider \(Ada's Keep\) from Wolves is attacking Ada \(Wolf Den\) incoming in .* 5 clicks```<t:\d+:R>$/)
        expect(sends[0].payload.files.map(f => [f.name, [...f.data]])).toEqual([["attack.png", PNG]])
    })
})

describe("the alliance chat bridge", () => {
    function loadChat(hub, options = { channelID: "1" }) {
        const bot = underRunner({ chat: options })
        bot.botConfig.name = "TheBot"
        loadModule("plugins/discord/chat.js", { bot, parentPort: hub.port })
        return bot
    }

    test("a game chat line is posted to the channel, except the bot's own", async () => {
        const hub = fakeDiscordHub()
        const bot = loadChat(hub)
        await settle()

        bot.xtHandler.emit("acm", { CM: { PN: "Bob", MT: "50&percnt; off<br />today" } })
        bot.xtHandler.emit("acm", { CM: { PN: "thebot", MT: "echo" } })
        await settle()

        expect(hub.contents("1")).toEqual(["Bob: 50% off\ntoday"])
    })

    test("a channel message is sent into the game chat under the author's name", async () => {
        const hub = fakeDiscordHub({ channelIds: ["1", "2"] })
        const bot = loadChat(hub)
        await settle()

        hub.receive("1", "hi all", { author: { id: "501", name: "Ada", bot: false }, member: { nickname: "Countess", displayHexColor: "#aa00ff" } })
        await settle()

        expect(bot.sent).toEqual([["acm", { M: "<color=#aa00ff>Countess<color>:  hi all" }]])
    })

    test("messages from bots and from other channels stay out of the game", async () => {
        const hub = fakeDiscordHub({ channelIds: ["1", "2"] })
        const bot = loadChat(hub)
        await settle()

        hub.receive("1", "beep", { author: { id: "999", name: "bot", bot: true } })
        hub.receive("2", "elsewhere")
        await settle()

        expect(bot.sent).toEqual([])
        expect([...hub.subscribed]).toEqual(["1"])
    })
})

describe("the timer boards", () => {
    const AreaType = { externalKingdom: 12, mainCastle: 1, stormIsland: 24, stormTower: 25 }
    const boards = {
        fortress: {
            castles: [1, 2, 3].map(kingdomID => ({ kingdomID, areaInfo: { type: 1, x: 500, y: 500 } })),
            area: kingdomID => ({ type: 11, x: 10, y: 20, extraData: [0, 0, 3600, 0, kingdomID], timeSinceRequest: Date.now() }),
            board: /^```ansi\nLocation +Coords +Time\n.*Burning Sands.* 10:20 /s,
        },
        aquaIsland: {
            castles: [{ kingdomID: 4, areaInfo: { type: 1, x: 500, y: 500 } }],
            area: () => ({ type: 24, x: 10, y: 20, extraData: [0, 0, 0, 0, 0, 6, 3600], timeSinceRequest: Date.now() }),
            board: /^```Coords +Time\n10:20 +\(Small\) /,
        },
        aquaTower: {
            castles: [{ kingdomID: 4, areaInfo: { type: 1, x: 500, y: 500 } }],
            area: () => ({ type: 25, x: 10, y: 20, extraData: [0, 0, 7, 0, 4], timeSinceRequest: Date.now() }),
            board: /^```Location +Hits left\n10:20 lv 60 \(Easy\) 6\n```$/,
        },
    }

    async function loadBoard(name, hub) {
        vi.useFakeTimers()
        const { castles, area } = boards[name]
        const scanned = new Set()
        const getAreaInfo = async kingdomID => ({ areaInfo: scanned.has(kingdomID) ? [] : (scanned.add(kingdomID), [area(kingdomID)]) })
        const protocols = {
            ClientCommands: { getAreaInfo, preSpyInfo: async () => ({ areaInfo: { extraData: [] } }) },
            spiralCoordinates: () => ({ x: 0, y: 0 }),
            castles, AreaType, KingdomID,
            unlockInfoList: [{ kingdomID: 4, isUnlocked: true }],
        }
        const bot = underRunner({ [name]: { channelID: "1" } })
        loadModule(`plugins/discord/${name}.js`, { bot, parentPort: hub.port, extra: { "protocols.js": protocols, "protocols": protocols } })
        bot.events.emit("load")
        await vi.advanceTimersByTimeAsync(1000)
    }

    test.each(Object.keys(boards))("%s posts one message and keeps it up to date in place", async name => {
        const hub = fakeDiscordHub()
        hub.receive("1", "someone chatting")
        await loadBoard(name, hub)

        await vi.advanceTimersByTimeAsync(6000)
        expect(hub.contents("1")).toHaveLength(2)
        expect(hub.contents("1")[1]).toMatch(boards[name].board)
        expect(hub.sent("channelSend")).toEqual([{ channelId: "1", payload: { content: "```Loading...```", flags: [4096] } }])

        await vi.advanceTimersByTimeAsync(12_000)
        expect(hub.sent("channelSend")).toHaveLength(1)
        expect(hub.contents("1")).toHaveLength(2)
    })

    test.each(Object.keys(boards))("%s reuses its own message from an earlier run", async name => {
        const hub = fakeDiscordHub()
        hub.port.postMessage([23, { id: 0, op: "channelSend", args: { channelId: "1", payload: { content: "stale board" } } }])
        await loadBoard(name, hub)

        await vi.advanceTimersByTimeAsync(6000)

        expect(hub.sent("channelSend")).toHaveLength(1)
        expect(hub.contents("1")).toHaveLength(1)
        expect(hub.contents("1")[0]).toMatch(boards[name].board)
    })
})

describe("what a bot loads under the runner", () => {
    test("no plugin loads discord.js, so no bot can open a Discord connection of its own", async () => {
        const hub = fakeDiscordHub()
        const protocols = { movementEvents: new EventEmitter(), KingdomID, ClientCommands: {}, castles: [], AreaType: {}, unlockInfoList: [] }
        for (const name of ["incomingAttacks", "outgoingAttacks", "chat", "fortress", "aquaIsland", "aquaTower"]) {
            const bot = underRunner({ [name]: { channelID: "1" } })
            loadModule(`plugins/discord/${name}.js`, { bot, parentPort: hub.port, extra: { "protocols.js": protocols, "protocols": protocols, "imageGen.js": {} } })
        }
        await settle()

        expect(hub.sent("whoAmI").length).toBeGreaterThan(0)
        expect(Object.keys(require.cache).filter(file => /node_modules\/(discord\.js|@discordjs)\//.test(file))).toEqual([])
    })

    test("the plugin list offers the Discord plugins but not slash commands", () => {
        const names = config => {
            const { mod } = loadModule("plugins/index.js", { mainThread: true, extra: { "config.js": config } })
            return mod.map(([name]) => name).filter(name => name.startsWith("plugins/discord/")).sort()
        }
        const plugins = ["aquaIsland", "aquaTower", "chat", "discord", "fortress", "incomingAttacks", "outgoingAttacks"].map(name => `plugins/discord/${name}`)

        expect(names({ discordHub: true })).toEqual(plugins)
        expect(names({ discordHub: false })).toEqual([])
        expect(names({ discordToken: "t", discordClientId: "c" })).toEqual([...plugins, "plugins/discord/slashCommands"])
    })
})
