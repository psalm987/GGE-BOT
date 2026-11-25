if (require('node:worker_threads').isMainThread)
    return module.exports = {
        targets: [{ kingdom: 3, areaType: require("../../areaTypes.js").AreaType.fortress }],
        checks: require("../../commanderOptions.js").commanderChecks,
        pluginOptions: [
            ...require("../../commanderOptions.js").commanderOptions(),
            ...require("../../army.js").fortressOptions(5)
        ]
    }

const { KingdomID } = require("../../protocols.js")
const { botConfig, events } = require('../../ggeBot.js')
const fortressHit = require('./sharedFortressAttackLogic.js')

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const kid = KingdomID.firePeaks
const level = 51

events.on("load", () => 
    fortressHit(kid, level, pluginOptions, __filename))