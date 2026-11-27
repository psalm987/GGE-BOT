/**
 * The main castle's defence as the game last listed it, for the read-back snapshot. Every `dfc` reply the bot gets is
 * kept, whichever part asked, and a slow chore asks when none has come for a while. It is the read the game client
 * makes when the player opens the defence screen.
 */
const { xtHandler, events } = require("./ggeBot.js")
const { ask, chore } = require("./chores.js")
const { boxMullerRandom } = require("./pacing.js")

/** The chore never asks sooner than this after the last reply, in milliseconds, and waits up to `READ_SPREAD_MS` longer. */
const READ_GAP_MS = 15 * 60_000
const READ_SPREAD_MS = 10 * 60_000
/** The first look comes this long after sign-in, in milliseconds. */
const FIRST_READ_MS = [2 * 60_000, 6 * 60_000]

let last

/** The legendary skills that give each flank a fifth tool slot, by `skillID`; empty when the game's items lack the table. */
let flankSlotSkills = []
try {
    flankSlotSkills = require("./paths.js").loadItem("legendskills")
        .filter(skill => skill.effectType == "additionalDefenseToolSlotFlank").map(skill => Number(skill.skillID))
} catch (error) {
    console.debug("legendSkillsUnreadable", String(error?.message ?? error))
}
/** The account's legendary skills, the highest level of each, as `skl.SID` lists them at sign-in and when they change. */
let skillIDs = []
xtHandler.on("skl", reply => {
    if (Array.isArray(reply?.SID))
        skillIDs = reply.SID.map(Number)
})

/**
 * Starts keeping the defence. `mainCastle()` gives the castle as protocols.js keeps it, or undefined until the game has
 * listed it, and `unitOf` turns a `[wodID, amount]` pair of the reply's storage into a unit with its `unitInfo`.
 */
function watchDefence(mainCastle, unitOf) {
    xtHandler.on("dfc", (reply, result) => {
        const castle = mainCastle()
        if (Number(result) != 0 || !reply?.dfw || !castle || reply.A?.[0] != castle.areaInfo.type || reply.A[3] != castle.id)
            return
        last = { layout: reply, readAt: Date.now(), stock: Array.from(reply.gui?.I ?? []).map(unitOf) }
    })
    const nextRead = () => READ_GAP_MS + boxMullerRandom(0, READ_SPREAD_MS)
    events.once("load", () => chore("defenceRead", async () => {
        const sinceRead = Date.now() - (last?.readAt ?? -Infinity)
        if (sinceRead < READ_GAP_MS)
            return nextRead() - sinceRead
        const castle = mainCastle()
        if (castle)
            await ask("dfc", { CX: castle.areaInfo.x, CY: castle.areaInfo.y, AID: castle.id, KID: -1 })
        return nextRead()
    }, boxMullerRandom(...FIRST_READ_MS)))
}

module.exports = {
    watchDefence,
    /**
     * `{ layout, readAt, stock, extraFlankSlot }`: the last `dfc` reply for the main castle, or undefined before the
     * first, and whether the account has the skill that gives each flank a fifth slot, which the reply doesn't say.
     */
    lastDefence: () => last && { ...last, extraFlankSlot: skillIDs.some(id => flankSlotSkills.includes(id)) },
}
