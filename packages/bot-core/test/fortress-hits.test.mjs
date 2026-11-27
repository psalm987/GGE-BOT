import { createRequire } from "node:module"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { fortressBot } = require("./harness/fortress-bot.cjs")

beforeEach(() => {
    vi.useFakeTimers()
    for (const level of ["warn", "info", "log", "debug"])
        vi.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const cras = bot => bot.sent.filter(([cmd]) => cmd == "cra").map(([, cra]) => cra)
const FIVE_DAYS = 5 * 24 * 3600

test("after its own hit a fortress is left alone for the player's cooldown, though the map shows it ready", async () => {
    const { bot, marchHome } = fortressBot({ items: { bossdungeons: [{ kID: "1", playerCooldownDelay: String(FIVE_DAYS) }] } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cras(bot)).toHaveLength(1)
    marchHome(0)
    await vi.advanceTimersByTimeAsync(6 * 3600_000)
    expect(cras(bot)).toHaveLength(1)
})

test("without the player's cooldown in the game data a fortress the map shows ready is hit again", async () => {
    const { bot, marchHome } = fortressBot()
    await vi.advanceTimersByTimeAsync(60_000)
    marchHome(0)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(cras(bot).length).toBeGreaterThan(1)
})

test("a fortress's level comes from its map data (extraData[1]), and the plugin's level is only the fallback", async () => {
    const { bot } = fortressBot({ fortresses: [{ x: 620, y: 590, level: 44 }] })
    await vi.advanceTimersByTimeAsync(60_000)
    // 20% of 5 x 44 + 8 attackers on the left flank, not 20% of 5 x 60 + 8
    expect(cras(bot)[0].A[0].L.U[0]).toEqual([9, 46])
})

test("the commander's bonuses for a fortress widen the flank", async () => {
    const { bot } = fortressBot({ effects: { attackUnitAmountFlank: 50 } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cras(bot)[0].A[0].L.U[0]).toEqual([9, Math.ceil(0.2 * 260 * 1.5)])
})

test("fortresses are looked for within 50 tiles of the castle", async () => {
    const { log } = fortressBot()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(log).toContain("scan 50")
})

test("a refused attack screen holds that fortress for 5 minutes, the plugin goes on with another and does not stop", async () => {
    const near = { x: 610, y: 600 }, far = { x: 640, y: 640 }
    const { bot, log, marchHome } = fortressBot({ fortresses: [near, far], screenRefusal: fortress => fortress.x == near.x ? 95 : undefined })
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(cras(bot).map(cra => [cra.TX, cra.TY])).toEqual([[far.x, far.y]])
    marchHome(0)
    await vi.advanceTimersByTimeAsync(60_000)
    const nearScreens = () => bot.sent.filter(([cmd, p]) => cmd == "abi" && p.TX == near.x).length
    const before = nearScreens()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(nearScreens(), "the held fortress gets no screen within its 5 minutes").toBe(before)
    expect(log.filter(line => line.startsWith("plugin stopped"))).toEqual([])
})

test("out of troops with no army out, the plugin looks again after 5 minutes instead of waiting for ever", async () => {
    const { bot, castle } = fortressBot({ troops: 0 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cras(bot)).toHaveLength(0)
    castle.unitInventory[0].amount = 5000
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(cras(bot)).toHaveLength(1)
})
