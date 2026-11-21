/**
 * Wraps `skipWait(areaInfo)` so a camp has at most one skip in flight. A march home and the attack loop can both want a
 * camp's wait gone before the game's reply lowers it, so the second one shares the first's skips instead of spending
 * its own.
 */
function oneSkipPerCamp(skipWait) {
    const skipping = new Map()
    return areaInfo => {
        const camp = `${areaInfo.x}:${areaInfo.y}`
        if (!skipping.has(camp))
            skipping.set(camp, skipWait(areaInfo).finally(() => skipping.delete(camp)))
        return skipping.get(camp)
    }
}

module.exports = { oneSkipPerCamp }
