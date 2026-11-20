if (require('node:worker_threads').isMainThread)
    return module.exports = {
        checks: [{ type: "commanders", option: "commanderWhiteList" }],
        pluginOptions: [
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-50"
            },
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