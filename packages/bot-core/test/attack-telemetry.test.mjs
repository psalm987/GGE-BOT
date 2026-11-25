import { createRequire } from "node:module"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot, repo } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

/** A game that answers each `cra` with `reply(params)`: 0 for success, an error code to refuse. */
function setup(reply = () => 0) {
    const bot = fakeBot()
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        setTimeout(() => {
            if (cmd == "cra") {
                const result = reply(p)
                bot.xtHandler.emit("cra", result == 0 ? { AAM: { M: { KID: 0, TA: [0, p.x, p.y], TT: 210 } } } : {}, result)
            }
            if (cmd == "dcl")
                bot.xtHandler.emit("dcl", {}, 0)
        }, 100)
    }
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    const { mod } = loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {} } } })
    const metrics = require(path.join(repo, "metrics.js"))
    metrics.flush(() => {})
    const collect = () => {
        let batch = { counters: [], observations: [] }
        metrics.flush(b => { batch = b })
        const counters = Object.fromEntries(batch.counters.map(([name, labels, n]) => [name + JSON.stringify(labels), n]))
        const observations = Object.fromEntries(batch.observations.map(([name, labels, v]) => [name + JSON.stringify(labels), v]))
        return { counters, observations }
    }
    return { ...mod, bot, collect }
}

const err = require(path.join(repo, "err.json"))
const refusalCode = Object.keys(err).find(code => err[code] == "ATTACK_TOO_MANY_UNITS")

test("a sent attack counts as sent and records its round trip as twice the one-way travel", async () => {
    vi.useFakeTimers()
    const { sendAttack, collect } = setup()
    const sent = sendAttack({ x: 1, y: 2 }, 0, 1, 2)
    await vi.advanceTimersByTimeAsync(1_000)
    await sent
    const { counters, observations } = collect()
    expect(counters['bot_attacks_total{"result":"sent","kingdom":"0"}']).toBe(1)
    expect(observations['bot_attack_round_trip_seconds{"kingdom":"0"}']).toEqual([420])
})

test("a refusal counts by reason, and the queue pause it triggers is counted as refusal-pause idle time", async () => {
    vi.useFakeTimers()
    let refuse = true
    const { sendAttack, waitToAttack, collect } = setup(() => refuse ? refusalCode : 0)
    const attack = () => waitToAttack(() => sendAttack({ x: 1, y: 2 }, 0, 1, 2)).catch(e => e)
    const first = attack()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await first).toBe("ATTACK_TOO_MANY_UNITS")
    refuse = false
    const second = attack()
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    await second
    const { counters } = collect()
    expect(counters['bot_attacks_total{"result":"refused","kingdom":"0"}']).toBe(1)
    expect(counters['bot_attacks_total{"result":"sent","kingdom":"0"}']).toBe(1)
    expect(counters['bot_attack_refusals_total{"reason":"ATTACK_TOO_MANY_UNITS"}']).toBe(1)
    expect(counters['bot_attack_pauses_total{"reason":"ATTACK_TOO_MANY_UNITS"}']).toBe(1)
    expect(counters['bot_attack_idle_seconds_total{"cause":"refusal_pause"}']).toBeGreaterThan(200)
    expect(counters['bot_attack_idle_seconds_total{"cause":"refusal_pause"}']).toBeLessThanOrEqual(300)
})

test("a locked castle counts as castle_locked and sends nothing", async () => {
    vi.useFakeTimers()
    const { sendAttack, bot, collect } = setup()
    const { lockCastle, unlockCastle } = require(path.join(repo, "castleLock.js"))
    lockCastle(0, 100, 200)
    await expect(sendAttack({ SX: 100, SY: 200, x: 1, y: 2 }, 0, 1, 2)).rejects.toBe("CASTLE_LOCKED")
    unlockCastle(0, 100, 200)
    expect(collect().counters['bot_attacks_total{"result":"castle_locked","kingdom":"0"}']).toBe(1)
    expect(bot.sent).toEqual([])
})

test("waiting out the daily cap is counted as daily_cap idle time", async () => {
    vi.useFakeTimers()
    const { waitOutDailyLimit, collect } = setup()
    const waited = waitOutDailyLimit(() => {})
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await waited
    expect(collect().counters['bot_attack_idle_seconds_total{"cause":"daily_cap"}']).toBe(300)
})

test("a plugin waiting for a commander to come home is counted as no_free_commander idle time", async () => {
    vi.useFakeTimers()
    const bot = fakeBot()
    const { mod } = loadModule("plugins/commander.js", { bot })
    const metrics = require(path.join(repo, "metrics.js"))
    metrics.flush(() => {})
    bot.xtHandler.emit("gli", { C: [{ ID: 5, VIS: 0 }] }, 0)
    const lord = mod.takeFreeCommander()
    expect(lord).toBeTruthy()
    const next = mod.waitForCommanderAvailable()
    await vi.advanceTimersByTimeAsync(90_000)
    mod.freeCommander(lord.lordID)
    await next
    let batch
    metrics.flush(b => { batch = b })
    const idle = batch.counters.find(([name, labels]) => name == "bot_attack_idle_seconds_total" && labels.cause == "no_free_commander")
    expect(idle?.[2]).toBe(90)
})
