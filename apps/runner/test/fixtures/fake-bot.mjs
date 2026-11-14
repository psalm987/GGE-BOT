// Stands in for ggeBot.js. What it does depends on the account name's prefix.
import { parentPort, workerData } from "node:worker_threads"

const post = message => parentPort.postMessage(message)
const later = (ms, fn) => setTimeout(fn, ms)
const mode = workerData.name.split("-")[0]

post([5, 0, ["spawned", " ", workerData.gameURL, " ", workerData.gameServer, " plugins=", Object.keys(workerData.plugins).sort().join(",")]])
post([5, 0, [workerData.pass === `pw-${workerData.name}` ? "password ok" : "password WRONG"]])

parentPort.on("message", ([type, payload]) => {
    if (type === 17)
        post([5, 0, ["options ", JSON.stringify(payload.plugins)]])
    if (type === 16)
        post([16, { sei: { E: [] }, glt: { TSIP: "event-host.test", TSZ: "EmpireEx_99" } }])
})

switch (mode) {
    case "ok":
    case "event":
        later(10, () => post([14]))
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
    case "shutoff":
        later(10, () => post([14]))
        later(40, () => post([19]))
        break
}

setInterval(() => {}, 1 << 30)
