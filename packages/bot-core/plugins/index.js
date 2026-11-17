const path = require('node:path')
const fs = require("fs")
const ggeConfig = require("../config.js")

const dir = fs.readdirSync(__dirname, {recursive : true})
const plugins = []

dir.forEach(file => {
    if(file == path.basename(__filename))
        return
    let pathSeperator = '/'
    if(process.platform == "win32")
         pathSeperator = '\\'

    if(fs.lstatSync(__dirname + pathSeperator + file).isDirectory())
        return 
    // The runner's Discord hub (discordHub) or, on the legacy host, a token for each bot to log in with.
    const hasDiscord = ggeConfig.discordHub || (ggeConfig.discordToken && ggeConfig.discordClientId)
    if(!hasDiscord && file.includes("discord"))
        return
    // Slash commands need a Discord client inside the bot, which only the legacy host gives it.
    if(ggeConfig.discordHub && path.basename(file) == "slashCommands.js")
        return

    if(path.extname(file) != ".js")
        return

    plugins.push([`plugins/${file.slice(0, -3)}`, require(path.join(__dirname, file))])
})

module.exports = plugins
