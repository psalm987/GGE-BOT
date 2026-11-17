import { createRequire } from "node:module"
import * as z from "zod"

const require = createRequire(import.meta.url)
const Action = require("@gge/bot-core/actions.json") as Record<string, number>

type Values<T> = { values(): Iterable<T> }

export interface DiscordMessageLike {
    id: string
    channelId: string
    content: string
    editable?: boolean
    author: { id: string; bot?: boolean; username?: string; displayName?: string }
    member?: { nickname?: string | null; displayHexColor?: string } | null
    attachments?: Values<{ name?: string | null; url?: string; proxyURL?: string }>
    reference?: { messageId?: string | null } | null
}

export interface DiscordMemberLike {
    id: string
    displayName: string
    presence?: { status?: string } | null
}

/** A channel of any kind; only text channels have the optional parts. */
export interface DiscordChannelLike {
    id: string
    send?(payload: OutgoingMessage): Promise<DiscordMessageLike>
    messages?: {
        fetch(options: { limit: number }): Promise<Values<DiscordMessageLike>>
        edit(messageId: string, payload: OutgoingMessage): Promise<DiscordMessageLike>
    }
    members?: Values<DiscordMemberLike>
}

/** The part of a discord.js Client the hub uses. */
export interface DiscordClientLike {
    login(token: string): Promise<unknown>
    destroy(): Promise<unknown>
    once(event: "clientReady", listener: () => void): unknown
    on(event: "messageCreate", listener: (message: DiscordMessageLike) => void): unknown
    on(event: "error", listener: (error: Error) => void): unknown
    user: { id: string; tag?: string } | null
    channels: { fetch(id: string): Promise<DiscordChannelLike | null> }
}

/** What a worker's port must do for the hub to answer it. */
export interface DiscordPort {
    postMessage(message: unknown): void
}

type OutgoingMessage = { content?: string; flags?: number | number[]; files?: { name: string; attachment: Buffer }[] }

export type MessageSummary = ReturnType<typeof summarise>

const summarise = (message: DiscordMessageLike) => ({
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    editable: Boolean(message.editable),
    author: { id: message.author.id, name: message.author.displayName ?? message.author.username ?? "", bot: Boolean(message.author.bot) },
    member: message.member ? { nickname: message.member.nickname ?? null, displayHexColor: message.member.displayHexColor ?? "#000000" } : null,
    attachments: [...message.attachments?.values() ?? []].map(a => ({ name: a.name ?? null, url: a.url ?? null, proxyURL: a.proxyURL ?? null })),
    reference: message.reference?.messageId ?? null,
})

/** A failure the worker is told about by code. */
export class DiscordHubError extends Error {
    readonly code: string
    constructor(code: string, message: string) {
        super(message)
        this.code = code
    }
}

const Snowflake = z.string().regex(/^\d{1,20}$/)
const Payload = z.object({
    content: z.string().max(2000).optional(),
    flags: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    files: z.array(z.object({ name: z.string().min(1).max(200), data: z.instanceof(Uint8Array) })).max(10).optional(),
})

const outgoing = ({ files, ...rest }: z.infer<typeof Payload>): OutgoingMessage => ({
    ...rest,
    ...(files && { files: files.map(file => ({ name: file.name, attachment: Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength) })) }),
})

type Context = { client: DiscordClientLike; subscribe(channelIds: string[]): void }

async function textChannel(client: DiscordClientLike, channelId: string) {
    const channel = await client.channels.fetch(channelId)
    if (!channel?.send || !channel.messages)
        throw new DiscordHubError("not_text_channel", `Channel ${channelId} isn't a text channel the bot can use`)
    return channel as Required<Pick<DiscordChannelLike, "send" | "messages">> & DiscordChannelLike
}

const op = <S extends z.ZodType>(args: S, run: (context: Context, args: z.infer<S>) => Promise<unknown>) => ({ args, run })

/** Everything a worker can ask the shared client to do. */
export const OPS = {
    whoAmI: op(z.object({}), async ({ client }) => ({ userId: client.user!.id })),
    channelFetch: op(z.object({ channelId: Snowflake }), async ({ client }, { channelId }) =>
        ({ id: (await textChannel(client, channelId)).id })),
    channelSend: op(z.object({ channelId: Snowflake, payload: Payload }), async ({ client }, { channelId, payload }) =>
        summarise(await (await textChannel(client, channelId)).send(outgoing(payload)))),
    messageEdit: op(z.object({ channelId: Snowflake, messageId: Snowflake, payload: Payload }), async ({ client }, { channelId, messageId, payload }) =>
        summarise(await (await textChannel(client, channelId)).messages.edit(messageId, outgoing(payload)))),
    messagesFetch: op(z.object({ channelId: Snowflake, limit: z.number().int().min(1).max(100).default(50) }), async ({ client }, { channelId, limit }) =>
        [...(await (await textChannel(client, channelId)).messages.fetch({ limit })).values()].map(summarise)),
    memberFind: op(z.object({ channelId: Snowflake, displayName: z.string() }), async ({ client }, { channelId, displayName }) => {
        const channel = await textChannel(client, channelId)
        for (const member of channel.members?.values() ?? [])
            if (member.displayName === displayName)
                return { id: member.id, displayName: member.displayName, presenceStatus: member.presence?.status ?? null }
        return null
    }),
    subscribe: op(z.object({ channelIds: z.array(Snowflake).max(50) }), async ({ subscribe }, { channelIds }) => {
        subscribe(channelIds)
        return {}
    }),
} as const

const Request = z.object({ id: z.number().int(), op: z.string(), args: z.unknown() })
type Request = z.infer<typeof Request>

type WorkerState = { inFlight: number; queue: Request[]; channels: Set<string> }

export type DiscordHubOptions = {
    /** Without a token the hub never logs in and every request fails. */
    token?: string | undefined
    createClient: () => DiscordClientLike
    /** How long a request waits for the first login before it fails. */
    readyTimeoutMs?: number
    /** Requests one worker may have running at once; the rest of its requests queue behind them. */
    perWorkerConcurrency?: number
    /** Requests one worker may have queued; more are refused. */
    perWorkerQueue?: number
    retry?: { baseMs: number; maxMs: number }
    logger?: Pick<Console, "log" | "warn" | "error">
}

/** Login failures that a retry can't fix. */
const FATAL_LOGIN_CODES = new Set(["TokenInvalid", "DisallowedIntents", "InvalidIntents"])

const NOT_CONFIGURED = new DiscordHubError("not_configured", "Discord isn't configured")

function describe(error: unknown) {
    if (error instanceof DiscordHubError)
        return { code: error.code, message: error.message }
    if (error instanceof z.ZodError)
        return { code: "bad_request", message: z.prettifyError(error) }
    const { code, message } = error as { code?: unknown; message?: unknown }
    return { code: code === undefined ? "error" : String(code), message: typeof message === "string" ? message : String(error) }
}

/**
 * The runner's one Discord connection. Workers reach it with Action.Discord
 * requests, which the supervisor passes to request(); replies and subscribed
 * channel messages go back over the same worker's port.
 */
export class DiscordHub {
    private readonly options: DiscordHubOptions
    private readonly log: Pick<Console, "log" | "warn" | "error">
    private readonly workers = new Map<DiscordPort, WorkerState>()
    private readonly ready: Promise<DiscordClientLike>
    private settle!: { resolve(client: DiscordClientLike): void; reject(error: Error): void }
    private client: DiscordClientLike | undefined
    private retryTimer: NodeJS.Timeout | undefined
    private stopped = false

    constructor(options: DiscordHubOptions) {
        this.options = options
        this.log = options.logger ?? console
        this.ready = new Promise((resolve, reject) => { this.settle = { resolve, reject } })
        // A failed login is reported to each request, so the promise itself may go unobserved.
        this.ready.catch(() => {})
    }

    /** Begins logging in and returns at once; requests wait for the login. */
    start() {
        if (!this.options.token)
            return this.settle.reject(NOT_CONFIGURED)
        void this.connect(this.options.token, 0)
    }

    private async connect(token: string, attempt: number) {
        if (this.stopped)
            return
        const client = this.client = this.options.createClient()
        client.on("error", error => this.log.error("Discord client error", error))
        const ready = new Promise<void>(resolve => client.once("clientReady", resolve))
        try {
            await client.login(token)
            await ready
        } catch (error) {
            void client.destroy().catch(() => {})
            const { code, message } = describe(error)
            if (FATAL_LOGIN_CODES.has(code)) {
                this.log.error(`Discord login failed and won't be retried: ${message}`)
                return this.settle.reject(new DiscordHubError("unavailable", `Discord login failed: ${message}`))
            }
            const { baseMs, maxMs } = this.options.retry ?? { baseMs: 5000, maxMs: 300_000 }
            const delay = Math.min(maxMs, baseMs * 2 ** attempt)
            this.log.warn(`Discord login failed; retrying in ${Math.round(delay / 1000)}s: ${message}`)
            this.retryTimer = setTimeout(() => void this.connect(token, attempt + 1), delay)
            this.retryTimer.unref()
            return
        }
        client.on("messageCreate", message => this.fanOut(message))
        this.log.log(`Discord connected as ${client.user?.tag ?? client.user?.id}`)
        this.settle.resolve(client)
    }

    async stop() {
        this.stopped = true
        clearTimeout(this.retryTimer)
        this.workers.clear()
        this.settle.reject(new DiscordHubError("unavailable", "Discord is shutting down"))
        await this.client?.destroy()
    }

    /** Takes one Action.Discord payload from a worker. Every well-formed request gets exactly one reply. */
    request(port: DiscordPort, raw: unknown) {
        const parsed = Request.safeParse(raw)
        if (!parsed.success)
            return this.log.warn("Ignored a malformed Discord request", raw)
        let worker = this.workers.get(port)
        if (!worker)
            this.workers.set(port, worker = { inFlight: 0, queue: [], channels: new Set() })
        if (worker.queue.length >= (this.options.perWorkerQueue ?? 100))
            return port.postMessage([Action.Discord, { id: parsed.data.id, ok: false, error: { code: "busy", message: "Too many Discord requests are waiting" } }])
        worker.queue.push(parsed.data)
        this.pump(port, worker)
    }

    /** Forgets a worker that has exited: its subscriptions end and its unfinished requests go unanswered. */
    release(port: DiscordPort) {
        this.workers.delete(port)
    }

    private pump(port: DiscordPort, worker: WorkerState) {
        while (worker.inFlight < (this.options.perWorkerConcurrency ?? 4)) {
            const request = worker.queue.shift()
            if (!request)
                return
            worker.inFlight++
            void this.run(worker, request).then(outcome => {
                worker.inFlight--
                if (this.workers.get(port) !== worker)
                    return
                port.postMessage([Action.Discord, { id: request.id, ...outcome }])
                this.pump(port, worker)
            })
        }
    }

    private async run(worker: WorkerState, request: Request) {
        try {
            const handler = Object.hasOwn(OPS, request.op) ? OPS[request.op as keyof typeof OPS] : undefined
            if (!handler)
                throw new DiscordHubError("unknown_op", `Unknown Discord operation ${request.op}`)
            const args = handler.args.parse(request.args)
            const context: Context = {
                client: await this.whenReady(),
                subscribe: channelIds => channelIds.forEach(id => worker.channels.add(id)),
            }
            return { ok: true, result: await (handler.run as (context: Context, args: unknown) => Promise<unknown>)(context, args) }
        } catch (error) {
            return { ok: false, error: describe(error) }
        }
    }

    private whenReady() {
        let timer: NodeJS.Timeout | undefined
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new DiscordHubError("not_ready", "Discord isn't connected yet")), this.options.readyTimeoutMs ?? 30_000)
        })
        return Promise.race([this.ready, timeout]).finally(() => clearTimeout(timer))
    }

    private fanOut(message: DiscordMessageLike) {
        let summary: MessageSummary | undefined
        for (const [port, worker] of this.workers)
            if (worker.channels.has(message.channelId))
                port.postMessage([Action.Discord, { event: "messageCreate", message: summary ??= summarise(message) }])
    }
}

/** The real client. discord.js is loaded only here, so a runner without a token never loads it. */
export function createDiscordClient(): DiscordClientLike {
    const { Client, GatewayIntentBits } = require("discord.js") as typeof import("discord.js")
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            // Members and presences let the incoming-attack alert mention its target and skip one who is online.
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildPresences,
        ],
    }) as unknown as DiscordClientLike
}
