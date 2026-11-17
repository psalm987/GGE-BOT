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

const { botConfig, i18n, events } = require("../../ggeBot.js")
const { KingdomID } = require("../../protocols.js")
const { createLayout } = require("../../imageGen.js")
const { clientReady, client, findMember } = require("./discord.js")
require("../incoming.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const kingdomName = [
    `\u001b[2;32m${i18n.__(KingdomID[0])}\u001b[0m`,
    `\u001b[2;33m${i18n.__(KingdomID[1])}\u001b[0m`,
    `\u001b[2;34m${i18n.__(KingdomID[2])}\u001b[0m`,
    `\u001b[2;31m${i18n.__(KingdomID[3])}\u001b[0m`,
    `\u001b[2;36m${i18n.__(KingdomID[4])}\u001b[0m`
]

/** The post for each attack, by movement id, so a later sighting of its army can add the picture. */
const posts = new Map()

const layoutFile = ({ left, middle, right, courtyard }) => ({
    attachment: createLayout(left, middle, right, courtyard),
    name: "attack.png"
})
const isAway = member => !["online", "dnd"].includes(member.presence?.status)

events.on("incoming:updated", async (/** @type {import("../incoming.js").IncomingAttack} */ attack) => {
    const message = await posts.get(attack.movementId)
    if (message?.attachments.size != 0)
        return
    posts.set(attack.movementId, message.edit({
        content: message.content,
        files: [layoutFile(attack.waves)]
    }).catch(e => (console.warn(e), message)))
})
events.on("incoming:cleared", (/** @type {import("../incoming.js").IncomingAttack} */ attack) => posts.delete(attack.movementId))

events.on("incoming:new", async (/** @type {import("../incoming.js").IncomingAttack} */ attack) => {
    await clientReady

    if (kingdomName[attack.kingdom] == undefined)
        return

    const timeLeft = (attack.arrivesAt - Date.now()) / 1000

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

    const channel = attack.kingdom != 4 ? channelAlert : channelAquaAlert
    
    if (channel == undefined)
        return

    const { attacker, sourceCastle, defender, targetCastle } = attack
    const clicks = Math.round(Math.sqrt(Math.pow(sourceCastle.x - targetCastle.x, 2) + Math.pow(sourceCastle.y - targetCastle.y, 2)) * 10) / 10
    const targetName = botConfig.externalEvent ? defender.name.replace(/_[^_]+$/, '') : defender.name
    const member = channelAlert && await findMember(channelAlert, targetName)
    const mention = member?.displayName ? `<@${member.id}> ` : ``
    const data = {
        content : `${mention}` +  (pluginOptions.mentionEveryone ? " @everyone" : "") +
        "```ansi\n" +
        `${attacker.name} (${sourceCastle.extraData[7]})${i18n.__("incomingFrom")}${attacker.allianceName}` +
        `${i18n.__("incomingIsAttacking")}${defender.name} (${targetCastle.extraData[7]})${i18n.__("incomingIn")}${kingdomName[attack.kingdom]} ${clicks}${i18n.__("incomingClicks")}` +
        "```" +
        `<t:${Math.round(attack.arrivesAt / 1000)}:R>`
    }

    if (attack.waves)
        data.files = [layoutFile(attack.waves)]
    
    const post = channel.send(data)
    posts.set(attack.movementId, post)
    await post

    if (!channelAlert)
        return

    if (member && attack.kingdom != KingdomID.stormIslands && isAway(member)) {
        const spreadAlert = async () => {
            const current = await findMember(channelAlert, targetName)
            if (current && isAway(current))
                await channelAlert.send(`<@${current.id}> `)
        }
        for (const divisor of [4, 3, 2, 1.5])
            setTimeout(() => spreadAlert().catch(console.warn), timeLeft * 1000 / divisor).unref()
    }
})
