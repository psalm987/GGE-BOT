if (require("node:worker_threads").isMainThread) {
    const { baronOptions, baronChecks } = require("./sharedBarronAttackLogic.js")
    return module.exports = { targets: [{ kingdom: 2, areaType: require("../../areaTypes.js").AreaType.barron }], pluginOptions: baronOptions({ kingdom: 2 }), checks: baronChecks }
}

const { KingdomID, AreaType } = require("../../protocols.js")
const { botConfig, events } = require("../../ggeBot.js")
const commonAttack = require("./sharedBarronAttackLogic.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

events.on("load", () => commonAttack(AreaType.barron, KingdomID.everWinterGlacier, pluginOptions, 51, __filename))
