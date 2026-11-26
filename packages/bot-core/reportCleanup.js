/**
 * Deletes the battle reports of a plugin's own won attacks and keeps the lost ones. A report carries no march id, only
 * `areaType+subtypeAttack+subtypeResult#kingdomID+ownerID[+areaName]`, so a report is matched to the plugin's attack
 * by the target the march was sent to and the time it lands. The plugin's own attacks are the ones it sends through
 * `track`, so another plugin's reports, or the player's own, are never touched.
 */

/** `MESSAGE_TYPE_BATTLE_LOG` and `SUBTYPE_ATTACKER_SUCCESS` / `SUBTYPE_ATTACKER_FAILED` in the client's `MessageConst`. */
const BATTLE_LOG = 6
const ATTACKER_SUCCESS = 0
const ATTACKER_FAILED = 2

/** How long before a march lands its report still matches it, and how long after, in milliseconds. */
const REPORT_BEFORE_MS = 15_000
const REPORT_AFTER_MS = 60_000
/** A march nobody reported is forgotten this long after it landed, in milliseconds. */
const STALE_MS = 5 * 60_000
/** A report is deleted after a pause this long at least and this much longer at most, in milliseconds. */
const DELETE_AFTER_MS = [1000, 3000]

/** What a `sne` message `[id, type, header, ...]` says when it is a battle report, undefined for any other message. */
function battleReport(message) {
    const [id, type, header] = Array.isArray(message) ? message : []
    if (type != BATTLE_LOG || typeof header != "string")
        return undefined
    const [left, right] = header.split("#")
    if (right === undefined)
        return undefined
    const [areaType, subtypeAttack, result] = left.split("+").map(Number)
    const [kingdomID, ownerID] = right.split("+").map(Number)
    if ([areaType, subtypeAttack, result, kingdomID, ownerID].some(Number.isNaN))
        return undefined
    return { id, areaType, subtypeAttack, result, kingdomID, ownerID }
}

/**
 * The attacks a plugin sent that have not been reported yet. `track` takes the movement a `cra` reply carried
 * (`AAM.M`), and `judge` says what to do with a report: "delete" for the report of a won attack, "keep" for a lost
 * one, undefined when no tracked attack explains it. A report uses up the attack it was matched to.
 */
function reportCleaner(clock = Date.now) {
    /** @type {Array<{ areaType: number, kingdomID: number, ownerID: number, landsAt: number }>} */
    let pending = []

    function track(march) {
        const [areaType] = march?.TA ?? []
        const seconds = Number(march?.TT) - Number(march?.PT ?? 0)
        const kingdomID = Number(march?.KID), ownerID = Number(march?.TID)
        if (![areaType, seconds, kingdomID, ownerID].every(Number.isFinite))
            return
        pending.push({ areaType: Number(areaType), kingdomID, ownerID, landsAt: clock() + seconds * 1000 })
    }

    function judge(message) {
        const parsed = battleReport(message)
        if (!parsed || (parsed.result != ATTACKER_SUCCESS && parsed.result != ATTACKER_FAILED))
            return undefined
        const now = clock()
        pending = pending.filter(march => now < march.landsAt + STALE_MS)
        const match = pending
            .filter(march => march.areaType == parsed.areaType && march.kingdomID == parsed.kingdomID && march.ownerID == parsed.ownerID
                && now >= march.landsAt - REPORT_BEFORE_MS && now <= march.landsAt + REPORT_AFTER_MS)
            .sort((a, b) => Math.abs(a.landsAt - now) - Math.abs(b.landsAt - now))[0]
        if (!match)
            return undefined
        pending.splice(pending.indexOf(match), 1)
        return parsed.result == ATTACKER_SUCCESS ? "delete" : "keep"
    }

    return { track, judge }
}

/**
 * Starts watching `sne` for the reports of the attacks passed to the returned `track`. A won attack's report is deleted
 * with `dms` after a short pause, as the game's own delete does.
 */
function createReportCleanup({ xtHandler, sendXT, clock = Date.now }) {
    const cleaner = reportCleaner(clock)
    xtHandler.on("sne", ({ MSG }) => {
        for (const message of Array.isArray(MSG) ? MSG : []) {
            if (cleaner.judge(message) != "delete")
                continue
            const [shortest, spread] = DELETE_AFTER_MS
            setTimeout(() => {
                Promise.resolve(sendXT("dms", JSON.stringify({ MID: message[0] })))
                    .catch(error => console.warn("couldntDeleteReport", String(error)))
            }, shortest + Math.random() * spread).unref?.()
        }
    })
    return { track: cleaner.track }
}

module.exports = { battleReport, reportCleaner, createReportCleanup }
