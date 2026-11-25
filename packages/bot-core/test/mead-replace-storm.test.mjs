import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

test("skips a running mead transfer when the storm castle would run dry before it lands", async () => {
    vi.useFakeTimers()
    const skipped = []
    const storm = {
        id: 900, kingdomID: 4, mead: 100, areaInfo: { type: 12 },
        getProductionData: { maxAmountMead: 1000, MeadConsumptionRate: 1 },
        resourceTransfer: { remainingTime: 1200, resources: { mead: 0 } },
    }
    const main = { id: 1, kingdomID: 0, mead: 5000, areaInfo: { type: 1 } }
    const protocols = {
        KingdomID: { stormIslands: 4, greatEmpire: 0 },
        AreaType: { mainCastle: 1, externalKingdom: 12 },
        KingdomSkipType: { sendResource: 1 },
        unlockInfoList: [{ kingdomID: 4, isUnlocked: true }],
        castles: [storm, main],
        ClientCommands: {
            skipResourceTransfer: async (...args) => { skipped.push(args); return 0 },
            kingdomUnitTransfer: async () => 0,
        },
    }
    const skips = { spendSkip: () => "MS6", MinuteSkipType: { MS6: 300 } }
    const bot = fakeBot()
    loadModule("plugins/meadReplaceStorm.js", { bot, extra: { "protocols.js": protocols, "skips.js": skips } })

    bot.events.emit("load")
    await vi.advanceTimersByTimeAsync(10)

    expect(skipped).toEqual([["MS6", 4, 1]])
    expect(storm.resourceTransfer.remainingTime).toBeLessThanOrEqual(0)
})
