/**
 * The log line a tower plugin writes for each attack it sends, and how the runner reads it back. A restarted bot gets
 * its last 24 hours of these lines, so its daily limits carry on where they were instead of starting from nothing.
 * The line is the player's log line too: "Attacking Great Empire C3 610:600 4m till impact 20 tools".
 */

/** The script name that tags a tower attack line: every kingdom's plugin sends through this file. */
const TOWER_LOG_TAG = "sharedBarronAttackLogic"
const SENT = "hittingTargetAttack"
const TOOLS = "toolsInAttack"
/** The tower plugin of each kingdom, by the kingdom's name as the line carries it. */
const TOWER_PLUGINS = {
    greatEmpire: "attackBarronsGreatEmpire",
    burningSands: "attackBarronsBurningSands",
    everWinterGlacier: "attackBarronsEverWinterGlacier",
    firePeaks: "attackBarronsFirePeaks",
}

/** The parts a tower plugin logs, at info level, after an attack. */
const towerAttackLine = (kingdomName, commander, x, y, travel, tools) =>
    [SENT, kingdomName, " ", "C", commander, " ", x, ":", y, " ", travel, "tillImpactAttack", " ", tools, TOOLS]

/**
 * What a stored log line says about a tower attack: `{ plugin, tools }`, or null for any other line. `parts` is the
 * line as ggeBot.js sends it: `[time, "[", script name, "] ", ...what the plugin logged]`.
 */
function readTowerAttack(parts) {
    if (!Array.isArray(parts) || parts[2] !== TOWER_LOG_TAG || parts[4] !== SENT)
        return null
    const plugin = TOWER_PLUGINS[parts[5]]
    if (!plugin)
        return null
    const tools = parts.at(-1) === TOOLS ? Number(parts.at(-2)) : 0
    return { plugin, tools: Number.isFinite(tools) ? tools : 0 }
}

/** How a log line names the horse of an attack, and each time skip spent on its target. */
const HORSE_KEYS = { none: "horseNone", coin: "horseCoin", feather: "horseFeather" }
const SKIP_NAMES = { MS1: "1m", MS2: "5m", MS3: "10m", MS4: "30m", MS5: "1h", MS6: "5h", MS7: "24h" }

/**
 * The parts an event camp plugin logs, at info level, after an attack: "Attacking Nomad camp C3 610:600 4m until it
 * lands · feather · time skips: 10m+10m". `campKey` is the bot-catalog key of the event's camp.
 */
const campAttackLine = (campKey, commander, x, y, travel, { skips, horse }) =>
    [SENT, campKey, " ", "C", commander, " ", x, ":", y, " ", travel, "tillImpactAttack", " · ", HORSE_KEYS[horse], " · ",
        ...(skips.length ? ["skipsSpentOnCamp", skips.map(skip => SKIP_NAMES[skip] ?? skip).join("+")] : ["noSkipsSpentOnCamp"])]

module.exports = { TOWER_LOG_TAG, TOWER_PLUGINS, towerAttackLine, readTowerAttack, campAttackLine }
