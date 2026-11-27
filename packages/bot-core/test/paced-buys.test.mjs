import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const never = () => new Promise(() => {})

test("Storm Forts buys from one snapshot, spaced out, even when resourceUpdate fires mid-run", async () => {
    vi.useFakeTimers()
    const castle = Object.assign(new EventEmitter(), {
        kingdomID: 4, aqua: 400_000, areaInfo: { type: 12 },
        getProductionData: { maxAmountAqua: 450_000 },
    })
    const protocols = {
        KingdomID: { stormIslands: 4 }, AreaType: { stormTower: 30, externalKingdom: 12 },
        castles: [castle], movements: [], movementEvents: new EventEmitter(),
        ClientCommands: new Proxy({}, { get: () => never }),
    }
    const bot = fakeBot()
    const sentAt = []
    bot.sendXT = async (cmd, params) => { sentAt.push([cmd, Date.now(), JSON.parse(params)]) }
    bot.botConfig.plugins.attackStormForts = { buyCoins: true }
    loadModule("plugins/attack/attackStormForts.js", {
        bot,
        extra: {
            "protocols.js": protocols,
            "./attack.js": { waitToAttack: never, getAttackInfo() {}, assignUnit() {}, getAmountSoldiersFlank() {} },
            "commander.js": { waitForCommanderAvailable: never, freeCommander() {}, commanderRefused() {} },
        },
    })
    bot.events.emit("load")
    await vi.advanceTimersByTimeAsync(3_000)
    castle.emit("resourceUpdate")
    castle.emit("resourceUpdate")
    await vi.advanceTimersByTimeAsync(60_000)

    const buys = sentAt.filter(([cmd]) => cmd == "sbp")
    expect(buys).toHaveLength(Math.floor(400_000 / 75_000))
    for (let i = 1; i < buys.length; i++)
        expect(buys[i][1] - buys[i - 1][1]).toBeGreaterThanOrEqual(2000)
})

test("Feast waits for each feast's reply and spaces them out", async () => {
    vi.useFakeTimers()
    const castle = {
        id: 1, kingdomID: 0, food: 1_000_000, areaInfo: { type: 1 },
        getProductionData: { deltaFood: 100, FoodConsumptionRate: 0, foodConsumptionReductionPercentage: 0, maxAmountFood: 2_000_000 },
    }
    const feastsAt = []
    const protocols = {
        KingdomID: { stormIslands: 4, berimond: 10, greatEmpire: 0 }, AreaType: { mainCastle: 1 },
        castles: [castle],
        ClientCommands: { startFeast: async () => { feastsAt.push(Date.now()); return { result: 0 } } },
    }
    const bot = fakeBot()
    bot.botConfig.plugins.feast = {}
    bot.playerInfo.level = 80
    const feasts = [{ feastID: "8", costFood: "150000", minLevel: 70, maxLevel: "1020" }]
    loadModule("plugins/feast.js", { bot, items: { feasts }, extra: { "protocols.js": protocols } })
    bot.events.emit("load")
    await vi.advanceTimersByTimeAsync(60_000)

    expect(feastsAt).toHaveLength(Math.floor((1_000_000 - 150_000) / 150_000))
    for (let i = 1; i < feastsAt.length; i++)
        expect(feastsAt[i] - feastsAt[i - 1]).toBeGreaterThanOrEqual(2000)
})
