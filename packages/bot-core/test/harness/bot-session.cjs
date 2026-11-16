const path = require("node:path")
const { Worker, MessageChannel } = require("node:worker_threads")

const sys = action => `<msg t='sys'><body action='${action}' r='0'></body></msg>`
const SERVER = {
    apiOK: sys("apiOK"),
    joinOK: "<msg t='sys'><body action='joinOK' r='1'><pid id='0'/><vars /><uLs r='1'></uLs></body></msg>",
}

/**
 * Runs the real ggeBot.js in a worker against a scripted fake game socket.
 * With `realSocket` the bot opens a real `ws` connection instead, and only what it tells its parent can be checked.
 */
function startBot({ timeoutMultiplier = 0.01, exitOnFatal = false, metricsFlushMs = 100, inboundStaleMs, pinIntervalMs, humanize, gameClientBuild, connect = true, proxyUrl, realSocket = false } = {}) {
    const { port1, port2 } = new MessageChannel()
    const worker = new Worker(path.join(__dirname, "bot-worker.cjs"), {
        workerData: {
            control: port2,
            connect,
            realSocket,
            ...(proxyUrl && { proxyUrl }),
            ggeConfig: { timeoutMultiplier, exitOnFatal, metricsFlushMs, inboundStaleMs, pinIntervalMs, humanize, gameClientBuild },
            name: "tester",
            pass: "pw",
            gameURL: "fake.invalid",
            gameServer: "EmpireEx_1",
            plugins: {},
        },
        transferList: [port2],
        stdout: true,
        stderr: true,
    })

    let chatter
    const session = {
        sent: [],
        /** When the bot sent each frame of `sent`, on the worker's clock. */
        sentAt: [],
        toParent: [],
        /** How the bot built its game socket: the URL and its agent's class name, null for a direct connection. */
        socket: undefined,
        /** Everything the worker printed. */
        output: "",
        loads: 0,
        paused: false,
        closed: false,
        botStates: () => session.toParent.filter(m => m[0] === 20).map(m => m[1]),
        metricBatches: () => session.toParent.filter(m => m[0] === 21).map(m => m[1]),
        heartbeats: () => session.toParent.filter(m => m[0] === 22).map(m => m[1]),
        exited: false,
        waits: new Map(),
        connect: () => port1.postMessage({ type: "open" }),
        frame: data => port1.postMessage({ type: "frame", data }),
        serverClose: code => port1.postMessage({ type: "serverClose", code }),
        socketError: (message, code) => port1.postMessage({ type: "socketError", message, code }),
        xt: (cmd, result, obj = {}) => session.frame(`%xt%${cmd}%1%${result}%${JSON.stringify(obj)}%`),
        sentXT: cmd => session.sent.filter(m => m.startsWith("%xt%") && m.split("%")[3] === cmd),
        until: async (predicate, ms = 2000) => {
            const deadline = Date.now() + ms
            while (!predicate()) {
                if (Date.now() > deadline)
                    throw new Error("timed out waiting for bot")
                await new Promise(r => setTimeout(r, 10))
            }
        },
        /** Starts a waitForResult in the bot. Resolves to `{ done }` once its listener is registered. */
        startWaitForResult: (key, timeout) => new Promise(listening => {
            const id = Math.random()
            const done = new Promise(resolve => session.waits.set(id, { listening, resolve }))
            session.waits.get(id).done = done
            port1.postMessage({ type: "wait", key, timeout, id })
        }),
        async login() {
            await session.until(() => session.sent.some(m => m.includes('action="verChk"')))
            session.frame(SERVER.apiOK)
            await session.until(() => session.sent.some(m => m.includes('action="login"')))
            session.frame(SERVER.joinOK)
            session.xt("vck", 0)
            await session.until(() => session.sentXT("lli").length === 1)
        },
        /** Answers like a live server would, so a quiet test isn't ended as a stale connection. */
        keepAlive: () => { chatter ??= setInterval(() => session.xt("pin", 0), 500) },
        stop: () => {
            clearInterval(chatter)
            return worker.terminate()
        },
    }

    port1.on("message", m => {
        if (m.type === "sent") {
            session.sent.push(m.msg)
            session.sentAt.push(m.at)
        }
        if (m.type === "socket") session.socket = { url: m.url, agent: m.agent }
        if (m.type === "load") session.loads++
        if (m.type === "paused") session.paused = true
        if (m.type === "closed") session.closed = true
        if (m.type === "listening") session.waits.get(m.id)?.listening({ done: session.waits.get(m.id).done })
        if (m.type === "waited") session.waits.get(m.id)?.resolve(m)
    })
    worker.on("message", m => session.toParent.push(m))
    for (const stream of [worker.stdout, worker.stderr])
        stream.on("data", chunk => { session.output += chunk })
    worker.on("exit", () => { session.exited = true })
    return session
}

module.exports = { startBot }
