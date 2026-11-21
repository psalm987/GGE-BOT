if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { xtHandler, playerInfo, waitForResult } = require('../ggeBot.js')
const { ClassTypes : { Lord }, movementEvents } = require('../protocols.js')

const event = new EventTarget()
/** @type {Array<Number>} */
let usedCommanders = []
/** @type {Array<import("../protocols.js").ClassTypes.Lord>} */
let commanders = []

xtHandler.on("gli", (obj, r) => !r ? 
    commanders = Array.from(obj.C).map(e => new Lord(e)) : undefined)

function freeCommander(lordID) {
    const index = usedCommanders.findIndex(e => e == lordID)
    if (index == -1)
        return
    
    usedCommanders.splice(index, 1)
    event.dispatchEvent(new CustomEvent('freedCommander', { detail: lordID }))
}
function useCommander(lordID) {
    if (!usedCommanders.includes(lordID))
        usedCommanders.push(lordID)
    
    return lordID
}

movementEvents.on("outgoing", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if(movement.owner.ownerID != playerInfo.playerID)
        return

    // console.log(`using: ${movement.lord.lordID}`)

    useCommander(movement.lord.lordID)
})

movementEvents.on("return", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (movement.targetOwner.ownerID != playerInfo.playerID)
        return

    // console.log(`freeing: ${movement.lord.lordID}`)

    freeCommander(movement.lord.lordID)
})
/** No account has more commanders than this, so a longer range picks no more. */
const MAX_COMMANDER_POSITION = 500

/**
 * The 0-based commander positions a whitelist like "1-5,9" or "1;2;3" picks, or the list unchanged when it is empty
 * or parsed already. Positions and ranges are set apart by commas or semicolons, and a part that isn't one is left
 * out, as @gge/contracts' readCommanderList reads the same list for the settings page.
 */
function parseWhitelist(commanderWhitelist) {
    if ([, 0, ""].includes(commanderWhitelist) || Array.isArray(commanderWhitelist))
        return commanderWhitelist
    return String(commanderWhitelist).split(/[,;]/).filter(part => part.trim() !== "").flatMap(part => {
        const [start, end = start] = part.split("-").map(Number)
        if (!Number.isInteger(start) || !Number.isInteger(end))
            return []
        return Array.from({ length: Math.max(0, Math.min(end, MAX_COMMANDER_POSITION) - start + 1) }, (_, i) => start + i - 1)
    })
}

/** Orders commanders by where a parsed whitelist names them, so "5;2;1" puts commander 5 first. */
const byWrittenOrder = whitelist => (a, b) => whitelist.indexOf(a.lordPosition) - whitelist.indexOf(b.lordPosition)

/** The first whitelisted commander that is free right now, in the list's order, marked used; undefined when none is. Never waits. */
function takeFreeCommander(commanderWhitelist) {
    const whitelist = parseWhitelist(commanderWhitelist)
    const free = commanders.filter(e => (!whitelist || whitelist.includes(e.lordPosition)) && !usedCommanders.includes(e.lordID))
    if (whitelist)
        free.sort(byWrittenOrder(whitelist))
    const lord = free[0]
    if (lord)
        useCommander(lord.lordID)
    return lord
}

/**
 * A free commander of the whitelist, marked used, waiting for one to come home when none is free. Free commanders are
 * taken in the order the list names them, so "36;2;5" sends 36 first. `sortCallback` orders them only when the list is
 * empty, which names no order.
 * @param {string} commanderWhitelist
 * @param {filterCallback} filterCallback
 * @param {sortCallback} sortCallback
 */
const waitForCommanderAvailable = async (commanderWhitelist, filterCallback, sortCallback) => {
    commanderWhitelist = parseWhitelist(commanderWhitelist)

    if (commanders.length == 0)
        commanders = Array.from((await waitForResult("gli", 1000 * 10))[0].C)
            .map(e => new Lord(e))

    let usableCommanders = commanders.filter(e => 
        ((!commanderWhitelist || commanderWhitelist.includes(e.lordPosition)) &&
            !usedCommanders.includes(e.lordID)))

    const order = commanderWhitelist ? byWrittenOrder(commanderWhitelist) : sortCallback
    if (order)
        usableCommanders.sort(order)
    if (filterCallback)
        usableCommanders = usableCommanders.filter(filterCallback)

    let lordID = usableCommanders[0]?.lordID

    lordID ??= await new Promise(resolve => {
        const checkForCommander = currentEvent => {
            const commander = commanders.find(e => e.lordID == currentEvent.detail)
            if(commanderWhitelist && !commanderWhitelist.includes(commander.lordPosition))
                return
            if(!(!filterCallback || filterCallback(commander)))
                return

            event.removeEventListener("freedCommander", checkForCommander)
            currentEvent.stopImmediatePropagation()
            // Mark it in the same run as the hand-off, so a loop that asks again
            // before this await resumes can't take it too.
            useCommander(currentEvent.detail)
            resolve(currentEvent.detail)
        }
        event.addEventListener("freedCommander", checkForCommander)
    })

    useCommander(lordID)
    return commanders.find(e => e.lordID == lordID)
}

/**
 * @callback filterCallback
 * @param {import("../protocols.js").ClassTypes.Lord}
 * @callback sortCallback
 * @param {import("../protocols.js").ClassTypes.Lord}
 * @param {import("../protocols.js").ClassTypes.Lord}
 */

module.exports = {
    movementEvents,
    waitForCommanderAvailable,
    takeFreeCommander,
    parseWhitelist,
    useCommander,
    freeCommander
}