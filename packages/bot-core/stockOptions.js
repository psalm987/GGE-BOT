/**
 * The option definitions of a plugin that keeps tools in stock from the armourer (armourer.js' keepStocked). They sit
 * apart from armourer.js because options are declared on the main thread, where nothing may ask the game.
 */

/** One stock option for each of `stocks`, `[[option key, wodID]]`. A stock starts at 0, which buys nothing. */
const stockOptions = stocks => stocks.map(([key]) => ({ type: "Number", key, min: 0, max: 100_000, step: 100, unit: "tools", default: 0 }))

/** The options that bound what one stock check spends. */
const spendOptions = () => [
    { type: "Number", key: "armourerSpendCap", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 500_000 },
    { type: "Number", key: "armourerCoinFloor", min: 0, max: 2_147_483_647, step: 1000, unit: "coins", default: 0 },
]

module.exports = { stockOptions, spendOptions }
