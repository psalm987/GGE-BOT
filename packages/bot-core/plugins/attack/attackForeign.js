if (require("node:worker_threads").isMainThread) {
    const { gloryOptions, gloryChecks } = require("./sharedGloryLogic.js")
    return module.exports = { pluginOptions: gloryOptions, checks: gloryChecks }
}

const { AreaType } = require("../../protocols.js")

require("./sharedGloryLogic.js")(__filename, { eventID: 71, areaType: AreaType.alienCastle, difficultyIDs: [1, 11] })
