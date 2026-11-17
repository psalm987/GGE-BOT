import { createRequire } from "node:module"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot, repo } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

/** A game server that answers in send order, from its own unit count. */
function serverBot(units, { craTimesOut = false } = {}) {
    const bot = fakeBot()
    if (craTimesOut) {
        const real = bot.waitForResult
        bot.waitForResult = (key, timeout, filter) => key == "cra" ? Promise.reject("TIMED_OUT") : real(key, timeout, filter)
    }
    const log = []
    bot.server = { units }
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        log.push(`send ${cmd}`)
        setTimeout(() => {
            if (cmd == "cra") {
                if (p.amount > bot.server.units)
                    return log.push("reply cra 101"), bot.xtHandler.emit("cra", {}, 101)
                bot.server.units -= p.amount
                log.push("reply cra 0")
                bot.xtHandler.emit("cra", { AAM: { M: { KID: 0, TA: [0, p.x, p.y] } } }, 0)
            }
            if (cmd == "dcl") {
                log.push("reply dcl")
                bot.xtHandler.emit("dcl", { units: bot.server.units }, 0)
            }
        }, 100)
    }
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    const { mod } = loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {} } } })
    return { ...mod, bot, log }
}

test("after a rejected attack, no attack goes out until the fresh castle list arrives", async () => {
    vi.useFakeTimers()
    const { waitToAttack, sendAttack, bot, log } = serverBot(50)
    let local = 100
    bot.xtHandler.on("dcl", obj => { local = obj.units })
    const attack = amount => waitToAttack(async () => {
        local -= amount
        return sendAttack({ amount, x: 1, y: 2 }, 0, 1, 2)
    })
    const a = attack(60).catch(e => e)
    const b = attack(30)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(await a).toBe("MISSING_UNITS")
    await expect(b).resolves.toBeTruthy()
    expect(log).toEqual(["send cra", "reply cra 101", "send dcl", "reply dcl", "send cra", "reply cra 0"])
    expect(local).toBe(bot.server.units)
})

test("no attack leaves a castle Auto Station has locked, and attacks from other castles still go", async () => {
    vi.useFakeTimers()
    const { sendAttack, log } = serverBot(50)
    const { lockCastle, unlockCastle } = require(path.join(repo, "castleLock.js"))
    lockCastle(0, 100, 200)

    await expect(sendAttack({ amount: 10, SX: 100, SY: 200, x: 1, y: 2 }, 0, 1, 2)).rejects.toBe("CASTLE_LOCKED")
    await expect(sendAttack({ amount: 10, SX: 100, SY: 200, x: 1, y: 2 }, 0, 1, 2, { dryRun: true })).rejects.toBe("CASTLE_LOCKED")
    expect(log).toEqual([])

    sendAttack({ amount: 10, SX: 100, SY: 200, x: 1, y: 2 }, 2, 1, 2).catch(() => {})
    const otherCastle = sendAttack({ amount: 10, SX: 101, SY: 200, x: 1, y: 2 }, 0, 1, 2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(log.filter(line => line == "send cra"), "the same spot in another kingdom and another castle both send").toHaveLength(2)
    await expect(otherCastle).resolves.toBeTruthy()

    unlockCastle(0, 100, 200)
    const unlocked = sendAttack({ amount: 10, SX: 100, SY: 200, x: 1, y: 2 }, 0, 1, 2)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(unlocked).resolves.toBeTruthy()
})

test("a timed-out attack resyncs before the queue moves on", async () => {
    vi.useFakeTimers()
    const { sendAttack, log } = serverBot(50, { craTimesOut: true })
    const result = sendAttack({ amount: 10, x: 1, y: 2 }, 0, 1, 2).catch(e => e)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await result).toBe("TIMED_OUT")
    expect(log).toContain("send dcl")
})

test("units from a returning march are not added on top of a newer castle list", () => {
    const { mod, bot } = loadModule("protocols.js")
    bot.xtHandler.emit("dcl", { C: [{ KID: 0, AI: [{ AID: 1, gpa: {} }] }] }, 0)
    const castle = mod.castles.find(c => c.id == 1)
    const march = { owner: { ownerID: 7 }, targetOwner: { ownerID: 7 }, kingdomID: 0, targetAttack: { extraData: [1] }, resources: {} }
    const returned = () => ({ ...march, station: [{ unitInfo: { wodID: 5 }, amount: 40 }] })

    castle.unitInventory = [{ unitInfo: { wodID: 5 }, amount: 100 }]
    castle.unitsSyncedAt = Date.now() - 500
    mod.movementEvents.emit("return", returned())
    expect(castle.unitInventory[0].amount).toBe(100)

    castle.unitsSyncedAt = Date.now() - 5000
    mod.movementEvents.emit("return", returned())
    expect(castle.unitInventory[0].amount).toBe(140)
})
