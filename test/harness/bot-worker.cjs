const path = require("node:path")
const Module = require("node:module")
const { workerData } = require("node:worker_threads")

const { control, ggeConfig } = workerData
const repo = path.resolve(__dirname, "..", "..")

class FakeWebSocket {
    constructor(url) {
        this.url = url
        FakeWebSocket.instance = this
        setImmediate(() => this.onopen?.())
    }
    send(msg) { control.postMessage({ type: "sent", msg }) }
    pause() { control.postMessage({ type: "paused" }) }
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    if (request === "ws")
        return FakeWebSocket
    if (/ggeConfig\.json$/.test(request))
        return ggeConfig
    if (/(^|\/)protocols(\.js)?$/.test(request))
        return { KingdomID: {}, castles: [] }
    if (/plugins\/misc\.js$/.test(request))
        return {}
    return originalLoad.call(this, request, parent, isMain)
}

const bot = require(path.join(repo, "ggeBot.js"))
bot.events.on("load", () => control.postMessage({ type: "load" }))

control.on("message", m => {
    if (m.type === "frame")
        FakeWebSocket.instance.onmessage({ data: m.data })
    if (m.type === "wait") {
        bot.waitForResult(m.key, m.timeout).then(
            ([, result]) => control.postMessage({ type: "waited", id: m.id, result }),
            error => control.postMessage({ type: "waited", id: m.id, error: String(error) }))
        control.postMessage({ type: "listening", id: m.id })
    }
})
