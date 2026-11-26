// Stands in for ggeBot.js. What it does depends on the account name's prefix.
import { parentPort, workerData } from "node:worker_threads"

const post = message => parentPort.postMessage(message)
const later = (ms, fn) => setTimeout(fn, ms)
const mode = workerData.name.split("-")[0]

post([5, 0, ["spawned", " ", workerData.gameURL, " ", workerData.gameServer, " plugins=", Object.keys(workerData.plugins).sort().join(",")]])
post([5, 0, [workerData.pass === `pw-${workerData.name}` ? "password ok" : "password WRONG"]])
post([21, { counters: [["bot_messages_total", { direction: "out", command: "lli" }, 1]], observations: [] }])

parentPort.on("message", ([type, payload]) => {
    if (type === 17)
        post([5, 0, ["options ", JSON.stringify(payload.plugins)]])
    if (type === 16)
        post([16, { sei: { E: [] }, glt: { TSIP: "event-host.test", TSZ: "EmpireEx_99" } }])
})

const beat = phase => setInterval(() => post([22, { phase }]), 50)

switch (mode) {
    case "silent":
        later(10, () => post([14]))
        break
    case "hang":
        later(10, () => {
            post([14])
            for (;;) { /* a blocked event loop */ }
        })
        break
    case "sysfail":
        later(10, () => post([20, { state: "error", reason: "CLIENT_VERSION_REJECTED" }]))
        later(20, () => process.exit(0))
        break
    case "netfail":
        later(10, () => post([20, { state: "error", reason: "SOCKET_ERROR:1006" }]))
        later(20, () => process.exit(0))
        break
    case "login":
        beat("login")
        break
    case "proxyfail":
        // Fails only through a proxy; connected directly it runs.
        if (workerData.proxyUrl) {
            later(10, () => post([20, { state: "error", reason: "PROXY_ECONNREFUSED" }]))
            later(20, () => process.exit(0))
            break
        }
    // falls through
    case "discord":
        post([23, { id: 1, op: "channelSend", args: { channelId: "1", payload: { content: `hello from ${workerData.name}` } } }])
        parentPort.on("message", ([type, payload]) => {
            if (type === 23)
                post([5, 0, [`discord reply ${payload.ok} `, payload.result?.content ?? payload.error?.message]])
        })
    // falls through
    case "pstatus":
        if (mode === "pstatus") {
            post([24, { plugin: "attack", state: "running", reasonKey: "statusAttacksToday", params: { used: 3, limit: 10 } }])
            post([24, { plugin: "", state: "bogus", reasonKey: 5, params: null }])
        }
    // falls through
    case "notify":
        if (mode === "notify") {
            const notice = { kind: "incoming_attack", key: "0:1001:42", data: { attacker: "Raider", castle: "Keep", arrival: "2031-02-03T04:05:06.000Z" } }
            post([25, notice])
            post([25, notice])
            post([25, { kind: "banned", key: "k", data: { bannedUntil: null } }])
        }
    // falls through
    case "ok":
    case "event":
        later(10, () => post([14]))
        beat("running")
        break
    case "crash":
        later(10, () => post([14]))
        later(40, () => process.exit(1))
        break
    case "fatal":
        later(10, () => post([20, { state: "error", reason: "tooManyImportantErrors" }]))
        later(20, () => process.exit(0))
        break
    case "kicked":
        later(10, () => post([14]))
        later(20, () => post([20, { state: "error", reason: "KICKED" }]))
        later(30, () => process.exit(0))
        break
    case "authfail":
        later(10, () => post([20, { state: "auth_failed", reason: "INVALID_PASSWORD" }]))
        later(20, () => post([19]))
        break
    case "banned":
        later(10, () => post([20, { state: "banned", reason: "IS_BANNED", bannedUntil: Date.parse("2030-01-01T00:00:00Z") }]))
        break
    case "oom": {
        const hoard = []
        later(10, () => { for (;;) hoard.push(new Array(1e5).fill(Math.random())) })
        break
    }
    case "shutoff":
        later(10, () => post([14]))
        later(40, () => post([19]))
        break
}

setInterval(() => {}, 1 << 30)
