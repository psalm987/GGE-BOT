import { createRequire } from "node:module"
import { test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

test("sends storm wood and stone to a main castle with room for it", async () => {
    const transfers = []
    const storm = { id: 900, kingdomID: 4, wood: 500, stone: 30, areaInfo: { type: 0 }, emit() {} }
    const main = {
        id: 1, kingdomID: 0, wood: 0, stone: 0, areaInfo: { type: 1 },
        getProductionData: { maxAmountWood: 100, maxAmountStone: 100 },
    }
    const protocols = {
        KingdomID: { stormIslands: 4, berimond: 10, 0: "greatEmpire" },
        AreaType: { mainCastle: 1, externalKingdom: 12 },
        unlockInfoList: [{ kingdomID: 4, isUnlocked: true }],
        castles: [storm, main],
        ClientCommands: {
            kingdomUnitTransfer: async (...args) => { transfers.push(args); return 0 },
        },
    }
    const bot = fakeBot()
    loadModule("plugins/resourceSendStorm.js", { bot, extra: { "protocols.js": protocols } })

    bot.events.emit("load")
    await new Promise(r => setTimeout(r, 20))

    expect(transfers).toEqual([[900, 4, 0, [["W", 100], ["S", 30]]]])
})
