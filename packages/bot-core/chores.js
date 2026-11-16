const { events, xtHandler, sendXT, stopping } = require("./ggeBot.js")
const metrics = require("./metrics.js")
const { boxMullerRandom } = require("./pacing.js")

const timeoutMultiplier = require("./config.js").timeoutMultiplier ?? 1

/**
 * Sends a request and waits for its reply. Resolves to `{ reply, result }`,
 * or to `{}` when no reply comes in time. Unlike waitForResult, silence here
 * never counts toward TOO_MANY_TIMEOUTS: a chore must not end the bot.
 */
function ask(cmd, params, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        const started = performance.now()
        const settle = (answer, error) => {
            clearTimeout(timer)
            xtHandler.removeListener(cmd, onReply)
            error ? reject(error) : resolve(answer)
        }
        const onReply = (reply, result) => {
            metrics.observe("bot_game_rtt_seconds", { command: cmd }, (performance.now() - started) / 1000)
            settle({ reply: Object(reply), result: Number(result) })
        }
        const timer = setTimeout(() => settle({}), timeoutMs * timeoutMultiplier)
        timer.unref?.()
        xtHandler.on(cmd, onReply)
        sendXT(cmd, JSON.stringify(params)).catch(error => settle(undefined, error))
    })
}

/**
 * Runs `task` after `firstDelayMs`, then again after each delay (ms) it
 * resolves to, until it resolves to nothing, the worker unloads or the bot
 * starts stopping. `task` gets `active()`, to check before each send that
 * follows a wait. Only the first delay is scaled like the login's pauses:
 * the later ones follow the game's clock.
 */
function chore(name, task, firstDelayMs) {
    let timer
    let unloaded = false
    const active = () => !unloaded && !stopping()
    const runAfter = delayMs => {
        timer = setTimeout(async () => {
            if (!active())
                return
            let next
            try {
                next = await task(active)
            } catch (error) {
                console.warn(name, error)
                next = boxMullerRandom(10 * 60_000, 20 * 60_000)
            }
            if (next != undefined && active())
                runAfter(next)
        }, delayMs)
        timer.unref?.()
    }
    events.once("unload", () => {
        unloaded = true
        clearTimeout(timer)
    })
    runAfter(firstDelayMs * timeoutMultiplier)
}

module.exports = { ask, chore }
