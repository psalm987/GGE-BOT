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

function loadAttackWithBot(options) {
    const bot = fakeBot()
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0", ...options }
    return { ...loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {} } } }).mod, bot }
}

const rejectWith = (bot, code) => async () => {
    bot.xtHandler.emit("cra", {}, code)
    throw "REJECTED"
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

test("ATTACK_TOO_MANY_UNITS halts every queued and later attack", async () => {
    vi.useFakeTimers()
    const { waitToAttack, bot } = loadAttackWithBot()
    let laterRan = false
    waitToAttack(rejectWith(bot, 313)).catch(() => {})
    const queued = waitToAttack(() => { laterRan = true; return true })
    const queuedResult = queued.catch(e => e)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(await queuedResult).toBe("ATTACKS_HALTED")
    await expect(waitToAttack(() => { laterRan = true; return true })).rejects.toBe("ATTACKS_HALTED")
    expect(laterRan).toBe(false)
})

test("three rejections in a row halt attacks; a success resets the count", async () => {
    vi.useFakeTimers()
    const { waitToAttack, bot } = loadAttackWithBot()
    const ok = () => { bot.xtHandler.emit("cra", {}, 0); return true }
    for (const job of [rejectWith(bot, 101), rejectWith(bot, 101), ok, rejectWith(bot, 101), rejectWith(bot, 101)])
        waitToAttack(job).catch(() => {})
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await expect(waitToAttack(() => true)).resolves.toBe(true)
    waitToAttack(rejectWith(bot, 101)).catch(() => {})
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await expect(waitToAttack(ok)).rejects.toBe("ATTACKS_HALTED")
})
