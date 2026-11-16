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
