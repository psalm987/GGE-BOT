const path = require("node:path")
const Module = require("node:module")
const { workerData } = require("node:worker_threads")

const { control } = workerData
const repo = path.resolve(__dirname, "..", "..")

class FakeWebSocket {
    constructor(url, options) {
        this.url = url
        control.postMessage({ type: "socket", url, agent: options?.agent?.constructor.name ?? null })
        FakeWebSocket.instance = this
        this.readyState = 0
        if (workerData.connect)
            setImmediate(() => this.open())
    }
    open() {
        this.readyState = 1
        this.onopen?.()
    }
    send(msg) { control.postMessage({ type: "sent", msg, at: performance.now() }) }
    pause() { control.postMessage({ type: "paused" }) }
    close() { control.postMessage({ type: "closed" }); this.onclose?.({ code: 1005 }) }
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    if (request === "ws" && !workerData.realSocket)
        return FakeWebSocket
    if (/(^|\/)protocols(\.js)?$/.test(request))
        return { KingdomID: {}, castles: [] }
    if (/plugins\/misc\.js$/.test(request))
        return {}
    return originalLoad.call(this, request, parent, isMain)
}

const bot = require(path.join(repo, "ggeBot.js"))
bot.events.on("load", () => control.postMessage({ type: "load" }))

control.on("message", m => {
    if (m.type === "open")
        FakeWebSocket.instance.open()
    if (m.type === "frame")
        FakeWebSocket.instance.onmessage({ data: m.data })
    if (m.type === "serverClose")
        FakeWebSocket.instance.onclose?.({ code: m.code })
    if (m.type === "socketError")
        FakeWebSocket.instance.onerror?.({ message: m.message, error: Object.assign(new Error(m.message), { code: m.code }) })
    if (m.type === "wait") {
        bot.waitForResult(m.key, m.timeout).then(
            ([, result]) => control.postMessage({ type: "waited", id: m.id, result }),
            error => control.postMessage({ type: "waited", id: m.id, error: String(error) }))
        control.postMessage({ type: "listening", id: m.id })
    }
})
