import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const FORTRESS = 11, KINGDOM = 1, LORD = 5
const DIALOG = ["adi", "gas", "gdi", "cra"]

/**
 * The real fortress plugin and the real attack.js against a game with one
 * fortress ready to hit and one commander, which is out until something frees it. `failing` is a command whose first
 * send is refused.
 */
function fortressBot({ attackDialog, failing, options = {} } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.ggeConfig = { humanize: { attack_dialog: attackDialog } }
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15" }
    const movements = []
    const pool = { held: false, freed: 0 }
    const log = []
    let failed = false
    bot.sendXT = async (cmd, params) => {
        if (cmd == failing && !failed) {
            failed = true
            log.push(`refused ${cmd}`)
            throw "TIMED_OUT"
        }
        const sent = JSON.parse(params)
        log.push(`send ${cmd}`)
        bot.sent.push([cmd, sent, Date.now()])
        if (cmd == "dcl")
            setTimeout(() => bot.xtHandler.emit("dcl", {}, 0), 50)
        if (cmd != "cra")
            return
        expect(pool.held, "the commander is held when cra leaves").toBe(true)
        setTimeout(() => {
            movements.push({ kingdomID: sent.KID, targetAttack: { x: sent.TX, y: sent.TY } })
            bot.xtHandler.emit("cra", { AAM: { M: { KID: sent.KID, TA: [0, sent.TX, sent.TY], TT: 0, PT: 0 }, UM: { L: { VIS: 0 } } } }, 0)
        }, 50)
    }
    const protocols = {
        KingdomID: {}, AreaType: { fortress: FORTRESS, externalKingdom: 12 }, resources: { pegasusTicket: 1 },
        castles: [{
            kingdomID: KINGDOM, id: 1, areaInfo: { type: 12, x: 600, y: 600 },
            unitInventory: [{ amount: 5000, unitInfo: { wodID: 9, fightType: 0, role: "melee", speed: 1 } }],
        }],
        movements, movementEvents: new EventEmitter(),
        ClientCommands: {
            preSpyInfo: async () => {},
            getAreaInfo: async (kingdomID, x1, y1, x2, y2) =>
                ({ areaInfo: x1 <= 620 && x2 >= 620 && y1 <= 590 && y2 >= 590 ? [{ type: FORTRESS, x: 620, y: 590, extraData: [0, 0, 0], timeSinceRequest: 0 }] : [] }),
        },
    }
    const { mod: fortressHit } = loadModule("plugins/attack/sharedFortressAttackLogic.js", {
        bot,
        extra: {
            "protocols": protocols,
            limiter: { RateLimiter: class { removeTokens = async () => 1 } },
            "../commander": {
                waitForCommanderAvailable: async () => {
                    while (pool.held)
                        await new Promise(resolve => { pool.wake = resolve })
                    pool.held = true
                    return { lordID: LORD, getEffects: () => ({}) }
                },
                freeCommander: lordID => { expect(lordID).toBe(LORD); pool.held = false; pool.freed++; pool.wake?.() },
                useCommander() {},
            },
        },
    })
    fortressHit(KINGDOM, 60, options, "/plugins/attackFortressesBurningSands.js").catch(error => log.push(`plugin stopped: ${error}`))
    const dialogFrames = () => bot.sent.filter(([cmd]) => DIALOG.includes(cmd))
    return { bot, log, pool, dialogFrames }
}

const target = { SX: 600, SY: 600, TX: 620, TY: 590, KID: KINGDOM }

test("with attack_dialog an attack opens the dialog the way the client does, then sends cra", async () => {
    const { dialogFrames, log, pool } = fortressBot({ attackDialog: true })
    await vi.advanceTimersByTimeAsync(60_000)

    const frames = dialogFrames()
    expect(frames.map(([cmd]) => cmd)).toEqual(DIALOG)
    const [adi, gas, gdi, cra] = frames
    expect(adi[1]).toEqual(target)
    expect(gas[1]).toEqual({})
    expect(gdi[1]).toEqual({ PID: 7 })
    expect(cra[1]).toMatchObject({ ...target, LID: LORD, WT: 0, HBW: -1, CD: 99 })
    expect(cra[1].A[0].L.U[0]).toEqual([9, 52])

    const waits = frames.slice(1).map(([, , at], i) => at - frames[i][2])
    expect(waits[0]).toBeGreaterThanOrEqual(800)
    expect(waits[1]).toBeGreaterThanOrEqual(3000)
    expect(waits[2]).toBeGreaterThanOrEqual(1500)
    expect(cra[2] - adi[2]).toBeLessThanOrEqual(2500 + 9000 + 5000)
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

test("with attack_dialog off an attack is the cra alone", async () => {
    const { dialogFrames, bot } = fortressBot({ attackDialog: false })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(dialogFrames().map(([cmd]) => cmd)).toEqual(["cra"])
    expect(bot.sent.map(([cmd]) => cmd)).toEqual(["cra"])
})

test.each(["adi", "gas", "gdi"])("a %s that fails frees the commander, sends no cra, and the next try goes through", async step => {
    const { log, pool } = fortressBot({ attackDialog: true, failing: step })
    await vi.advanceTimersByTimeAsync(20_000)

    expect(log).toContain(`refused ${step}`)
    expect(log).not.toContain("send cra")
    expect(pool.freed).toBe(1)

    await vi.advanceTimersByTimeAsync(180_000)
    expect(log.filter(line => line == "send cra")).toHaveLength(1)
    expect(log.indexOf("send cra")).toBeGreaterThan(log.lastIndexOf("send adi"))
    expect(log.filter(line => line == "send adi")).toHaveLength(step == "adi" ? 1 : 2)
    expect(log.filter(line => line.startsWith("plugin stopped"))).toEqual([])
})
