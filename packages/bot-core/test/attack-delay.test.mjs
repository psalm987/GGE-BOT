import { createRequire } from "node:module"
import { afterEach, test, expect, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function loadAttack(options, humanize) {
    const bot = fakeBot()
    bot.botConfig.plugins.attack = { attackLimit: "", ...options }
    bot.botConfig.ggeConfig = { humanize }
    return loadModule("plugins/attack/attack.js", { bot }).mod
}

async function secondAttackStartsAt(options, humanize) {
    vi.useFakeTimers()
    const { waitToAttack } = loadAttack(options, humanize)
    let secondRanAt
    const start = Date.now()
    waitToAttack(() => true)
    waitToAttack(() => { secondRanAt = Date.now() - start; return true })
    for (let t = 0; t < 400_000 && secondRanAt === undefined; t += 50)
        await vi.advanceTimersByTimeAsync(50)
    return secondRanAt
}

test("whole-second delays are honoured", async () => {
    const at = await secondAttackStartsAt({ attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" })
    expect(at).toBeGreaterThanOrEqual(3000)
    expect(at).toBeLessThan(3100)
})

test("fractional delays are not truncated (attack.js:272 parseInt)", async () => {
    const at = await secondAttackStartsAt({ attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "0" })
    expect(at).toBeGreaterThanOrEqual(4500)
})

test("with lognormal_delays off the delay stays inside the configured range", async () => {
    for (let i = 0; i < 10; i++) {
        const at = await secondAttackStartsAt({ attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15" })
        expect(at).toBeGreaterThanOrEqual(20_000)
        expect(at).toBeLessThan(35_100)
    }
}, 30_000)

test("with lognormal_delays on the delay is never shorter than the configured one", async () => {
    for (let i = 0; i < 10; i++) {
        const at = await secondAttackStartsAt({ attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15" }, { lognormal_delays: true })
        expect(at).toBeGreaterThanOrEqual(20_000)
        expect(at).toBeLessThan(6 * 60_000)
    }
}, 30_000)

test("with lognormal_delays on a break makes the next attack wait 2 to 6 times as long", async () => {
    const options = { attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    const usual = await secondAttackStartsAt(options, { lognormal_delays: true })
    expect(usual).toBeGreaterThanOrEqual(3000)
    expect(usual).toBeLessThan(3100)

    vi.spyOn(Math, "random").mockReturnValue(0.01)
    const afterBreak = await secondAttackStartsAt(options, { lognormal_delays: true })
    expect(afterBreak).toBeGreaterThanOrEqual(6120)
    expect(afterBreak).toBeLessThan(6220)
})

function loadAttackWithBot(options, bot = fakeBot()) {
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0", ...options }
    return { ...loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {} } } }).mod, bot }
}

const err = require("../err.json")
/** A job whose cra the game refuses with `code`, which throws the error's name as sendAttack does. */
const rejectWith = (bot, code) => async () => {
    bot.xtHandler.emit("cra", {}, code)
    throw err[code]
}

test("a rejected attack still delays the next one", async () => {
    vi.useFakeTimers()
    const { waitToAttack, bot } = loadAttackWithBot()
    let secondRanAt
    const start = Date.now()
    waitToAttack(rejectWith(bot, 101)).catch(() => {})
    waitToAttack(() => { secondRanAt = Date.now() - start; return true })
    for (let t = 0; t < 20_000 && secondRanAt === undefined; t += 50)
        await vi.advanceTimersByTimeAsync(50)
    expect(secondRanAt).toBeGreaterThanOrEqual(3000)
})

/** A game that answers every castle-list request; `log` gets the request, and the jobs below add their own lines. */
function answeringCastleList(log = []) {
    const bot = fakeBot()
    bot.sendXT = async cmd => {
        if (cmd != "dcl")
            return
        log.push("send dcl")
        setTimeout(() => bot.xtHandler.emit("dcl", {}, 0), 100)
    }
    return bot
}

/** When a job queued now runs, in ms from now. */
async function runsAfter(waitToAttack, log, label) {
    const start = Date.now()
    let ranAt
    waitToAttack(() => { ranAt = Date.now() - start; log.push(label); return true })
    for (let t = 0; t < 2 * 60 * 60_000 && ranAt === undefined; t += 1000)
        await vi.advanceTimersByTimeAsync(1000)
    return ranAt
}

test("CANT_START_NEW_ARMIES pauses every attack for 30 minutes, then attacks go on after a fresh castle list", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const log = []
    const { waitToAttack, bot } = loadAttackWithBot({}, answeringCastleList(log))
    waitToAttack(rejectWith(bot, 90), "barons").catch(() => {})
    const ranAt = await runsAfter(waitToAttack, log, "later attack")
    expect(ranAt).toBeGreaterThanOrEqual(30 * 60_000)
    expect(ranAt).toBeLessThan(31 * 60_000)
    expect(log).toEqual(["send dcl", "later attack"])
})

test("ATTACK_TOO_MANY_UNITS and refusals in a row from one plugin no longer pause every attack", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "log").mockImplementation(() => {})
    const log = []
    const { waitToAttack, bot } = loadAttackWithBot({}, answeringCastleList(log))
    for (const code of [101, 101, 101, 313])
        waitToAttack(rejectWith(bot, code), "khan").catch(() => {})
    expect(await runsAfter(waitToAttack, log, "another plugin")).toBeLessThan(60_000)
    expect(log).toEqual(["another plugin"])
})

test("with the default settings attacks go about every 6 seconds, also past the 120th of the hour", async () => {
    const declared = loadModule("plugins/attack/attack.js", { mainThread: true }).mod.pluginOptions
    const defaults = Object.fromEntries(declared.map(def => [def.key, def.default]))
    vi.useFakeTimers()
    const { waitToAttack } = loadAttack({ ...defaults, attackLimit: "" })
    const ranAt = []
    const start = Date.now()
    for (let i = 0; i < 200; i++)
        waitToAttack(() => { ranAt.push(Date.now() - start); return true })
    for (let t = 0; t < 2 * 60 * 60_000 && ranAt.length < 200; t += 250)
        await vi.advanceTimersByTimeAsync(250)
    expect(ranAt).toHaveLength(200)
    const gaps = ranAt.slice(1).map((at, i) => at - ranAt[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4500)
    expect(Math.max(...gaps)).toBeLessThan(7500)
}, 60_000)
