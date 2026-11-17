import { EventEmitter } from "node:events"
import type { DiscordClientLike, DiscordMemberLike, DiscordMessageLike } from "../../src/discord-hub.ts"

type Sent = { content?: string; flags?: number | number[]; files?: { name: string; attachment: Buffer }[] }

export class FakeChannel {
    readonly id: string
    readonly members = new Map<string, DiscordMemberLike>()
    /** Every message in the channel, oldest first. */
    readonly log: (DiscordMessageLike & { files: Sent["files"] })[] = []
    /** While set, send() doesn't finish until it resolves. */
    gate: Promise<void> | undefined
    sending = 0
    mostSendingAtOnce = 0
    private readonly client: FakeDiscord

    constructor(client: FakeDiscord, id: string) {
        this.client = client
        this.id = id
    }

    private add(author: DiscordMessageLike["author"], payload: Sent, extra: Partial<DiscordMessageLike> = {}) {
        const files = payload.files ?? []
        const message = {
            id: String(1000 + this.log.length),
            channelId: this.id,
            content: payload.content ?? "",
            editable: author.id === this.client.user?.id,
            author,
            member: null,
            attachments: new Map(files.map((file, i) => [String(i), { name: file.name, url: `https://cdn.test/${file.name}`, proxyURL: `https://proxy.test/${file.name}` }])),
            files,
            ...extra,
        }
        this.log.push(message)
        return message
    }

    send = async (payload: Sent) => {
        this.mostSendingAtOnce = Math.max(this.mostSendingAtOnce, ++this.sending)
        try {
            await this.gate
            return this.add({ id: this.client.user!.id, bot: true, username: "bot" }, payload)
        } finally {
            this.sending--
        }
    }

    messages = {
        fetch: async ({ limit }: { limit: number }) => new Map(this.log.slice(-limit).reverse().map(m => [m.id, m])),
        edit: async (messageId: string, payload: Sent) => {
            const message = this.log.find(m => m.id === messageId)
            if (!message)
                throw Object.assign(new Error("Unknown Message"), { code: 10008 })
            if (payload.content !== undefined)
                message.content = payload.content
            if (payload.files) {
                message.files = payload.files
                message.attachments = new Map(payload.files.map((file, i) => [String(i), { name: file.name }]))
            }
            return message
        },
    }

    /** Someone in the server posts here. */
    receive(content: string, author: DiscordMessageLike["author"] = { id: "501", bot: false, displayName: "Ada" }, member: DiscordMessageLike["member"] = { nickname: null, displayHexColor: "#ff0000" }) {
        const message = this.add(author, { content }, { member })
        this.client.emit("messageCreate", message)
        return message
    }
}

/** An in-memory stand-in for the discord.js Client. It never touches the network. */
export class FakeDiscord extends EventEmitter implements DiscordClientLike {
    user: { id: string; tag: string } | null = null
    readonly logins: string[] = []
    destroyed = false
    private readonly byId = new Map<string, FakeChannel>()
    private readonly options: { loginError?: Error; readyOnLogin?: boolean }

    constructor(options: { loginError?: Error; readyOnLogin?: boolean } = {}) {
        super()
        this.options = options
    }

    channels = {
        fetch: async (id: string) => {
            const channel = this.byId.get(id)
            if (!channel)
                throw Object.assign(new Error("Unknown Channel"), { code: 10003 })
            return channel
        },
    }

    async login(token: string) {
        this.logins.push(token)
        if (this.options.loginError)
            throw this.options.loginError
        if (this.options.readyOnLogin ?? true)
            setImmediate(() => this.becomeReady())
        return token
    }

    becomeReady() {
        this.user = { id: "999", tag: "bot#0001" }
        this.emit("clientReady")
    }

    async destroy() {
        this.destroyed = true
    }

    channel(id: string) {
        let channel = this.byId.get(id)
        if (!channel)
            this.byId.set(id, channel = new FakeChannel(this, id))
        return channel
    }
}
