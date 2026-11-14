import { createRequire } from "node:module"
import { afterEach, test, expect, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

function loadAttack(options) {
    const bot = fakeBot()
    bot.botConfig.plugins.attack = { attackLimit: "", ...options }
    return loadModule("plugins/attack/attack.js", { bot }).mod
}

async function secondAttackStartsAt(options) {
    vi.useFakeTimers()
    const { waitToAttack } = loadAttack(options)
    let secondRanAt
    const start = Date.now()
    waitToAttack(() => true)
    waitToAttack(() => { secondRanAt = Date.now() - start; return true })
    for (let t = 0; t < 10_000 && secondRanAt === undefined; t += 50)
        await vi.advanceTimersByTimeAsync(50)
    return secondRanAt
}

test("whole-second delays are honoured", async () => {
    const at = await secondAttackStartsAt({ attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" })
    expect(at).toBeGreaterThanOrEqual(3000)
    expect(at).toBeLessThan(3100)
})

test.fails("known bug: fractional delays are not truncated (attack.js:272 parseInt)", async () => {
    const at = await secondAttackStartsAt({ attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "0" })
    expect(at).toBeGreaterThanOrEqual(4500)
})
