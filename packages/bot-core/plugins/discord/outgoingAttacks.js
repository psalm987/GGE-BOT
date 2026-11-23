if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID"
            }
        ]
    }

const { botConfig, playerInfo, i18n } = require("../../ggeBot.js")
const { movementEvents, KingdomID } = require("../../protocols.js")
const { createLayout } = require("../../imageGen.js")
const { clientReady, client } = require("./discord.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const kingdomName = [
    `\u001b[2;32m${i18n.__(KingdomID[0])}\u001b[0m`,
    `\u001b[2;33m${i18n.__(KingdomID[1])}\u001b[0m`,
    `\u001b[2;34m${i18n.__(KingdomID[2])}\u001b[0m`,
    `\u001b[2;31m${i18n.__(KingdomID[3])}\u001b[0m`,
    `\u001b[2;36m${i18n.__(KingdomID[4])}\u001b[0m`
]

/** Movement ids already posted. The game sends a movement again whenever its army comes into or out of sight. */
const posted = new Set()

movementEvents.on("outgoing", async (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    if (![0, 25, 31, 24, 29].includes(movement.type))
        return
    if (movement.owner.ownerID != playerInfo.playerID)
        return
    if (movement.targetOwner.ownerID < 0)
        return
    if (movement.targetOwner.allianceID == playerInfo.alliance.id)
        return

    if (kingdomName[movement.kingdomID] == undefined)
        return

    if (posted.has(movement.id))
        return
    posted.add(movement.id)

    const timeLeft = movement.totalTime - (movement.deltaTime - Date.now())
    const arrivesAt = Date.now() + timeLeft
    setTimeout(() => posted.delete(movement.id), Math.max(0, timeLeft)).unref()

    await clientReady

    try {
        var channel = await client.channels.fetch(pluginOptions.channelID)
    }
    catch (e) {
        console.warn(e)
    }

    if (channel == undefined)
        return

    const clicks = Math.round(Math.sqrt(Math.pow(movement.sourceAttack.x - movement.targetAttack.x, 2) + Math.pow(movement.sourceAttack.y - movement.targetAttack.y, 2)) * 10) / 10

    const data = {}
    data.content = "```ansi\n" +
        `${movement.sourceOwner.name} (${movement.sourceAttack.extraData[7]})` +
        `${i18n.__("incomingIsAttacking")}${movement.targetOwner.name} (${movement.targetAttack.extraData[7]})` +
        `${i18n.__("incomingFrom")}${movement.targetOwner.allianceName}${i18n.__("incomingIn")}` +
        `${kingdomName[movement.kingdomID]} ${clicks}${i18n.__("incomingClicks")}` +
        "```" +
        `<t:${Math.round(arrivesAt / 1000)}:R>`
    data.files = [{ attachment: createLayout(movement.left, movement.middle, movement.right, movement.courtyard), name: "attack.png" }]

    await channel.send(data)
})