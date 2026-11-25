const { EVENT_PROFILES, eventCampOptions, eventCampChecks } = require("../../eventCamps.js")

if (require("node:worker_threads").isMainThread)
    return module.exports = { pluginOptions: eventCampOptions(EVENT_PROFILES.daimyo), checks: eventCampChecks }

const { botConfig } = require("../../ggeBot.js")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

require("./sharedEventCampLogic.js")(EVENT_PROFILES.daimyo, pluginOptions, __filename)
