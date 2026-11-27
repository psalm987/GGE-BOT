import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const horses = [
    { wodID: 1, costFactorC1: "1", costFactorC2: "0", unitBoost: "10" },
    { wodID: 2, costFactorC1: "0", costFactorC2: "5", unitBoost: "20" },
]

function engine({ attackLimit = "", pegasusTicket = 5 } = {}) {
    const bot = fakeBot()
    bot.playerInfo.level = 70
    const record = bot.sendXT
    bot.sendXT = async (cmd, params) => {
        await record(cmd, params)
        if (cmd == "dcl")
            setTimeout(() => bot.xtHandler.emit("dcl", {}, 0), 10)
    }
    bot.botConfig.plugins.attack = { attackLimit, attackDelaySeconds: "3", attackDelayRandomizationSeconds: "0" }
    const movementEvents = new EventEmitter()
    const resources = { pegasusTicket }
    const { mod } = loadModule("plugins/attack/attack.js", { bot, items: { horses }, extra: { "protocols": { resources, movementEvents } } })
    return { ...mod, bot, movementEvents, resources }
}

test("each accepted cra adds one to today's count, so the daily limit is reached within the session", async () => {
    vi.useFakeTimers()
    const { waitToAttack, bot } = engine({ attackLimit: "2" })
    bot.xtHandler.emit("gai", { AC: 1, ACTH: 3500 })
    bot.xtHandler.emit("cra", {}, 0)
    bot.xtHandler.emit("cra", {}, 101)
    await expect(waitToAttack(() => true)).rejects.toBe("ATTACK_LIMIT_REACHED")
})

test("gai sets the count when it arrives, and a new day starts again from zero", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-26T23:59:00Z"))
    const { accountLimits, bot } = engine()
    bot.xtHandler.emit("gai", { AC: 40 })
    bot.xtHandler.emit("cra", {}, 0)
    expect(accountLimits().used).toBe(41)
    bot.xtHandler.emit("gai", { AC: 12 })
    expect(accountLimits().used).toBe(12)
    vi.setSystemTime(new Date("2026-11-27T00:01:00Z"))
    expect(accountLimits().used).toBe(0)
    bot.xtHandler.emit("cra", {}, 0)
    expect(accountLimits().used).toBe(1)
})

/** Runs a plugin's attacks through the queue: each throws `error` or returns true, and the times they ran are kept. */
async function attackRun(waitToAttack, plugin, outcomes, ran) {
    for (const error of outcomes)
        await waitToAttack(async () => {
            ran.push([plugin, Date.now()])
            if (error)
                throw error
            return true
        }, plugin).catch(() => {})
}

test("one plugin's repeated refusal makes only that plugin wait longer each time, and a success clears it", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "debug").mockImplementation(() => {})
    const { waitToAttack } = engine()
    const ran = []
    const refusing = attackRun(waitToAttack, "barons", ["COOLING_DOWN", "COOLING_DOWN", "COOLING_DOWN", "COOLING_DOWN", undefined, "COOLING_DOWN"], ran)
    const other = attackRun(waitToAttack, "camps", Array(12).fill(undefined), ran)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await Promise.all([refusing, other])

    const barons = ran.filter(([plugin]) => plugin == "barons").map(([, at]) => at)
    const gaps = barons.slice(1).map((at, i) => Math.round((at - barons[i]) / 1000))
    // The queue's own gap, plus 0, 30, 60 and 120 s for the same error again; after the success no extra wait
    const extra = [0, 30, 60, 120, 0]
    gaps.forEach((gap, i) => {
        expect(gap).toBeGreaterThanOrEqual(extra[i])
        expect(gap).toBeLessThan(extra[i] + 15)
    })
    expect(ran.filter(([plugin]) => plugin == "camps")).toHaveLength(12)
    const campsDone = ran.filter(([plugin]) => plugin == "camps").at(-1)[1]
    expect(campsDone, "the other plugin is not held up by the refusals").toBeLessThan(barons[3])
})

test("troops counted before anything is sent (NO_MORE_TROOPS) add no wait", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "log").mockImplementation(() => {})
    const { waitToAttack } = engine()
    const ran = []
    const run = attackRun(waitToAttack, "fortress", ["NO_MORE_TROOPS", "NO_MORE_TROOPS", "NO_MORE_TROOPS"], ran)
    await vi.advanceTimersByTimeAsync(60_000)
    await run
    expect(ran.at(-1)[1] - ran[0][1]).toBeLessThan(5_000)
})

test("only CANT_START_NEW_ARMIES pauses every plugin, for 30 minutes", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    const { waitToAttack, bot } = engine()
    const ran = []
    const first = waitToAttack(async () => {
        ran.push(["barons", Date.now()])
        bot.xtHandler.emit("cra", {}, 304)
        throw "CANT_START_NEW_ARMIES"
    }, "barons").catch(() => {})
    const second = waitToAttack(async () => (ran.push(["camps", Date.now()]), true), "camps")
    await vi.advanceTimersByTimeAsync(40 * 60_000)
    await Promise.all([first, second])
    expect(ran[1][1] - ran[0][1]).toBeGreaterThanOrEqual(30 * 60_000)
})

test("a refusal of another kind no longer pauses every plugin", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    const { waitToAttack, bot } = engine()
    const ran = []
    const refusals = Array.from({ length: 3 }, () => waitToAttack(async () => {
        bot.xtHandler.emit("cra", {}, 101)
        throw "MISSING_UNITS"
    }, "khan").catch(() => {}))
    const other = waitToAttack(async () => (ran.push(Date.now()), true), "camps")
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await Promise.all([...refusals, other])
    expect(ran).toHaveLength(1)
})

test("waitForTroops ends when an army of the plugin comes home, or after 5 minutes at most", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "log").mockImplementation(() => {})
    const { waitForTroops, movementEvents } = engine()
    let woke = false
    const ours = waitForTroops(movement => movement.mine).then(() => { woke = true })
    movementEvents.emit("return", { mine: false })
    await vi.advanceTimersByTimeAsync(1)
    expect(woke).toBe(false)
    movementEvents.emit("return", { mine: true })
    await ours
    expect(movementEvents.listenerCount("return")).toBe(0)

    const start = Date.now()
    await Promise.all([waitForTroops(() => false), vi.advanceTimersByTimeAsync(5 * 60_000)])
    expect(Date.now() - start).toBe(5 * 60_000)
    expect(movementEvents.listenerCount("return")).toBe(0)
})

test("with no horse chosen and no feathers left nothing is warned, and the attack walks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { getAttackInfo } = engine({ pegasusTicket: 0 })
    const cra = getAttackInfo(0, { areaInfo: { x: 1, y: 1 }, unlockedHorses: [1, 2] }, { x: 2, y: 2 }, { lordID: 1 }, 50, 1, {}, 0)
    expect(cra).toMatchObject({ HBW: -1, PTT: 0 })
    expect(warn).not.toHaveBeenCalled()
})

test("feather with none left rides the coin horse instead, and warns at most every 10 minutes", () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { getAttackInfo, resources } = engine({ pegasusTicket: 0 })
    const ride = () => getAttackInfo(0, { areaInfo: { x: 1, y: 1 }, unlockedHorses: [1, 2] }, { x: 2, y: 2 }, { lordID: 1 }, 50, 1, { useFeather: true }, 0)
    expect(ride()).toMatchObject({ HBW: 1, PTT: 0 })
    ride()
    expect(warn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000)
    ride()
    expect(warn).toHaveBeenCalledTimes(2)
    resources.pegasusTicket = 1
    expect(ride()).toMatchObject({ HBW: -1, PTT: 1 })
})
