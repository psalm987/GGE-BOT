import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

class Lord {
    constructor(raw) {
        this.lordID = Number(raw.ID)
        this.AE = raw.AE
    }
}
class UnitInventory {
    constructor(gui) {
        this.unitInventory = gui.I.map(([wodID, amount]) => ({ unitInfo: { wodID }, amount }))
    }
}

/** attack.js against a game whose attack screens answer with `reply(command, params)` as [payload, result], or not at all. */
function screenBot(reply = () => undefined) {
    const bot = fakeBot()
    bot.sendXT = async (cmd, params) => {
        const sent = JSON.parse(params)
        bot.sent.push([cmd, sent])
        const answer = reply(cmd, sent)
        if (answer)
            setTimeout(() => bot.xtHandler.emit(cmd, ...answer), 10)
    }
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    const { mod } = loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {}, ClassTypes: { Lord, UnitInventory } } } })
    return { ...mod, bot }
}

const castle = () => ({ id: 4, areaInfo: { x: 100, y: 200 }, unitInventory: [{ unitInfo: { wodID: 9 }, amount: 500 }] })
const known = { lordID: 3, known: true }
const screenReply = (target, extra = {}) => ({
    SCID: 4, gui: { I: [[9, 120], [11, 7]] }, gaa: { AI: [target.type, target.x, target.y, 40, 0, 0, 77] },
    gli: { C: [{ ID: 2 }, { ID: 3 }] }, AE: [[61, [5], 0]], ...extra,
})

test.each([[12, "adi"], [27, "adi"], [11, "abi"], [17, "aci"]])("a target of area type %s opens the screen with %s", async (type, command) => {
    vi.useFakeTimers()
    const target = { type, x: 110, y: 210, extraData: [] }
    const { openAttackScreen, bot } = screenBot((cmd, p) => cmd == command ? [screenReply({ type, x: p.TX, y: p.TY }), 0] : undefined)
    const opened = openAttackScreen(castle(), target, 1, known)
    await vi.advanceTimersByTimeAsync(100)
    await opened
    expect(bot.sent).toEqual([[command, { SX: 100, SY: 200, TX: 110, TY: 210, KID: 1 }]])
})

test("a storm resource island (area type 24) has no attack screen: nothing is sent and the known commander is kept", async () => {
    const { openAttackScreen, bot } = screenBot()
    await expect(openAttackScreen(castle(), { type: 24, x: 1, y: 2 }, 4, known)).resolves.toBe(known)
    expect(bot.sent).toEqual([])
})

test("the screen's troop count replaces the castle's, its target data replaces the plugin's, and its commander carries the screen's bonuses", async () => {
    vi.useFakeTimers()
    const target = { type: 27, x: 110, y: 210, extraData: [1, 2] }
    const source = castle()
    const { openAttackScreen } = screenBot((cmd, p) => [screenReply({ type: 27, x: p.TX, y: p.TY }), 0])
    const opened = openAttackScreen(source, target, 0, known)
    await vi.advanceTimersByTimeAsync(100)
    const commander = await opened

    expect(source.unitInventory).toEqual([{ unitInfo: { wodID: 9 }, amount: 120 }, { unitInfo: { wodID: 11 }, amount: 7 }])
    expect(target.extraData).toEqual([40, 0, 0, 77])
    expect(Date.now() - target.timeSinceRequest).toBeLessThan(1000)
    expect(commander).toBeInstanceOf(Lord)
    expect(commander).toMatchObject({ lordID: 3, AE: [[61, [5], 0]] })
})

test("a screen for another castle leaves the castle's troops alone, and one with no data for the commander keeps the known commander", async () => {
    vi.useFakeTimers()
    const source = castle()
    const { openAttackScreen } = screenBot((cmd, p) => [screenReply({ type: 27, x: p.TX, y: p.TY }, { SCID: 99, gli: { C: [{ ID: 2 }] } }), 0])
    const opened = openAttackScreen(source, { type: 27, x: 110, y: 210, extraData: [] }, 0, known)
    await vi.advanceTimersByTimeAsync(100)
    expect(await opened).toBe(known)
    expect(source.unitInventory).toEqual(castle().unitInventory)
})

test("a screen for another target is not taken as this one's", async () => {
    vi.useFakeTimers()
    const { openAttackScreen, bot } = screenBot()
    let done = false
    const opened = openAttackScreen(castle(), { type: 27, x: 110, y: 210, extraData: [] }, 0, known).then(c => { done = true; return c })
    bot.xtHandler.emit("adi", screenReply({ type: 27, x: 1, y: 1 }), 0)
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toBe(false)
    bot.xtHandler.emit("adi", screenReply({ type: 27, x: 110, y: 210 }), 0)
    await vi.advanceTimersByTimeAsync(10)
    expect((await opened).lordID).toBe(3)
})

test("a refused screen means the target is not ready: it throws ATTACK_SCREEN_REFUSED and no cra goes out", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "debug").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { openAttackScreen, bot } = screenBot(() => [{}, 76])
    const opened = openAttackScreen(castle(), { type: 27, x: 110, y: 210, extraData: [] }, 0, known).catch(e => e)
    await vi.advanceTimersByTimeAsync(100)
    expect(await opened).toBe("ATTACK_SCREEN_REFUSED")
    expect(bot.sent.map(([cmd]) => cmd)).toEqual(["adi"])
})

test("a dry run opens no screen", async () => {
    const { openAttackScreen, bot } = screenBot()
    await expect(openAttackScreen(castle(), { type: 27, x: 110, y: 210 }, 0, known, { dryRun: true })).resolves.toBe(known)
    expect(bot.sent).toEqual([])
})
