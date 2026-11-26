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

/**
 * The next skip for `minutes` left, keeping big skips for when small ones can't do the job:
 * 1. the smallest that finishes it wasting at most max(2 min, 10%);
 * 2. else, if the skips shorter than the time left add up to it, the largest of those (the caller repeats);
 * 3. else the smallest that finishes it on its own;
 * 4. else the largest there is.
 * A skip more than four times the time left is never offered unless `bypassSkipTypeFilter` is on.
 */
function pickSkip(skips, minutes) {
    const available = Object.keys(skips)
        .filter(key => skips[key] > 0 && (pluginOptions.bypassSkipTypeFilter || MinuteSkipType[key] <= minutes * 4))
        .sort((a, b) => MinuteSkipType[a] - MinuteSkipType[b])
    const tolerance = Math.max(2, minutes * 0.1)
    const finisher = available.find(key => MinuteSkipType[key] >= minutes && MinuteSkipType[key] - minutes <= tolerance)
    if (finisher)
        return finisher
    const smaller = available.filter(key => MinuteSkipType[key] < minutes)
    if (smaller.reduce((total, key) => total + MinuteSkipType[key] * skips[key], 0) >= minutes)
        return smaller.at(-1)
    return available.find(key => MinuteSkipType[key] >= minutes) ?? smaller.at(-1)
}

/** `skipTypes` is the calling plugin's stored `skipTypes` option, if it has one. */
function haveEnoughSkips(time, skipTypes) {
    const skips = spendable(skipTypes)
    let minutes = Math.ceil(time / 60)

    while (minutes > 0) {
        const skip = pickSkip(skips, minutes)

        if (skip == undefined)
            return false

        skips[skip]--
        minutes -= MinuteSkipType[skip]
    }
    return true
}

const resourceOf = key => SKIPS.find(skip => skip.key == key).resource

/** Picks a skip for `time` seconds and takes it off the count at once, since the game's new count can come after the next pick. */
function spendSkip(time, skipTypes) {
    const minutes = Math.ceil(time / 60)
    const skip = minutes > 0 ? pickSkip(spendable(skipTypes), minutes) : undefined

    if (skip == undefined)
        return console.warn("noMoreSkips")

    resources[resourceOf(skip)]--
    console.debug("usingSkip", skip)

    return skip
}

const NO_TIME_SKIP_LEFT = 335
const NOT_COOLING_DOWN = 311

/**
 * Call when the game refuses a skip that `spendSkip` picked. True when the caller should pick again: the game has
 * none of that type left, so its count was stale and is now 0. A timer that was already over used nothing, so that
 * skip counts again.
 */
function skipRefused(skip, result) {
    if (Number(result) == NOT_COOLING_DOWN) {
        resources[resourceOf(skip)]++
        return false
    }
    if (Number(result) != NO_TIME_SKIP_LEFT)
        return false
    resources[resourceOf(skip)] = 0
    console.warn("skipTypeRanOut", skip)
    return true
}

module.exports = { spendSkip, skipRefused, haveEnoughSkips, MinuteSkipType }
