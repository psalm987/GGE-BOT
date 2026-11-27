/**
 * What a `bup` refusal says about an order, by the game's code: 10 coins and 55 resources short, 63 no free slot,
 * 87 a building or unit level the account lacks, 88 and 240 more than the game takes in one order. Any other code,
 * 11 (rubies) among them, is a plain refusal.
 */
const BUP_REFUSALS = { 10: "noResources", 55: "noResources", 63: "queueFull", 87: "levelLocked", 88: "tooMany", 240: "tooMany" }

/**
 * What the game's refusals taught about each order, by a key the caller picks. "levelLocked" stops the key for good,
 * "tooMany" halves its next amount, and any other refusal holds it back for `round`, then 2, 4… rounds, `max` at most.
 * An accepted order ends the backoff and keeps the lowered amount.
 */
function refusalMemory({ round = 15 * 60_000, max = 60 * 60_000 } = {}) {
    const learned = new Map()
    return {
        /** The refusal that holds `key` back now, or undefined when it may be tried. */
        holding(key) {
            const state = learned.get(key)
            return state && (state.locked || state.retryAt > Date.now()) ? state.outcome : undefined
        },
        /** The most `key` may order at once after "too many", Infinity before. */
        cap: key => learned.get(key)?.cap ?? Infinity,
        refused(key, outcome, amount) {
            const state = learned.get(key) ?? {}
            learned.set(key, state)
            state.outcome = outcome
            if (outcome == "levelLocked")
                state.locked = true
            else if (outcome == "tooMany" && amount > 1)
                state.cap = Math.floor(amount / 2)
            else {
                state.refusals = (state.refusals ?? 0) + 1
                state.retryAt = Date.now() + Math.min(max, round * 2 ** (state.refusals - 1))
            }
        },
        accepted(key) {
            const state = learned.get(key)
            if (state) {
                state.refusals = 0
                state.retryAt = 0
            }
        },
    }
}

module.exports = { BUP_REFUSALS, refusalMemory }
