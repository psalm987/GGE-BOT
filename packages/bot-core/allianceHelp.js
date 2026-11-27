const err = require("./err.json")
const { xtHandler, sendXT, playerInfo } = require("./ggeBot.js")
const { loadItem } = require("./paths.js")
const { pause } = require("./pacing.js")
const { setCastle, forgetCurrentCastle } = require("./protocols.js")

/** The help request types the bot asks for, by `ahr`'s `T` (items/alliancehelprequests.json). */
const HELP_HEAL = 2, HELP_RECRUIT = 6
const HELP_NAMES = { [HELP_HEAL]: "allianceHelpForHeal", [HELP_RECRUIT]: "allianceHelpForRecruit" }

/** How many helpers each request type takes, by its type ID. Empty when the game data lacks it. */
const helpersNeeded = (() => {
    try {
        return new Map(loadItem("alliancehelprequests").map(t => [Number(t.allianceHelpRequestID), Number(t.maxHelpersCount)]))
    } catch {
        return new Map()
    }
})()

/**
 * The alliance's open help requests by list ID, kept from the game's list (ahl), its additions and changes (ahh) and
 * its removals (ahd). P is the helpers so far, AC whether this player helped, OP.AID the castle it is for, RT the
 * seconds left.
 */
const requests = new Map()
function readRequest(r) {
    if (!Number.isFinite(Number(r?.LID)))
        return
    if (Number(r.PID) == playerInfo.playerID)
        ownPending.delete(`${Number(r.TID)}:${Number(r.OP?.AID)}`)
    requests.set(Number(r.LID), {
        listID: Number(r.LID),
        playerID: Number(r.PID),
        type: Number(r.TID),
        castleID: Number(r.OP?.AID),
        helpers: Number(r.P) || 0,
        helped: Boolean(r.AC) || Boolean(requests.get(Number(r.LID))?.helped),
        expiresAt: Number(r.RT) > 0 ? Date.now() + Number(r.RT) * 1000 : Infinity,
    })
}

xtHandler.on("ahl", (obj, result) => {
    if (result != 0)
        return
    requests.clear()
    for (const r of obj?.AHL ?? [])
        readRequest(r)
})
xtHandler.on("ahh", (obj, result) => result == 0 && readRequest(obj))
xtHandler.on("ahd", (obj, result) => result == 0 && requests.delete(Number(obj?.LID)))

const inAlliance = () => Number.isInteger(playerInfo.alliance?.id) && playerInfo.alliance.id >= 0

/** Other members' requests this player can still help: not helped yet, short of helpers, and not run out. */
const helpable = () => [...requests.values()].filter(r => r.playerID != playerInfo.playerID && !r.helped &&
    r.helpers < (helpersNeeded.get(r.type) ?? Infinity) && r.expiresAt > Date.now())

/**
 * This player's requests sent or refused as already open, by `type:castleID`, until the game lists them. An hour at
 * most, so a request whose listing was missed doesn't block that castle for ever.
 */
const ownPending = new Map()
const OWN_PENDING_MS = 60 * 60_000

/**
 * Whether this player has an open request of `type` for the castle. The game takes one at a time and keeps it open
 * while it is listed, even with all its helpers, so a second ask would only be refused.
 */
function hasOwnOpenRequest(type, castleID) {
    const listed = [...requests.values()].some(r => r.playerID == playerInfo.playerID && r.type == type && r.castleID == castleID && r.expiresAt > Date.now())
    return listed || Date.now() - (ownPending.get(`${type}:${castleID}`) ?? -Infinity) < OWN_PENDING_MS
}

const CONFIRM_MS = 10_000
const REFUSED_WAIT_MS = 60 * 60_000
const ALREADY_OPEN = 273, BATCH_DONE = 2, NOT_IN_CASTLE = 53

/**
 * Sends `ahr` and resolves to the game's code: 0 when the game pushes the new request (`ahh`, this player, the type,
 * no helpers yet), the refusal's code when it answers `ahr`, and undefined after 10 s of silence. An accepted ask
 * gets no `ahr` reply, so this doesn't use waitForResult, whose silences count towards restarting the bot.
 */
function sendAsk(params) {
    return new Promise(resolve => {
        const finish = code => {
            clearTimeout(timer)
            xtHandler.off("ahr", onRefusal)
            xtHandler.off("ahh", onPush)
            resolve(code)
        }
        const onRefusal = (_obj, result) => finish(Number(result))
        const onPush = (obj, result) => result == 0 && Number(obj?.PID) == playerInfo.playerID && Number(obj?.TID) == params.T && !(Number(obj?.P) > 0) && finish(0)
        const timer = setTimeout(() => finish(undefined), CONFIRM_MS)
        timer.unref?.()
        xtHandler.on("ahr", onRefusal)
        xtHandler.on("ahh", onPush)
        sendXT("ahr", JSON.stringify(params)).catch(() => finish(undefined))
    })
}

/** Tickets already asked for, by `type:kingdom:castle:ticket`, and until when a castle waits after a refusal, by `type:kingdom:castle`. */
const asked = new Set()
const refusedUntil = new Map()

/**
 * Asks the alliance for help with `type` (HELP_RECRUIT or HELP_HEAL) in `castle`, as the game's button does. `id` is
 * `ahr`'s `ID`: 0 for the barracks, the batch for a hospital. `ticket` names what the ask is about, a batch or a
 * snapshot of the barracks, and the bot never asks twice for one ticket. Call it outside setCastle: it enters the
 * castle itself, since the request names none.
 *
 * Resolves to "skipped" when nothing was sent (no alliance, a request open, the ticket asked already, or an hour's
 * wait after a refusal), "dryRun", "asked", "unconfirmed" (the game said nothing), "alreadyOpen", "batchDone" or "refused".
 */
async function askAllianceHelp(castle, { type, id, ticket, dryRun = false }) {
    const where = `${type}:${castle.kingdomID}:${castle.id}`
    if (!inAlliance() || hasOwnOpenRequest(type, castle.id) || asked.has(`${where}:${ticket}`) || Date.now() < (refusedUntil.get(where) ?? 0))
        return "skipped"
    asked.add(`${where}:${ticket}`)
    await pause(1500, 4000)
    const params = { ID: id, T: type }
    if (dryRun) {
        console.log("dryRunAhr", JSON.stringify(params))
        return "dryRun"
    }
    let code
    for (let tries = 0; tries < 2; tries++) {
        try {
            code = await setCastle(castle, () => sendAsk(params))
        } catch {
            code = undefined
            break
        }
        if (code != NOT_IN_CASTLE)
            break
        forgetCurrentCastle()
    }
    if (code === 0 || code === undefined || code == ALREADY_OPEN)
        ownPending.set(`${type}:${castle.id}`, Date.now())
    if (code === 0) {
        console.log("allianceHelpAsked", HELP_NAMES[type], castle.kingdomID, castle.id)
        return "asked"
    }
    if (code === undefined)
        return "unconfirmed"
    if (code == ALREADY_OPEN)
        return "alreadyOpen"
    if (code == BATCH_DONE)
        return "batchDone"
    refusedUntil.set(where, Date.now() + REFUSED_WAIT_MS)
    console.warn("allianceHelpRefused", HELP_NAMES[type], castle.kingdomID, castle.id, err[code] ?? code)
    return "refused"
}

module.exports = { HELP_HEAL, HELP_RECRUIT, askAllianceHelp, hasOwnOpenRequest, helpable, inAlliance }
