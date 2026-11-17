/**
 * Castles whose troops Auto Station is moving out before an attack, as "kingdom:x:y". The attack engine sends no
 * attack from a locked castle. Kept apart from the commander pool so the engine needs nothing else to check it.
 */
const locked = new Set()
const key = (kingdomID, x, y) => `${kingdomID}:${x}:${y}`

module.exports = {
    lockCastle: (kingdomID, x, y) => void locked.add(key(kingdomID, x, y)),
    unlockCastle: (kingdomID, x, y) => void locked.delete(key(kingdomID, x, y)),
    isCastleLocked: (kingdomID, x, y) => locked.has(key(kingdomID, x, y)),
}
