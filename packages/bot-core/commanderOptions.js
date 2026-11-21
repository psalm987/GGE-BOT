/**
 * The options of a plugin that sends commanders: the commander list, in the order the bot sends them, and the VIP
 * commander cap, which the bot does not use yet. The settings page draws the two as one commander picker for the
 * whole module, which `commanderChecks` marks.
 */
const commanderOptions = () => [
    { type: "Text", key: "commanderWhiteList", default: "1-50" },
    { type: "Number", key: "vipCommanders", min: 0, max: 50, default: 0 },
]
const commanderChecks = [{ type: "commanders", option: "commanderWhiteList", vip: "vipCommanders" }]

module.exports = { commanderOptions, commanderChecks }
