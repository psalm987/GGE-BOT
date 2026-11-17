if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Channel",
                key: "channelID"
            }, 
            {
                type: "Channel",
                key: "stormChannelID"
            }, 
            {
                type: "Checkbox",
                key: "mentionEveryone"
            }
        ]
    }

const { botConfig, playerInfo, i18n } = require("../../ggeBot.js")
const { movementEvents, KingdomID } = require("../../protocols.js")
const { createLayout } = require("../../imageGen.js")
const { clientReady, client, findMember } = require("./discord.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const kingdomName = [
    `\u001b[2;32m${i18n.__(KingdomID[0])}\u001b[0m`,
    `\u001b[2;33m${i18n.__(KingdomID[1])}\u001b[0m`,
    `\u001b[2;34m${i18n.__(KingdomID[2])}\u001b[0m`,
    `\u001b[2;31m${i18n.__(KingdomID[3])}\u001b[0m`,
    `\u001b[2;36m${i18n.__(KingdomID[4])}\u001b[0m`
]

const storedMessages = new WeakMap()

const layoutFile = movement => ({
    attachment: createLayout(movement.left, movement.middle, movement.right, movement.courtyard),
    name: "attack.png"
})
const isAway = member => !["online", "dnd"].includes(member.presence?.status)

movementEvents.on("outgoing", async (/** @type {import("../../protocols.js").ClassTypes.Movement} */ movement) => {
    await clientReady

    if (![0, 25, 31, 24, 29].includes(movement.type))
        return
    if (movement.sourceOwner.ownerID < 0)
        return
    if (movement.targetOwner.ownerID < 0)
        return
    if (movement.sourceOwner.allianceID == playerInfo.alliance.id)
        return
    if (movement.targetOwner.allianceID != playerInfo.alliance.id)
        return

    if (kingdomName[movement.kingdomID] == undefined)
        return

    if (movement.canSeeArmy) {
        const message = await storedMessages.get(movement)
        if (message) {
            if (message?.attachments.size == 0) {
                // Kept, so the next sighting of this attack sees the picture and doesn't draw it again.
                storedMessages.set(movement, message.edit({
                    content: message.content,
                    files: [layoutFile(movement)]
                }).catch(e => (console.warn(e), message)))
            }
            return
        }
    }

    const timeLeft = (movement.totalTime - (movement.deltaTime - Date.now())) / 1000

    try {
        var channelAlert = await client.channels.fetch(pluginOptions.channelID)
    }
    catch (e) {
        console.warn(e)
    }
    try {
        if (pluginOptions.stormChannelID)
            var channelAquaAlert = await client.channels.fetch(pluginOptions.stormChannelID)
    }
    catch (e) {
        console.warn(e)
    }

    const channel = movement.kingdomID != 4 ? channelAlert : channelAquaAlert
    
    if (channel == undefined)
        return

    const clicks = Math.round(Math.sqrt(Math.pow(movement.sourceAttack.x - movement.targetAttack.x, 2) + Math.pow(movement.sourceAttack.y - movement.targetAttack.y, 2)) * 10) / 10
    const targetName = botConfig.externalEvent ? movement.targetOwner.name.replace(/_[^_]+$/, '') : movement.targetOwner.name
    const member = channelAlert && await findMember(channelAlert, targetName)
    const mention = member?.displayName ? `<@${member.id}> ` : ``
    const data = {
        content : `${mention}` +  (pluginOptions.mentionEveryone ? " @everyone" : "") +
        "```ansi\n" +
        `${movement.sourceOwner.name} (${movement.sourceAttack.extraData[7]})${i18n.__("incomingFrom")}${movement.sourceOwner.allianceName}` +
        `${i18n.__("incomingIsAttacking")}${movement.targetOwner.name} (${movement.targetAttack.extraData[7]})${i18n.__("incomingIn")}${kingdomName[movement.kingdomID]} ${clicks}${i18n.__("incomingClicks")}` +
        "```" +
        `<t:${Math.round(Date.now() / 1000 + timeLeft)}:R>`
    }

    if (movement.canSeeArmy)
        data.files = [layoutFile(movement)]
    
    storedMessages.set(movement, await channel.send(data))

    if (!channelAlert)
        return

    if (member && movement.kingdomID != KingdomID.stormIslands && isAway(member)) {
        const spreadAlert = async () => {
            const current = await findMember(channelAlert, targetName)
            if (current && isAway(current))
                await channelAlert.send(`<@${current.id}> `)
        }
        for (const divisor of [4, 3, 2, 1.5])
            setTimeout(() => spreadAlert().catch(console.warn), timeLeft * 1000 / divisor).unref()
    }
})