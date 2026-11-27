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
        ClientCommands: new Proxy({}, { get: () => never }), shopTurn: task => task(),
    }
    const bot = fakeBot()
    const sentAt = []
    bot.sendXT = async (cmd, params) => {
        sentAt.push([cmd, Date.now(), JSON.parse(params)])
        setTimeout(() => bot.xtHandler.emit(cmd, {}, 0), 1)
    }
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

test("a Storm shop buy waits its turn behind an armourer buy, and keeps the turn until its reply comes", async () => {
    vi.useFakeTimers()
    const castle = Object.assign(new EventEmitter(), {
        kingdomID: 4, aqua: 100_000, areaInfo: { type: 12 },
        getProductionData: { maxAmountAqua: 150_000 },
    })
    let last = Promise.resolve()
    const shopTurn = task => {
        const run = last.then(task, task)
        last = run.catch(() => undefined)
        return run
    }
    const protocols = {
        KingdomID: { stormIslands: 4 }, AreaType: { stormTower: 30, externalKingdom: 12 },
        castles: [castle], movements: [], movementEvents: new EventEmitter(),
        ClientCommands: new Proxy({}, { get: () => never }), shopTurn,
    }
    const bot = fakeBot()
    bot.botConfig.plugins.attackStormForts = { buyCoins: true }
    loadModule("plugins/attack/attackStormForts.js", {
        bot,
        extra: {
            "protocols.js": protocols,
            "./attack.js": { waitToAttack: never, getAttackInfo() {}, assignUnit() {}, getAmountSoldiersFlank() {} },
            "commander.js": { waitForCommanderAvailable: never, freeCommander() {}, commanderRefused() {} },
        },
    })
    let armourerDone
    shopTurn(() => new Promise(resolve => { armourerDone = resolve }))
    bot.events.emit("load")
    await vi.advanceTimersByTimeAsync(3_000)
    expect(bot.sent.filter(([cmd]) => cmd == "sbp")).toHaveLength(0)

    armourerDone()
    await vi.advanceTimersByTimeAsync(10)
    expect(bot.sent.filter(([cmd]) => cmd == "sbp").map(([, order]) => order.PID)).toEqual([2798])
    let nextBuy = false
    shopTurn(async () => { nextBuy = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(nextBuy).toBe(false)

    bot.xtHandler.emit("sbp", { gcu: { C1: 1 } }, 0)
    await vi.advanceTimersByTimeAsync(10)
    expect(nextBuy).toBe(true)
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
