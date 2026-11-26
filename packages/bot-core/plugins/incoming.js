if (require('node:worker_threads').isMainThread)
    return module.exports = { hidden: true }

const { events, playerInfo } = require("../ggeBot.js")
const { movementEvents } = require("../protocols.js")

const attackTypes = [0, 25, 31, 24, 29]

/**
 * A player attacking one of our castles, or a player outside the alliance attacking an alliance member, as it is
 * emitted with `incoming:new`, `incoming:updated` and `incoming:cleared`. `incoming:cancelled` precedes `incoming:cleared`
 * when the game removed the movement before it was due to land.
 * @typedef {Object} IncomingAttack
 * @property {Number} movementId
 * @property {Number} kingdom
 * @property {Number} arrivesAt epoch milliseconds
 * @property {import("../protocols.js").ClassTypes.OwnerInfo} attacker
 * @property {Object} sourceCastle the map object the attack left from
 * @property {import("../protocols.js").ClassTypes.OwnerInfo} defender
 * @property {Object} targetCastle the map object under attack
 * @property {Number} [army] soldiers in the attack, once its army is visible
 * @property {{left: Array, middle: Array, right: Array, courtyard: Array}} [waves] once its army is visible
 */

/** The game's clock and ours differ, so a movement removed this close to its landing is taken to have landed. */
const landingToleranceMs = 3000

/** @type {Map<Number, {attack: IncomingAttack, landing: NodeJS.Timeout}>} */
const incoming = new Map()

const isHostile = movement =>
    attackTypes.includes(movement.type) &&
    movement.sourceOwner.ownerID >= 0 &&
    movement.targetOwner.ownerID >= 0 &&
    movement.sourceOwner.ownerID != playerInfo.playerID &&
    (movement.targetOwner.ownerID == playerInfo.playerID ||
        movement.sourceOwner.allianceID != playerInfo.alliance.id && movement.targetOwner.allianceID == playerInfo.alliance.id)

function armyOf(movement) {
    if (!movement.canSeeArmy)
        return {}
    const { left, middle, right, courtyard } = movement
    const army = [left, middle, right, courtyard].flat()
        .reduce((total, unit) => unit.unitInfo?.role ? total + unit.amount : total, 0)
    return { army, waves: { left, middle, right, courtyard } }
}

function clear(movementId) {
    const entry = incoming.get(movementId)
    if (!entry)
        return
    incoming.delete(movementId)
    clearTimeout(entry.landing)
    if (entry.attack.arrivesAt - Date.now() > landingToleranceMs)
        events.emit("incoming:cancelled", entry.attack)
    events.emit("incoming:cleared", entry.attack)
}

movementEvents.on("outgoing", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => {
    if (!isHostile(movement))
        return

    const known = incoming.get(movement.id)?.attack
    if (known) {
        if (known.army == undefined && movement.canSeeArmy) {
            Object.assign(known, armyOf(movement))
            events.emit("incoming:updated", known)
        }
        return
    }

    const now = Date.now()
    const timeLeft = movement.totalTime - (movement.deltaTime - now)
    /** @type {IncomingAttack} */
    const attack = {
        movementId: movement.id,
        kingdom: movement.kingdomID,
        arrivesAt: now + timeLeft,
        attacker: movement.sourceOwner,
        sourceCastle: movement.sourceAttack,
        defender: movement.targetOwner,
        targetCastle: movement.targetAttack,
        ...armyOf(movement),
    }
    incoming.set(movement.id, { attack, landing: setTimeout(() => clear(movement.id), timeLeft).unref() })
    events.emit("incoming:new", attack)
})

movementEvents.on("ended", (/** @type {import("../protocols.js").ClassTypes.Movement} */ movement) => clear(movement.id))
