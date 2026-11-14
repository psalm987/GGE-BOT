const path = require("node:path")
const { Worker, MessageChannel } = require("node:worker_threads")

const sys = action => `<msg t='sys'><body action='${action}' r='0'></body></msg>`
const SERVER = {
    apiOK: sys("apiOK"),
    joinOK: "<msg t='sys'><body action='joinOK' r='1'><pid id='0'/><vars /><uLs r='1'></uLs></body></msg>",
}

/** Runs the real ggeBot.js in a worker against a scripted fake game socket. */
function startBot({ timeoutMultiplier = 0.01, exitOnFatal = false, metricsFlushMs = 100 } = {}) {
    const { port1, port2 } = new MessageChannel()
    const worker = new Worker(path.join(__dirname, "bot-worker.cjs"), {
        workerData: {
            control: port2,
            ggeConfig: { timeoutMultiplier, exitOnFatal, metricsFlushMs },
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

    const session = {
        sent: [],
        toParent: [],
        loads: 0,
        paused: false,
        closed: false,
        botStates: () => session.toParent.filter(m => m[0] === 20).map(m => m[1]),
        metricBatches: () => session.toParent.filter(m => m[0] === 21).map(m => m[1]),
        exited: false,
        waits: new Map(),
        frame: data => port1.postMessage({ type: "frame", data }),
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
        stop: () => worker.terminate(),
    }

    port1.on("message", m => {
        if (m.type === "sent") session.sent.push(m.msg)
        if (m.type === "load") session.loads++
        if (m.type === "paused") session.paused = true
        if (m.type === "closed") session.closed = true
        if (m.type === "listening") session.waits.get(m.id)?.listening({ done: session.waits.get(m.id).done })
        if (m.type === "waited") session.waits.get(m.id)?.resolve(m)
    })
    worker.on("message", m => session.toParent.push(m))
    worker.on("exit", () => { session.exited = true })
    return session
}

module.exports = { startBot }
