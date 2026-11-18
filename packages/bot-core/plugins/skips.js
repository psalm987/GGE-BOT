if (require('node:worker_threads').isMainThread)
    return module.exports = {
        pluginOptions: [
            {
                type: "Checkbox",
                key: "bypassSkipTypeFilter",
                default: false
            },
            { type: "Label", key: "skipTypes" },
            {
                type: "Checkbox",
                key: "1Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "5Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "10Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "30Minute",
                default: true
            },
            {
                type: "Checkbox",
                key: "1Hour",
                default: true
            },
            {
                type: "Checkbox",
                key: "5Hour",
                default: true
            },
            {
                type: "Checkbox",
                key: "24Hour",
                default: true
            },
        ],
        force: true
    }

const { botConfig } = require("../ggeBot")
const { resources } = require('../protocols')

const MinuteSkipType = Object.freeze({
    MS1: 1,
    MS2: 5,
    MS3: 10,
    MS4: 30,
    MS5: 60,
    MS6: 60 * 5,
    MS7: 60 * 24
})

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}

const SKIPS = [
    { key: "MS1", option: "1Minute", resource: "1MinSkip" },
    { key: "MS2", option: "5Minute", resource: "5MinSkip" },
    { key: "MS3", option: "10Minute", resource: "10MinSkip" },
    { key: "MS4", option: "30Minute", resource: "30MinSkip" },
    { key: "MS5", option: "1Hour", resource: "60MinSkip" },
    { key: "MS6", option: "5Hour", resource: "5HourSkip" },
    { key: "MS7", option: "24Hour", resource: "24HourSkip" },
]

/**
 * A plugin's own stored `skipTypes` option, parsed: the skips it may spend, in minutes, or null to follow the Skips
 * settings. A stored value that is neither is ignored with a warning, and the Skips settings apply.
 */
function parseSkipTypes(value) {
    if (value === null || value === undefined)
        return null
    const minutes = Object.values(MinuteSkipType)
    if (!Array.isArray(value) || !value.every(entry => minutes.includes(entry))) {
        console.warn("skipTypesInvalid")
        return null
    }
    return value
}

/** How many of each skip may be spent: the plugin's own list when it stored one, else the Skips settings. */
function spendable(stored) {
    const skipTypes = parseSkipTypes(stored)
    return Object.fromEntries(SKIPS.map(({ key, option, resource }) =>
        [key, (skipTypes ? skipTypes.includes(MinuteSkipType[key]) : pluginOptions[option]) ? Number(resources[resource]) : 0]))
}

function bestSkip(skips, time) {
    return Object.entries(skips)
        .filter(e => e[1] > 0)
        .filter(e => pluginOptions.bypassSkipTypeFilter || MinuteSkipType[e[0]] <= time * 4)
        .sort((a, b) => (time > MinuteSkipType[a[0]]) - (time > MinuteSkipType[b[0]]))
        .sort((a, b) => Math.min(Math.max(b[1], 950), 951) - Math.min(Math.max(a[1], 950), 951))[0]
}

/** `skipTypes` is the calling plugin's stored `skipTypes` option, if it has one. */
function haveEnoughSkips(time, skipTypes) {
    const skips = spendable(skipTypes)
    time = Math.ceil(time / 60)

    while (time > 0) {
        const skip = bestSkip(skips, time)

        if (skip == undefined)
            return false

        skips[skip[0]]--
        time -= MinuteSkipType[skip[0]]
    }
    return true
}

function spendSkip(time, skipTypes) {
    time = Math.ceil(time / 60)
    const skip = bestSkip(spendable(skipTypes), time)

    if (skip == undefined)
        return console.warn("noMoreSkips")

    console.debug("usingSkip", skip[0])

    return skip[0]
}

module.exports = { spendSkip, haveEnoughSkips, MinuteSkipType }
