if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "fastHelp",
                default: false
            }
        ]
    }

const { xtHandler, sendXT, botConfig } = require("../ggeBot.js")
const { helpable } = require("../allianceHelp.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const randomIntFromInterval = (min, max) =>
    Math.floor(Math.random() * (max - min + 1) + min)

let pressPending = false
function pressSoon() {
    if (pressPending || helpable().length == 0)
        return
    pressPending = true
    const seconds = pluginOptions.fastHelp ? randomIntFromInterval(1, 5) : randomIntFromInterval(60, 60 * 2)
    setTimeout(() => {
        pressPending = false
        const open = helpable()
        if (open.length == 0)
            return
        // Marked before the game confirms, so the same requests are never pressed for twice.
        open.forEach(r => r.helped = true)
        sendXT("aha", JSON.stringify({ KID: 15 }))
    }, seconds * 1000)
}

// allianceHelp.js reads the list first, since it registered its listeners when it was required.
xtHandler.on("ahl", (_obj, result) => result == 0 && pressSoon())
xtHandler.on("ahh", (_obj, result) => result == 0 && pressSoon())
