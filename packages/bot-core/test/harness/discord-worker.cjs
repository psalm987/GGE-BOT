// A real worker thread running one Discord plugin against a faked game. The
// plugin's Discord traffic goes to the real parent port; `control` drives the
// game side and reports what the plugin sends into it.
const path = require("node:path")
const Module = require("node:module")
const { EventEmitter } = require("node:events")
const { workerData } = require("node:worker_threads")

const { control, plugin } = workerData
const repo = path.resolve(__dirname, "..", "..")

const bot = {
    xtHandler: new EventEmitter(),
    events: new EventEmitter(),
    botConfig: workerData,
    playerInfo: { alliance: {} },
    i18n: { __: key => String(key) },
    sendXT: async (cmd, params) => control.postMessage({ type: "sent", cmd, params: JSON.parse(params) }),
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    if (/(^|\/)ggeBot(\.js)?$/.test(request))
        return bot
    return originalLoad.call(this, request, parent, isMain)
}

require(path.join(repo, plugin))

control.on("message", message => {
    if (message.type == "game")
        bot.xtHandler.emit(message.cmd, message.data)
    if (message.type == "discordModules")
        control.postMessage({
            type: "discordModules",
            files: Object.keys(require.cache).filter(file => /node_modules\/(discord\.js|@discordjs)\//.test(file)),
        })
})
