if (require('node:worker_threads').isMainThread)
    return module.exports = {
        hidden: true
    }

// Under the runner one Discord client serves every bot and this worker talks
// to it by message. Only the legacy host hands a bot the token, and there the
// bot opens a client of its own.
module.exports = require("../../config.js").discordToken
    ? require("../../discord/in-process-client.js")
    : require("../../discord/hub-client.js")
