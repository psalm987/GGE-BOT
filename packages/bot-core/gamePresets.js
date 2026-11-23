/**
 * The player's in-game army presets. `gas` lists them; the game's client sends it each time the army screen opens,
 * and so does the bot before each attack (attack.js). Every answer refreshes the list army.js unpacks presets from,
 * and the list's numbers and names go to the app in the bot's status, for the wave editor to offer.
 * docs/protocol/presets.md holds the shapes.
 */
const { parentPort } = require("node:worker_threads")
const ActionType = require("./actions.json")
const { xtHandler, events, status, stopping } = require("./ggeBot.js")
const { ask } = require("./chores.js")
const { presetsNamed, rememberPresets, knownPresets } = require("./army.js")

xtHandler.on("gas", (reply, result) => {
    if (Number(result) != 0 || !Array.isArray(reply?.S))
        return
    rememberPresets(reply)
    const listed = [...knownPresets()].map(([preset, { name }]) => ({ preset, name }))
    if (JSON.stringify(status.gamePresets) == JSON.stringify(listed))
        return
    status.gamePresets = listed
    parentPort?.postMessage([ActionType.StatusUser, status])
})

let reading
/** Asks the game for the presets once at a time; the listener above keeps the answer. */
const readPresets = () => reading ??= ask("gas", {}).finally(() => reading = undefined)

// Read once a few minutes after login, as a player opening the army screen would, so the wave editor can offer the
// presets before the bot has attacked. An attack before then has already listed them.
events.once("load", () => {
    const timer = setTimeout(() => {
        if (!knownPresets() && !stopping())
            readPresets()
    }, 120_000 + Math.random() * 240_000)
    timer.unref?.()
    events.once("unload", () => clearTimeout(timer))
})

/**
 * Whether the game lists every in-game preset the army's wave plan names, reading the list first if it hasn't been
 * read. A plan that names a preset the game doesn't list is reported as the plugin's status, and the caller starts
 * nothing, so a wave is never left out behind the player's back.
 */
async function presetsListed(army, reportStatus) {
    const named = army?.mode == "waves" ? presetsNamed(army.waves) : []
    if (named.length == 0)
        return true
    if (!knownPresets())
        await readPresets()
    const missing = named.find(preset => !knownPresets()?.has(preset))
    if (missing === undefined)
        return true
    console.error("armyCantBeSent")
    reportStatus("error", "statusArmyServerPreset", { preset: missing })
    return false
}

module.exports = { presetsListed, readPresets }
