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

const { xtHandler, sendXT, botConfig, playerInfo } = require("../ggeBot.js")
const { loadItem } = require("../paths.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

/** How many helpers each request type takes, by its type ID (items/alliancehelprequests.json). Empty when the game data lacks it. */
const helpersNeeded = (() => {
    try {
        return new Map(loadItem("alliancehelprequests").map(t => [Number(t.allianceHelpRequestID), Number(t.maxHelpersCount)]))
    } catch {
        return new Map()
    }
})()

const randomIntFromInterval = (min, max) =>
    Math.floor(Math.random() * (max - min + 1) + min)

/**
 * The alliance's open help requests by list ID, kept from the game's list (ahl), its additions and changes (ahh) and
 * its removals (ahd). P is the helpers so far, AC whether this player helped, RT the seconds left.
 */
const requests = new Map()
function readRequest(r) {
    if (!Number.isFinite(Number(r?.LID)))
        return
    requests.set(Number(r.LID), {
        playerID: Number(r.PID),
        type: Number(r.TID),
        helpers: Number(r.P) || 0,
        helped: Boolean(r.AC) || Boolean(requests.get(Number(r.LID))?.helped),
        expiresAt: Number(r.RT) > 0 ? Date.now() + Number(r.RT) * 1000 : Infinity,
    })
}

/** Other members' requests this player can still help: not helped yet, short of helpers, and not run out. */
const helpable = () => [...requests.values()].filter(r => r.playerID != playerInfo.playerID && !r.helped &&
    r.helpers < (helpersNeeded.get(r.type) ?? Infinity) && r.expiresAt > Date.now())

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

xtHandler.on("ahl", (obj, result) => {
    if (result != 0)
        return
    requests.clear()
    for (const r of obj?.AHL ?? [])
        readRequest(r)
    pressSoon()
})
xtHandler.on("ahh", (obj, result) => {
    if (result != 0)
        return
    readRequest(obj)
    pressSoon()
})
xtHandler.on("ahd", (obj, result) => {
    if (result == 0)
        requests.delete(Number(obj?.LID))
})
