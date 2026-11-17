const classes = require("./err-classes.json")

const byName = new Map([
    ...classes.severe.map(name => [name, "severe"]),
    ...classes.notNow.map(name => [name, "notNow"]),
])

/**
 * How serious a game error code is, by its name in err.json:
 * - "severe": the game refused because the account or the bot is in trouble, or the bot sent something malformed. Someone should look.
 * - "notNow": a refusal that is the state of the game and passes by itself, such as a cooldown, a full queue or too few resources.
 * - null: not classified, so it stays an ordinary warning.
 */
function errorClass(name) {
    return byName.get(name) ?? null
}

module.exports = { errorClass }
