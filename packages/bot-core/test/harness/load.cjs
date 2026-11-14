const path = require("node:path")
const Module = require("node:module")
const { EventEmitter } = require("node:events")

const repo = path.resolve(__dirname, "..", "..")

function fakeBot(overrides = {}) {
    const xtHandler = new EventEmitter()
    const sent = []
    const pending = []
    const bot = {
        xtHandler,
        events: new EventEmitter(),
        status: {},
        playerInfo: { playerID: 7, alliance: {} },
        botConfig: { name: "test", plugins: {}, gameServer: "EmpireEx_1" },
        sent,
        sendXT: async (cmd, params) => { sent.push([cmd, JSON.parse(params)]) },
        waitForResult: (key, _timeout, filter = () => true) => new Promise(resolve => {
            const handler = (obj, result) => {
                if (!filter(Object(obj), Number(result)))
                    return
                xtHandler.removeListener(key, handler)
                resolve([Object(obj), Number(result)])
            }
            xtHandler.on(key, handler)
            pending.push(key)
        }),
        ...overrides,
    }
    return bot
}

/**
 * Requires a repo module in worker mode with the game connection replaced.
 * `bot` stands in for ggeBot.js; `items` maps item file names to contents
 * (the real ones are downloaded at boot and are not in the repo).
 */
function loadModule(relPath, { bot = fakeBot(), items = {}, extra = {}, mainThread = false } = {}) {
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
        if (request === "node:worker_threads")
            return { isMainThread: mainThread, parentPort: { postMessage() {}, on() {} }, workerData: bot.botConfig }
        if (/(^|\/)ggeBot(\.js)?$/.test(request))
            return bot
        const item = request.match(/\/items\/([^/]+)\.json$/)
        if (item)
            return items[item[1]] ?? []
        for (const [pattern, value] of Object.entries(extra))
            if (request.endsWith(pattern))
                return value
        return originalLoad.call(this, request, parent, isMain)
    }
    try {
        for (const key of Object.keys(require.cache))
            if (key.startsWith(repo) && !key.includes("node_modules"))
                delete require.cache[key]
        return { mod: require(path.join(repo, relPath)), bot }
    } finally {
        Module._load = originalLoad
    }
}

module.exports = { loadModule, fakeBot, repo }
