if (require('node:worker_threads').isMainThread)
    return module.exports = {
        checks: require("../../commanderOptions.js").commanderChecks,
        pluginOptions: [
            { type: "CastlePicker", key: "sourceCastle", kingdom: 2, default: null },
            ...require("../../commanderOptions.js").commanderOptions(),
            ...require("../../army.js").fortressOptions(3)
        ]
    }

const { KingdomID } = require("../../protocols.js")
const { botConfig, events } = require('../../ggeBot.js')
const fortressHit = require('./sharedFortressAttackLogic.js')

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const kid = KingdomID.everWinterGlacier
const level = 20

events.on("load", () => 
    fortressHit(kid, level, pluginOptions, __filename))