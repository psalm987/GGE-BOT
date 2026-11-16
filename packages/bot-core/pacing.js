const { standardNormal } = require("./timing.js")

/**
 * A random number in [min, max], bell-shaped around the middle. The spread is
 * a quarter of the range, so samples cover the whole range instead of
 * clustering at its centre. `skew` above 1 leans toward min.
 */
function boxMullerRandom(min, max, skew = 1) {
    let num
    do
        num = standardNormal() / 4 + 0.5
    while (num > 1 || num < 0)
    return min + Math.pow(num, skew) * (max - min)
}

const sleep = ms => new Promise(r => setTimeout(r, ms).unref?.())

const pause = (minMs, maxMs) => sleep(boxMullerRandom(minMs, maxMs))

module.exports = { boxMullerRandom, sleep, pause }
