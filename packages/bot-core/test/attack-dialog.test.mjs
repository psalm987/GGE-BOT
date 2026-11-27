import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { fortressBot: harness, KINGDOM, LORD } = require("./harness/fortress-bot.cjs")

afterEach(() => vi.useRealTimers())

const DIALOG = ["abi", "gas", "gdi", "cra"]

function fortressBot(game) {
    vi.useFakeTimers()
    const bot = harness(game)
    return { ...bot, dialogFrames: () => bot.bot.sent.filter(([cmd]) => DIALOG.includes(cmd)) }
}

const target = { SX: 600, SY: 600, TX: 620, TY: 590, KID: KINGDOM }

test("with attack_dialog an attack opens the dialog the way the client does, then sends cra", async () => {
    const { dialogFrames, log, pool } = fortressBot({ attackDialog: true })
    await vi.advanceTimersByTimeAsync(60_000)

    const frames = dialogFrames()
    expect(frames.map(([cmd]) => cmd)).toEqual(DIALOG)
    const [abi, gas, gdi, cra] = frames
    expect(abi[1]).toEqual(target)
    expect(gas[1]).toEqual({})
    expect(gdi[1]).toEqual({ PID: 7 })
    expect(cra[1]).toMatchObject({ ...target, LID: LORD, WT: 0, HBW: -1, CD: 99 })
    expect(cra[1].A[0].L.U[0]).toEqual([9, 52])

    const waits = frames.slice(1).map(([, , at], i) => at - frames[i][2])
    expect(waits[0]).toBeGreaterThanOrEqual(800)
    expect(waits[1]).toBeGreaterThanOrEqual(3000)
    expect(waits[2]).toBeGreaterThanOrEqual(1500)
    expect(cra[2] - abi[2]).toBeLessThanOrEqual(2500 + 9000 + 5000)
    expect(pool.held).toBe(true)
    expect(log.filter(line => line.startsWith("plugin stopped"))).toEqual([])
})

test("an attack built from a wave plan opens the dialog and waits its turn like any other", async () => {
    const custom = { kind: "custom", left: { tools: [null, null], units: [{ item: 9, amount: 30 }, null] }, front: { tools: [null, null, null], units: [null, null, null, null, null, null] }, right: { tools: [null, null], units: [null, null] } }
    const empty = { kind: "preset", preset: 0 }
    const waves = { kind: "manual", waves: [custom, empty, empty, empty], ast: [null, null, null], rw: [null, null, null, null, null, null, null, null] }
    const { dialogFrames, pool } = fortressBot({ attackDialog: true, options: { armyMode: "waves", waves } })
    await vi.advanceTimersByTimeAsync(60_000)

    const frames = dialogFrames()
    expect(frames.map(([cmd]) => cmd)).toEqual(DIALOG)
    expect(frames[3][1].A[0].L.U[0]).toEqual([9, 30])
    expect(frames[3][2] - frames[0][2]).toBeGreaterThanOrEqual(800 + 3000 + 1500)
    expect(pool.held).toBe(true)
})

test("with attack_dialog off an attack is the attack screen and the cra", async () => {
    const { bot } = fortressBot({ attackDialog: false })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(bot.sent.map(([cmd]) => cmd)).toEqual(["abi", "cra"])
})

test.each(["abi", "gas", "gdi"])("a %s that fails frees the commander, sends no cra, and the next try goes through", async step => {
    const { log, pool } = fortressBot({ attackDialog: true, failing: step })
    await vi.advanceTimersByTimeAsync(20_000)

    expect(log).toContain(`refused ${step}`)
    expect(log).not.toContain("send cra")
    expect(pool.freed).toBe(1)

    await vi.advanceTimersByTimeAsync(180_000)
    expect(log.filter(line => line == "send cra")).toHaveLength(1)
    expect(log.indexOf("send cra")).toBeGreaterThan(log.lastIndexOf("send abi"))
    expect(log.filter(line => line == "send abi")).toHaveLength(step == "abi" ? 1 : 2)
    expect(log.filter(line => line.startsWith("plugin stopped"))).toEqual([])
})
