/**
 * Battle reports: the header a `sne` push carries for one, and the loot and glory of one attack read from `bls`.
 * See docs/protocol/battle-reports.md. The parsers talk to nothing. `readBattleLog` takes the game connection.
 */

/** `MESSAGE_TYPE_BATTLE_LOG` in the client, the type of a battle report. */
const BATTLE_LOG = 6
const ATTACKER = 0

/**
 * Splits a `sne` message `[id, type, header, ...]`, or returns undefined when it isn't a battle report. The header reads
 * `areaType+subtypeAttack+subtypeResult[+...]#kingdomID+ownerID[+areaName]`, where the owner is the one attacked.
 */
function battleReportHeader(message) {
    const [messageID, type, header] = Array.isArray(message) ? message : []
    if (type != BATTLE_LOG || typeof header != "string")
        return undefined
    const [left, right] = header.split("#")
    if (right === undefined)
        return undefined
    const [areaType, subtypeAttack, subtypeResult] = left.split("+").map(Number)
    const [kingdomID, ownerID] = right.split("+").map(Number)
    if ([areaType, subtypeAttack, subtypeResult, kingdomID, ownerID].some(Number.isNaN))
        return undefined
    return { messageID, areaType, subtypeAttack, subtypeResult, kingdomID, ownerID }
}

/**
 * The glory and loot a battle log gives the player, from the `PBI` row with their id, or else the attacker's row.
 * `PBI` rows start `[ownerID, side, ?, ?, loot pairs, glory, ...]`. Returns undefined when the log has no such row.
 */
function parseBattleLog(payload, playerID) {
    const rows = Array.isArray(payload?.PBI) ? payload.PBI : []
    const row = rows.find(r => r[0] == playerID) ?? rows.find(r => r[1] == ATTACKER)
    if (!row)
        return undefined
    return { glory: Number(row[5]) || 0, loot: Object.fromEntries((row[4] ?? []).map(([name, amount]) => [name, Number(amount)])) }
}

/** Asks for the battle log `messageID` (`bls`) and parses it. Resolves to undefined when the game doesn't answer or refuses. */
async function readBattleLog({ sendXT, waitForResult, playerInfo }, messageID) {
    const reply = waitForResult("bls", 1000 * 10, obj => obj.MID == messageID)
    // Without a catch a request that failed to send leaves this rejection unhandled.
    reply.catch(() => {})
    try {
        await sendXT("bls", JSON.stringify({ MID: messageID, IM: 0 }))
        const [payload, result] = await reply
        return result == 0 ? parseBattleLog(payload, playerInfo.playerID) : undefined
    } catch {
        return undefined
    }
}

module.exports = { BATTLE_LOG, battleReportHeader, parseBattleLog, readBattleLog }
