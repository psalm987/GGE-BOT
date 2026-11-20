if (require('node:worker_threads').isMainThread)
    return module.exports = {
        checks: [{ type: "commanders", option: "commanderWhiteList" }, { type: "dailyAttacks" }],
        pluginOptions: [
            {
                type: "Select",
                key: "eventDifficulty",
                selection: [
                    "Classic",
                    "Easy",
                    "Easy+",
                    "Intermediate",
                    "Intermediate+",
                    "Hard",
                    "Hard+",
                    "Expert",
                    "Expert+",
                    "Master",
                    "Master+",
                    "Archmaster"
                ],
                default: "4"
            },
            ...require("../../eventCamps.js").campTargetOptions(),
            ...require("../../army.js").armyOptions({ sides: { left: true, front: true, right: true, courtyard: true }, waves: "all", tools: ["noChests", "lowValueChests"], whenNoTools: "eventTools", unitOrder: "unitOrder", supply: "supply" }),
            {
                type: "Text",
                key: "commanderWhiteList",
                default: "1-50"
            },
            { type: "SkipTypes", key: "skipTypes", default: null, advanced: true },
            {
                type: "Checkbox",
                key: "lowValueChests",
                army: "autofill",
                default: false
            },
            {
                type: "Checkbox",
                key: "noChests",
                army: "autofill",
                default: false
            },
            {
                type: "Checkbox",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                key: "useCoin",
                default: false
            },
            {
                type: "Checkbox",
                key: "foodTroopsOnly",
                army: "autofill",
                default: false
            },
            {
                type: "Text",
                key: "scoreShutoff"
            },
            require("../../army.js").unitOrderOption(),
            require("../../army.js").supplyOption(),
            {
                type: "Checkbox",
                key: "dryRun",
                default: false,
                advanced: true
            }
        ]

    }

const { botConfig } = require("../../ggeBot.js")
const { EVENT_PROFILES } = require("../../eventCamps.js")
const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

require("./sharedEventCampLogic.js")(EVENT_PROFILES.samurai, pluginOptions, __filename)
