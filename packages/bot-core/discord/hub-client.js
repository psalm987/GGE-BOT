// A stand-in for a discord.js Client, backed by the runner's one Discord
// connection. It covers only what the Discord plugins use. Each call is a
// request to the parent thread: [Action.Discord, { id, op, args }], answered by
// [Action.Discord, { id, ok, result | error }].
const { parentPort } = require("node:worker_threads")
const { EventEmitter } = require("node:events")
const { Discord: ACTION } = require("../actions.json")

class DiscordError extends Error {
    constructor({ code, message }) {
        super(message)
        this.code = code
    }
}

const pending = new Map()
const emitter = new EventEmitter()
/** Channels this bot has looked up. Their messages are the ones on("messageCreate") hears. */
const fetched = new Set()
let nextId = 1

function request(op, args = {}) {
    return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        parentPort.postMessage([ACTION, { id, op, args }])
    })
}

parentPort.on("message", ([type, body]) => {
    if (type !== ACTION)
        return
    if (body.event)
        return emitter.emit(body.event, toMessage(body.message))
    const waiter = pending.get(body.id)
    if (!waiter)
        return
    pending.delete(body.id)
    if (body.ok)
        waiter.resolve(body.result)
    else
        waiter.reject(new DiscordError(body.error))
})

async function toFile(file, index) {
    const source = file.attachment ?? file
    const bytes = source instanceof Uint8Array ? source : Buffer.concat(await source.toArray())
    // A fresh array, because a Buffer can be a view of a much larger pooled one and the whole pool would be cloned.
    return { name: file.name ?? `file${index}.png`, data: new Uint8Array(bytes) }
}

async function toPayload(payload) {
    if (typeof payload == "string")
        return { content: payload }
    const { content, flags, files } = payload
    return { content, flags, files: files && await Promise.all(files.map(toFile)) }
}

function toMessage(summary) {
    return {
        id: summary.id,
        channelId: summary.channelId,
        channel: { id: summary.channelId },
        content: summary.content,
        editable: summary.editable,
        author: { id: summary.author.id, bot: summary.author.bot, displayName: summary.author.name },
        member: summary.member,
        attachments: new Map(summary.attachments.map((attachment, index) => [String(index), attachment])),
        reference: summary.reference,
        edit: async payload => toMessage(await request("messageEdit", {
            channelId: summary.channelId, messageId: summary.id, payload: await toPayload(payload)
        })),
    }
}

const toChannel = id => ({
    id,
    send: async payload => toMessage(await request("channelSend", { channelId: id, payload: await toPayload(payload) })),
    messages: {
        async fetch({ limit } = {}) {
            const messages = (await request("messagesFetch", { channelId: id, limit })).map(toMessage)
            return Object.assign(new Map(messages.map(message => [message.id, message])), { first: () => messages[0] })
        }
    },
})

const subscribe = channelIds => request("subscribe", { channelIds }).catch(console.warn)

const client = {
    user: undefined,
    channels: {
        async fetch(channelId) {
            const { id } = await request("channelFetch", { channelId })
            if (!fetched.has(id)) {
                fetched.add(id)
                if (emitter.listenerCount("messageCreate") > 0)
                    subscribe([id])
            }
            return toChannel(id)
        }
    },
    on(event, listener) {
        if (event == "messageCreate" && emitter.listenerCount(event) == 0 && fetched.size > 0)
            subscribe([...fetched])
        emitter.on(event, listener)
        return client
    },
}

/** The runner answers "not_ready" while its login is still under way, so that answer is asked again. */
const whoAmI = () => request("whoAmI").catch(error => {
    if (error.code != "not_ready")
        throw error
    return whoAmI()
})

const clientReady = whoAmI().then(({ userId }) => {
    client.user = { id: userId }
    return client
})
// Each plugin that awaits it sees the failure; this keeps the module itself from crashing the bot.
clientReady.catch(console.warn)

async function findMember(channel, displayName) {
    const member = await request("memberFind", { channelId: channel.id, displayName })
    return member ? { id: member.id, displayName: member.displayName, presence: { status: member.presenceStatus ?? undefined } } : undefined
}

module.exports = { client, clientReady, findMember }
