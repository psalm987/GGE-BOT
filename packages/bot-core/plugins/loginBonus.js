/**
 * The kinds of daily reward a player can put first, each with the item keys it
 * covers (the game's server keys, 2026-11-21 capture). A player's order is the
 * chosen kind, then the rest in this order. A key no kind covers ranks last.
 */
const KINDS = [
    { label: "VIP time or VIP points", keys: /^(VT|VP)$/ },
    { label: "Troops", keys: /^U$/ },
    { label: "Time skips", keys: /^MS\d+$/ },
    { label: "Resources", keys: /^(W|S|F)$/ },
    { label: "Decorations", keys: /^D$/ },
]

if (require('node:worker_threads').isMainThread)
    return module.exports = { pluginOptions: [{ type: "Select", key: "loginBonusReward", selection: KINDS.map(kind => kind.label), default: 0 }] }

const { events, xtHandler, botConfig } = require("../ggeBot.js")
const err = require("../err.json")
const { count } = require("../metrics.js")
const { lognormalDelay } = require("../timing.js")
const { boxMullerRandom, sleep } = require("../pacing.js")
const { ask, chore } = require("../chores.js")

const pluginOptions = botConfig.plugins[require("path").basename(__filename).slice(0, -3)] ?? {}
const first = KINDS[Number(pluginOptions.loginBonusReward)] ?? KINDS[0]
const order = [first, ...KINDS.filter(kind => kind != first)]
const rank = key => {
    const at = order.findIndex(kind => kind.keys.test(key))
    return at == -1 ? order.length : at
}

/**
 * Keys in a day's offer that are not one of its rewards. The client's parser
 * reads SO as the offer's sort order, and knows no item called HF, so the
 * dialog never shows HF as a button.
 */
const NOT_REWARDS = new Set(["SO", "HF"])
/** The login bonus dialog has three reward buttons and fills them in the offer's order. */
const BUTTONS = 3

/**
 * Today's offer from an `alb` reply. `D` is the day of the 7-day cycle; that
 * day's entry holds the offered rewards, then the pick once one is made. Each
 * reward is what its button sends: the item key, and for troops the unit's
 * wodID as `ID` (-1 for any other kind). Undefined when the reply holds no
 * offer for today.
 */
function todaysOffer(alb) {
    const day = Number(alb?.D) % 7
    const [offered, picked] = alb?.R?.[day]?.[`D${day + 1}`] ?? []
    const rewards = offered?.REW?.[0]
    if (!rewards)
        return
    const buttons = Object.entries(rewards)
        .filter(([key, values]) => !NOT_REWARDS.has(key) && Array.isArray(values))
        .flatMap(([key, values]) => values.map(value => ({ ID: key == "U" ? value[0] : -1, I: key })))
        .slice(0, BUTTONS)
    return { picked: picked?.PICK?.length > 0, buttons }
}

/** The player's favourite of the offered rewards; the earlier button wins a tie. */
const favourite = buttons => buttons.reduce((best, button) => rank(button.I) < rank(best.I) ? button : best)

/** The `alb` reply to the login burst, until the first claim reads it. */
let fromLogin
xtHandler.once("alb", (reply, result) => {
    if (result == 0)
        fromLogin = reply
})

const DAY_MS = 24 * 60 * 60_000
const nextDay = () => DAY_MS - Date.now() % DAY_MS + boxMullerRandom(10 * 60_000, 2 * 60 * 60_000)

/**
 * Reads today's offer, makes one claim, then waits until some way into the
 * next UTC day. Any reply ends the attempt and so does silence: a claim is
 * never repeated the same day. If the game's day starts at another hour, the
 * first claim after it may be refused, and each later one still lands once in
 * every game day.
 */
async function claim(active) {
    let alb = fromLogin
    fromLogin = undefined
    if (!alb) {
        const asked = await ask("alb", {})
        // Without a login burst, the listener above caught this reply. Tomorrow needs a fresh one.
        fromLogin = undefined
        alb = asked.result === 0 ? asked.reply : undefined
        await sleep(lognormalDelay(3000, 12_000))
        if (!active())
            return
    }

    const offer = todaysOffer(alb)
    if (offer?.picked) {
        count("bot_daily_bonus_total", { result: "already" })
        console.log("loginBonusAlreadyClaimed")
        return nextDay()
    }
    if (!offer?.buttons.length) {
        count("bot_daily_bonus_total", { result: "no_offer" })
        console.warn("loginBonusNoOffer")
        return nextDay()
    }

    const { ID, I } = favourite(offer.buttons)
    const { result } = await ask("clb", { ID, I, SP: null })
    const outcome = result === undefined ? "no_reply" : result == 0 ? "claimed" : "refused"
    count("bot_daily_bonus_total", { result: outcome })
    if (outcome == "claimed")
        console.log("loginBonusClaimed")
    else if (outcome == "refused")
        console.warn("loginBonusRefused", err[result] ?? result)
    else
        console.warn("loginBonusNoReply")
    return nextDay()
}

// The player in the capture claimed 226 s after `lli`, once the login popups were read.
events.once("load", () => chore("loginBonus", claim, lognormalDelay(45_000, 240_000)))
