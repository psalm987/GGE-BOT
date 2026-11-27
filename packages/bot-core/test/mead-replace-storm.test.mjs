import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const STORM = 4, GREAT_EMPIRE = 0, BURNING_SANDS = 1

/**
 * The plugin against a game whose castles are `world` (storm first). `dcl` answers with `fresh()` applied to the
 * castles, as protocols.js does. `kgt` and `msk` are answered by `onTransfer` and `onSkip`, which return the code.
 */
function run({ storm = {}, main = {}, others = [], options = {}, held = { "60MinSkip": 10, "5HourSkip": 10, "24HourSkip": 10 }, fresh, onTransfer, onSkip } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.botConfig.plugins.meadReplaceStorm = options
    bot.botConfig.plugins.skips = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true }
    const stormCastle = {
        id: 900, kingdomID: STORM, areaInfo: { type: 12 }, mead: 1000,
        getProductionData: { maxAmountMead: 10_000, MeadConsumptionRate: 100 }, ...storm,
    }
    const mainCastle = { id: 1, kingdomID: GREAT_EMPIRE, areaInfo: { type: 1 }, mead: 1_000_000, ...main }
    const world = [stormCastle, mainCastle, ...others]
    const transfers = [], skips = [], log = []
    const resources = { "1MinSkip": 0, "5MinSkip": 0, "10MinSkip": 0, "30MinSkip": 0, "60MinSkip": 0, "5HourSkip": 0, "24HourSkip": 0, ...held }
    const protocols = {
        KingdomID: { stormIslands: STORM, berimond: 10, greatEmpire: GREAT_EMPIRE },
        KingdomSkipType: { sendResource: 2 },
        AreaType: { mainCastle: 1, externalKingdom: 12 },
        unlockInfoList: [{ kingdomID: STORM, isUnlocked: true }],
        castles: world,
        resources,
        ClientCommands: {
            kingdomUnitTransfer: async (...args) => {
                transfers.push({ at: Date.now(), args })
                const code = onTransfer ? await onTransfer(stormCastle, args) : 0
                if (code == 0) {
                    stormCastle.resourceTransfer = { remainingTime: 3600, resources: { mead: args[3][0][1] } }
                    bot.xtHandler.emit("kgt", {}, 0)
                }
                return code
            },
            skipResourceTransfer: async skip => {
                skips.push(skip)
                return onSkip ? onSkip(stormCastle, skip) : 0
            },
        },
    }
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        if (cmd == "dcl") {
            fresh?.(world)
            queueMicrotask(() => bot.xtHandler.emit("dcl", {}, 0))
        }
    }
    for (const level of ["log", "warn", "debug"])
        vi.spyOn(console, level).mockImplementation((...args) => log.push(args))
    loadModule("plugins/meadReplaceStorm.js", { bot, extra: { "protocols.js": protocols, "/protocols": protocols } })
    bot.events.emit("load")
    const checks = () => bot.sent.filter(([cmd]) => cmd == "dcl").length
    return { bot, storm: stormCastle, main: mainCastle, transfers, skips, log, checks, resources }
}

test("refreshes the castles' mead with dcl before each check", async () => {
    const { bot } = run({ storm: { mead: 100 } })
    await vi.advanceTimersByTimeAsync(1000)
    const sent = bot.sent.map(([cmd]) => cmd)
    expect(sent[0]).toBe("dcl")
})

test("a transfer in flight that lands long before the mead runs out is not skipped", async () => {
    const { skips, transfers } = run({ storm: { mead: 1000, resourceTransfer: { remainingTime: 600, resources: { mead: 500 } } }, held: { "10MinSkip": 5 } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(skips).toEqual([])
    expect(transfers).toEqual([])
})

test("a transfer in flight that lands after the mead runs out is skipped", async () => {
    const { skips } = run({
        storm: { mead: 100, resourceTransfer: { remainingTime: 2 * 3600, resources: { mead: 5000 } } },
        onSkip: castle => { castle.resourceTransfer = undefined; return 0 },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(skips.length).toBeGreaterThan(0)
})

test("a skip whose reply brings no fresh timer is counted down, so the skips stop once they cover the time left", async () => {
    const { skips } = run({ storm: { mead: 100, resourceTransfer: { remainingTime: 3 * 3600, resources: { mead: 5000 } } }, held: { "60MinSkip": 10 } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(skips).toEqual(["MS5", "MS5", "MS5"])
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(skips).toHaveLength(3)
})

test("a skip the game says has run out is retried with another type", async () => {
    const { skips, resources } = run({
        storm: { mead: 100, resourceTransfer: { remainingTime: 5 * 3600, resources: { mead: 5000 } } },
        held: { "60MinSkip": 3, "5HourSkip": 3 },
        onSkip: (castle, skip) => {
            if (skip == "MS6")
                return 335
            castle.resourceTransfer = undefined
            return 0
        },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(skips).toEqual(["MS6", "MS5"])
    expect(resources["5HourSkip"]).toBe(0)
})

test("mead that already landed is not counted again: a low castle gets mead now", async () => {
    const { transfers } = run({
        storm: { mead: 500, getProductionData: { maxAmountMead: 5000, MeadConsumptionRate: 1000 }, resourceTransfer: { remainingTime: 0, resources: { mead: 3000 } } },
        fresh: ([storm]) => { storm.mead = 500 },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers.map(t => t.args)).toEqual([[1, GREAT_EMPIRE, STORM, [["MEAD", 4500]]]])
})

test("waits until the mead lasts less than the hours set, then sends from the main castle", async () => {
    const t0 = Date.now()
    const burning = ([storm]) => { storm.mead = 1000 - 100 * (Date.now() - t0) / HOUR }
    const { transfers } = run({ storm: { mead: 1000 }, options: { refillBelowHours: 2 }, fresh: burning })
    await vi.advanceTimersByTimeAsync(8 * HOUR - MINUTE)
    expect(transfers).toEqual([])
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(transfers).toHaveLength(1)
})

test("sends nothing while a transfer is in flight, and looks again within five minutes", async () => {
    const { transfers, checks } = run({ storm: { mead: 100, resourceTransfer: { remainingTime: 30 * 60, resources: { mead: 5000 } } }, held: {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
    const first = checks()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(transfers).toEqual([])
    expect(checks()).toBeGreaterThan(first)
})

test("a transfer timer counts down from when the game gave it, so the send follows once it has landed", async () => {
    const { transfers } = run({ storm: { mead: 100, resourceTransfer: { remainingTime: 12 * 60, resources: { mead: 5000 } } }, held: {} })
    await vi.advanceTimersByTimeAsync(11 * MINUTE)
    expect(transfers).toEqual([])
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(transfers).toHaveLength(1)
})

test("a transfer that throws doesn't end the loop: it looks again later", async () => {
    let calls = 0
    const { transfers } = run({ storm: { mead: 100 }, onTransfer: async () => { if (calls++ == 0) throw "TIMED_OUT"; return 0 } })
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(transfers.length).toBeGreaterThanOrEqual(2)
})

test("a refused transfer is tried again in five minutes", async () => {
    let calls = 0
    const { transfers } = run({ storm: { mead: 100 }, onTransfer: async () => calls++ == 0 ? 1 : 0 })
    await vi.advanceTimersByTimeAsync(5 * MINUTE + 1000)
    expect(transfers).toHaveLength(2)
})

test("the main castle keeps its reserve when no source list is set", async () => {
    const { transfers } = run({ storm: { mead: 100 }, main: { mead: 3000 }, options: { sourceReserve: 1000 } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers.map(t => t.args[3])).toEqual([[["MEAD", 2000]]])
})

test("with a source list, the first castle with mead above its keep sends, from its own kingdom", async () => {
    const sands = { id: 50, kingdomID: BURNING_SANDS, areaInfo: { type: 12 }, mead: 4000 }
    const { transfers } = run({
        storm: { mead: 100 },
        main: { mead: 9000 },
        others: [sands],
        options: { meadSources: [{ castle: { kingdom: GREAT_EMPIRE, id: 1 }, keep: 10_000 }, { castle: { kingdom: BURNING_SANDS, id: 50 }, keep: 1000 }] },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers.map(t => t.args)).toEqual([[50, BURNING_SANDS, STORM, [["MEAD", 3000]]]])
})

test("with a source list where no castle has mead above its keep, nothing is sent", async () => {
    const { transfers } = run({
        storm: { mead: 100 },
        options: { meadSources: [{ castle: { kingdom: GREAT_EMPIRE, id: 1 }, keep: 2_000_000 }] },
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(transfers).toEqual([])
})

test("the catalog offers the source list as castle rows with a keep", () => {
    const { mod } = loadModule("plugins/meadReplaceStorm.js", { mainThread: true })
    const list = mod.pluginOptions.find(o => o.key == "meadSources")
    expect(list).toMatchObject({ type: "Rows", default: [] })
    expect(list.columns.map(c => [c.key, c.type])).toEqual([["castle", "castle"], ["keep", "number"]])
})
