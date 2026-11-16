/** A standard normal sample (Box–Muller). `random` is injectable so tests can seed it. */
function standardNormal(random = Math.random) {
    let u = 0, v = 0
    while (u === 0) u = random()
    while (v === 0) v = random()
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

/** A normal sample, clamped to mean ± 3 sd. */
const gaussian = (mean, sd, random = Math.random) =>
    mean + sd * Math.max(-3, Math.min(3, standardNormal(random)))

/**
 * Calls `fn` again and again, waiting a fresh gaussian delay before each call.
 * Returns a function that stops it.
 */
function jittered(fn, meanMs, sdMs, random = Math.random) {
    let timer
    const schedule = () => {
        timer = setTimeout(() => {
            schedule()
            fn()
        }, gaussian(meanMs, sdMs, random))
        timer.unref?.()
    }
    schedule()
    return () => clearTimeout(timer)
}

const Z_90 = 1.6449
const BREAK_CHANCE = 0.03

/**
 * A delay a person might leave between two actions: log-normal with its median
 * at the geometric middle of [minMs, maxMs] and 90% of the curve inside that
 * range, never below minMs, and now and then a break 2 to 6 times as long.
 */
function lognormalDelay(minMs, maxMs, random = Math.random) {
    const low = Math.max(minMs, 1)
    const high = Math.max(maxMs, low)
    const median = Math.sqrt(low * high)
    const sigma = Math.log(high / low) / (2 * Z_90)
    let delay = low
    while (high > low && (delay = median * Math.exp(sigma * standardNormal(random))) < low);
    return random() < BREAK_CHANCE ? delay * (2 + 4 * random()) : delay
}

const LOGIN_TIMING = {
    CONM: { unmeasured: 212, min: 50, max: 3000 },
    RTM: { unmeasured: 25, min: 5, max: 1000 },
}
const within = ({ unmeasured, min, max }, ms) =>
    ms >= 0 ? Math.round(Math.min(max, Math.max(min, ms))) : unmeasured

/**
 * The connect time and round-trip time a login reports. Without `measured` it
 * is the pair the bot has always sent; with it, what this connection took,
 * kept inside what a browser on a home line could plausibly see.
 */
const loginTiming = measured => ({
    CONM: within(LOGIN_TIMING.CONM, measured?.connectMs),
    RTM: within(LOGIN_TIMING.RTM, measured?.roundTripMs),
})

module.exports = { standardNormal, gaussian, jittered, lognormalDelay, loginTiming }
