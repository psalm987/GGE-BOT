import { afterEach, describe, expect, test, vi } from "vitest"
import { DiscordHub, type DiscordHubOptions } from "../src/discord-hub.ts"
import { FakeDiscord } from "./fixtures/fake-discord.ts"

const DISCORD = 23
const quiet = { log() {}, warn() {}, error() {} }

type Reply = { id: number; ok: boolean; result?: any; error?: { code: string; message: string } }

/** One worker's side of the conversation. */
function worker(hub: DiscordHub) {
    const replies: Reply[] = []
    const events: { event: string; message: any }[] = []
    let nextId = 1
    const port = {
        postMessage([type, body]: [number, Reply & { event?: string; message?: unknown }]) {
            expect(type).toBe(DISCORD)
            if (body.event)
                events.push({ event: body.event, message: body.message })
            else
                replies.push(body)
        },
    }
    return {
        port, replies, events,
        send(op: string, args: unknown = {}) {
            const id = nextId++
            hub.request(port, { id, op, args })
            return id
        },
        async ask(op: string, args: unknown = {}) {
            const id = this.send(op, args)
            return vi.waitFor(() => {
                const reply = replies.find(r => r.id === id)
                expect(reply, `a reply to ${op}`).toBeDefined()
                return reply!
            })
        },
    }
}

let hub: DiscordHub

function start(options: Partial<DiscordHubOptions> & { client?: FakeDiscord } = {}) {
    const client = options.client ?? new FakeDiscord()
    hub = new DiscordHub({ token: "token", createClient: () => client, logger: quiet, ...options })
    hub.start()
    return client
}

afterEach(() => hub.stop())

describe("requests", () => {
    test("each worker gets the answer to its own request", async () => {
        const client = start()
        client.channel("1")
        const a = worker(hub), b = worker(hub)

        const sent = await a.ask("channelSend", { channelId: "1", payload: { content: "attack!" } })
        const who = await b.ask("whoAmI")

        expect(sent).toMatchObject({ ok: true, result: { id: "1000", channelId: "1", content: "attack!", editable: true, author: { id: "999", bot: true } } })
        expect(who).toEqual({ id: 1, ok: true, result: { userId: "999" } })
        expect(a.replies).toHaveLength(1)
        expect(b.replies).toHaveLength(1)
        expect(client.channel("1").log.map(m => m.content)).toEqual(["attack!"])
    })

    test("a sent message can be read back and edited", async () => {
        const client = start()
        client.channel("1").receive("older")
        const a = worker(hub)

        const { result: sent } = await a.ask("channelSend", { channelId: "1", payload: { content: "Loading", flags: [4096] } })
        const { result: latest } = await a.ask("messagesFetch", { channelId: "1", limit: 1 })
        expect(latest).toEqual([sent])

        const edited = await a.ask("messageEdit", { channelId: "1", messageId: sent.id, payload: { content: "board" } })
        expect(edited).toMatchObject({ ok: true, result: { id: sent.id, content: "board" } })
        expect(client.channel("1").log.map(m => m.content)).toEqual(["older", "board"])
    })

    test("an attachment arrives as the same bytes under the same name", async () => {
        const client = start()
        const a = worker(hub)
        const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 7])
        // What a worker's port delivers: a structured clone, as postMessage makes.
        const args = structuredClone({ channelId: "1", payload: { content: "army", files: [{ name: "attack.png", data: png }] } })
        client.channel("1")

        const reply = await a.ask("channelSend", args)

        expect(reply.result.attachments).toEqual([{ name: "attack.png", url: "https://cdn.test/attack.png", proxyURL: "https://proxy.test/attack.png" }])
        const [file] = client.channel("1").log[0]!.files!
        expect(file!.name).toBe("attack.png")
        expect(Buffer.isBuffer(file!.attachment)).toBe(true)
        expect([...file!.attachment]).toEqual([...png])
    })

    test("a member is found by display name, with their presence", async () => {
        const client = start()
        client.channel("1").members.set("7", { id: "7", displayName: "Ada", presence: { status: "idle" } })
        client.channel("1").members.set("8", { id: "8", displayName: "Bob", presence: null })
        const a = worker(hub)

        expect((await a.ask("memberFind", { channelId: "1", displayName: "Ada" })).result).toEqual({ id: "7", displayName: "Ada", presenceStatus: "idle" })
        expect((await a.ask("memberFind", { channelId: "1", displayName: "Bob" })).result).toEqual({ id: "8", displayName: "Bob", presenceStatus: null })
        expect((await a.ask("memberFind", { channelId: "1", displayName: "Nobody" })).result).toBeNull()
    })
})

describe("failures", () => {
    test("a Discord error comes back with its code instead of a result", async () => {
        start()
        const a = worker(hub)
        expect(await a.ask("channelSend", { channelId: "404", payload: { content: "x" } }))
            .toEqual({ id: 1, ok: false, error: { code: "10003", message: "Unknown Channel" } })
    })

    test("an unknown operation and bad arguments are refused", async () => {
        const client = start()
        client.channel("1")
        const a = worker(hub)
        expect(await a.ask("guildDelete")).toMatchObject({ ok: false, error: { code: "unknown_op" } })
        expect(await a.ask("channelSend", { channelId: undefined, payload: { content: "x" } })).toMatchObject({ ok: false, error: { code: "bad_request" } })
        expect(await a.ask("channelSend", { channelId: "1", payload: { files: [{ name: "a.png", data: "not bytes" }] } })).toMatchObject({ ok: false, error: { code: "bad_request" } })
        expect(await a.ask("toString")).toMatchObject({ ok: false, error: { code: "unknown_op" } })
        expect(client.channel("1").log).toEqual([])
    })

    test("a worker with too many requests waiting is told it is busy", async () => {
        const client = start({ perWorkerConcurrency: 1, perWorkerQueue: 2 })
        let open!: () => void
        client.channel("1").gate = new Promise(resolve => { open = resolve })
        const a = worker(hub)
        await vi.waitFor(() => expect(client.user).not.toBeNull())

        const ids = [1, 2, 3, 4].map(n => a.send("channelSend", { channelId: "1", payload: { content: `m${n}` } }))
        await vi.waitFor(() => expect(a.replies).toHaveLength(1))
        expect(a.replies[0]).toMatchObject({ id: ids[3], ok: false, error: { code: "busy" } })

        open()
        await vi.waitFor(() => expect(a.replies).toHaveLength(4))
        expect(client.channel("1").log.map(m => m.content)).toEqual(["m1", "m2", "m3"])
    })
})

describe("before the login finishes", () => {
    test("a request waits for the login, then is answered", async () => {
        const client = start({ client: new FakeDiscord({ readyOnLogin: false }) })
        client.channel("1")
        const a = worker(hub)
        a.send("channelSend", { channelId: "1", payload: { content: "early" } })
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(a.replies).toEqual([])

        client.becomeReady()

        await vi.waitFor(() => expect(a.replies).toMatchObject([{ id: 1, ok: true }]))
        expect(client.channel("1").log.map(m => m.content)).toEqual(["early"])
    })

    test("a request that has waited too long fails and says why", async () => {
        const client = start({ client: new FakeDiscord({ readyOnLogin: false }), readyTimeoutMs: 40 })
        const a = worker(hub)
        expect(await a.ask("whoAmI")).toEqual({ id: 1, ok: false, error: { code: "not_ready", message: "Discord isn't connected yet" } })

        client.becomeReady()
        expect(await a.ask("whoAmI")).toMatchObject({ ok: true, result: { userId: "999" } })
    })

    test("a login that fails for a passing reason is tried again with a new client", async () => {
        const clients = [new FakeDiscord({ loginError: new Error("getaddrinfo ENOTFOUND discord.com") }), new FakeDiscord()]
        const made: FakeDiscord[] = []
        hub = new DiscordHub({ token: "token", createClient: () => (made.push(clients[made.length]!), made.at(-1)!), retry: { baseMs: 10, maxMs: 10 }, logger: quiet })
        hub.start()
        const a = worker(hub)

        expect(await a.ask("whoAmI")).toMatchObject({ ok: true, result: { userId: "999" } })
        expect(made).toHaveLength(2)
        expect(clients[0]!.destroyed).toBe(true)
    })

    test("a rejected token is not tried again, and requests fail at once", async () => {
        const made: FakeDiscord[] = []
        const error = Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" })
        hub = new DiscordHub({ token: "bad", createClient: () => (made.push(new FakeDiscord({ loginError: error })), made.at(-1)!), retry: { baseMs: 5, maxMs: 5 }, logger: quiet })
        hub.start()
        const a = worker(hub)

        expect(await a.ask("whoAmI")).toEqual({ id: 1, ok: false, error: { code: "unavailable", message: "Discord login failed: An invalid token was provided." } })
        await new Promise(resolve => setTimeout(resolve, 40))
        expect(made).toHaveLength(1)
    })
})

describe("without a token", () => {
    test("nothing logs in and every request says Discord isn't configured", async () => {
        const createClient = vi.fn(() => new FakeDiscord())
        hub = new DiscordHub({ token: undefined, createClient, logger: quiet })
        hub.start()
        const a = worker(hub)

        expect(await a.ask("channelSend", { channelId: "1", payload: { content: "x" } }))
            .toEqual({ id: 1, ok: false, error: { code: "not_configured", message: "Discord isn't configured" } })
        expect(createClient).not.toHaveBeenCalled()
    })
})

describe("channel messages", () => {
    test("a message reaches only the workers subscribed to its channel", async () => {
        const client = start()
        const a = worker(hub), b = worker(hub), c = worker(hub)
        await a.ask("subscribe", { channelIds: ["1"] })
        await b.ask("subscribe", { channelIds: ["2"] })
        await c.ask("whoAmI")

        client.channel("1").receive("hello", { id: "501", bot: false, displayName: "Ada" }, { nickname: "Countess", displayHexColor: "#aa00ff" })

        expect(a.events).toEqual([{
            event: "messageCreate",
            message: {
                id: "1000", channelId: "1", content: "hello", editable: false, reference: null, attachments: [],
                author: { id: "501", name: "Ada", bot: false },
                member: { nickname: "Countess", displayHexColor: "#aa00ff" },
            },
        }])
        expect(b.events).toEqual([])
        expect(c.events).toEqual([])
    })

    test("a worker that has exited hears nothing more and gets no late replies", async () => {
        const client = start()
        let open!: () => void
        const a = worker(hub), b = worker(hub)
        await a.ask("subscribe", { channelIds: ["1"] })
        await b.ask("subscribe", { channelIds: ["1"] })
        client.channel("1").gate = new Promise(resolve => { open = resolve })
        a.send("channelSend", { channelId: "1", payload: { content: "in flight" } })
        await vi.waitFor(() => expect(client.channel("1").sending).toBe(1))

        hub.release(a.port)
        open()
        await vi.waitFor(() => expect(client.channel("1").log).toHaveLength(1))
        client.channel("1").receive("after exit")

        expect(b.events.map(e => e.message.content)).toEqual(["after exit"])
        expect(a.events).toEqual([])
        expect(a.replies).toHaveLength(1)
    })
})

describe("fairness between workers", () => {
    test("one worker runs only so many requests at once, and another worker isn't held up by them", async () => {
        const client = start({ perWorkerConcurrency: 2 })
        let open!: () => void
        const channel = client.channel("1")
        channel.gate = new Promise(resolve => { open = resolve })
        const greedy = worker(hub), other = worker(hub)
        await greedy.ask("whoAmI")

        for (let n = 1; n <= 6; n++)
            greedy.send("channelSend", { channelId: "1", payload: { content: `m${n}` } })
        await vi.waitFor(() => expect(channel.sending).toBe(2))
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(channel.sending).toBe(2)

        expect(await other.ask("messagesFetch", { channelId: "1", limit: 1 })).toMatchObject({ ok: true, result: [] })

        open()
        await vi.waitFor(() => expect(greedy.replies).toHaveLength(7))
        expect(channel.mostSendingAtOnce).toBe(2)
        expect(channel.log.map(m => m.content)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
    })
})
