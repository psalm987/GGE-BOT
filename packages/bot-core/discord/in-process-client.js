// The legacy host (main.js) has no Discord hub, so there each bot logs in with
// the host's token itself. The runner uses hub-client.js instead.
const { Client, Events, GatewayIntentBits, Collection, REST, Routes } = require('discord.js')
const ggeConfig = require("../config.js")
const { events, botConfig } = require('../ggeBot')

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences]
})

client.on(Events.ClientReady, () => 
    client.user.setActivity(ggeConfig.discordBanner ? ggeConfig.discordBanner : 'https://github.com/darrenthebozz/GGE-BOT'))
client.login(ggeConfig.discordToken)

/** @type {Promise<Client>} */
const clientPromise = new Promise((resolve, reject) => {
    client.once(Events.Error, reject)
    client.once(Events.ClientReady, () => {
        client.off(Events.Error, reject)
        resolve(client)
    })
})

const commands = new Collection()

client.on(Events.InteractionCreate, async interaction => {
    const command = commands.get(interaction.commandName)

    if (!command) 
        return console.debug("noMatchingCommandWasFound", interaction.commandName)

    if (interaction.isAutocomplete()) {
        try {
            await command.autoComplete(interaction)
        } catch (error) {
            console.error(error)
        }
        return
    }
    if (!interaction.isChatInputCommand())
        return

    try {
        await command.execute(interaction)
    } catch (error) {
        console.error(error)
        if (interaction.replied || interaction.deferred)
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true })
        else
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true })
    }
})
async function refreshCommands() {
    if (!botConfig.discordData?.discordGuildId)
        return
    await clientPromise
    const rest = new REST().setToken(ggeConfig.discordToken)
    if (commands.size == 0)
        return console.warn("noCommands")
    
    await rest.put(
        Routes.applicationGuildCommands(
            ggeConfig.discordClientId, 
            botConfig.discordData.discordGuildId),
            { body: commands.map(command => command.data.toJSON()) },
    )
}

events.on("load", () => {
    refreshCommands.bind(this)()
})

const findMember = async (channel, displayName) => channel.members.find(member => member.displayName == displayName)

module.exports = { client, clientReady: clientPromise, commands, findMember }

