const { Discord: ACTION } = require("../../actions.json")

/**
 * The runner's Discord hub as a worker sees it: a parent port that answers
 * Action.Discord requests from channels held in memory. `requests` is every
 * request received, in order.
 */
function fakeDiscordHub({ userId = "999", channelIds = ["1"], members = [], notReadyTimes = 0 } = {}) {
    const listeners = []
    const requests = []
    const channels = new Map(channelIds.map(id => [id, []]))
    const subscribed = new Set()
    let nextMessageId = 1000

    const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
    const messagesOf = channelId => channels.get(channelId) ?? fail("10003", "Unknown Channel")
    const add = (channelId, author, { content = "", files = [] }, member = null) => {
        const message = {
            id: String(nextMessageId++), channelId, content, editable: author.id == userId, author, member, reference: null,
            attachments: files.map(file => ({ name: file.name, url: `https://cdn.test/${file.name}`, proxyURL: `https://proxy.test/${file.name}` })),
        }
        messagesOf(channelId).push(message)
        return message
    }
    const ops = {
        whoAmI: () => notReadyTimes-- > 0 ? fail("not_ready", "Discord isn't connected yet") : { userId },
        channelFetch: ({ channelId }) => (messagesOf(channelId), { id: channelId }),
        channelSend: ({ channelId, payload }) => add(channelId, { id: userId, name: "bot", bot: true }, payload),
        messageEdit({ channelId, messageId, payload }) {
            const message = messagesOf(channelId).find(m => m.id == messageId) ?? fail("10008", "Unknown Message")
            if (payload.content !== undefined)
                message.content = payload.content
            if (payload.files)
                message.attachments = payload.files.map(file => ({ name: file.name, url: null, proxyURL: null }))
            return message
        },
        messagesFetch: ({ channelId, limit = 50 }) => messagesOf(channelId).slice(-limit).reverse(),
        memberFind: ({ displayName }) => {
            const member = members.find(m => m.displayName == displayName)
            return member ? { id: member.id, displayName, presenceStatus: member.presenceStatus ?? null } : null
        },
        subscribe: ({ channelIds }) => (channelIds.forEach(id => subscribed.add(id)), {}),
    }
    // A worker's port clones what it carries, so the fake does too; microtasks keep it clear of fake timers.
    const deliver = body => queueMicrotask(() => listeners.forEach(listener => listener([ACTION, structuredClone(body)])))

    return {
        requests, members, subscribed,
        /** The requests of one kind, as their arguments. */
        sent: op => requests.filter(r => r.op == op).map(r => r.args),
        contents: channelId => messagesOf(channelId).map(m => m.content),
        /** Someone in the server posts in a channel; subscribed workers hear it. */
        receive(channelId, content, { author = { id: "501", name: "Ada", bot: false }, member = { nickname: null, displayHexColor: "#ff0000" } } = {}) {
            const message = add(channelId, author, { content }, member)
            if (subscribed.has(channelId))
                deliver({ event: "messageCreate", message })
            return message
        },
        port: {
            on(event, listener) {
                if (event == "message")
                    listeners.push(listener)
            },
            postMessage(message) {
                const [type, { id, op, args }] = structuredClone(message)
                if (type != ACTION)
                    return
                requests.push({ op, args })
                try {
                    if (!ops[op])
                        fail("unknown_op", `Unknown Discord operation ${op}`)
                    deliver({ id, ok: true, result: ops[op](args) })
                } catch (error) {
                    deliver({ id, ok: false, error: { code: error.code, message: error.message } })
                }
            },
        },
    }
}

module.exports = { fakeDiscordHub }
