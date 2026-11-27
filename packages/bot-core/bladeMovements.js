/**
 * Blade Coast island attacks, kept apart from the account's marches. A march with no target position on the map is
 * one, per Lazy Lord's be/protocols.js and be/bladeMovements.js (medium: their capture, not yet ours). protocols.js
 * puts such a march here instead of on its movement list, so the commander pool, attack plugins, incoming alerts and
 * the Live view's march list never see it. The Blade Coast plugin shows it on its own card.
 */

/** movement id to when it lands, epoch milliseconds. */
const landings = new Map()

/** Whether a march as the game sends it (`{ M: { TA, … } }`) is a Blade Coast island attack. */
const isIslandMarch = march => march?.M?.TA == null

const note = (id, landsAt) => landings.set(Number(id), Number(landsAt))
const forget = id => landings.delete(Number(id))

/** The island attacks still on their way at `now`, as `{ id, landsAt }`. Landed ones are dropped. */
function underway(now = Date.now()) {
    for (const [id, landsAt] of landings)
        if (!(landsAt > now))
            landings.delete(id)
    return [...landings].map(([id, landsAt]) => ({ id, landsAt }))
}

module.exports = { isIslandMarch, note, forget, underway }
