import { createRequire } from "node:module"
import { vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./load.cjs")

export const STORM = 4, GREAT_EMPIRE = 0, BURNING_SANDS = 1, BERIMOND = 10
const FIELD = { MEAD: "mead", F: "food", W: "wood", S: "stone" }

/**
 * Loads `relPath` (a Storm sender, or a file that requires several) against a game whose castles are the Storm castle,
 * the main castle and `others`. `dcl` answers with `fresh(world)` applied first, as protocols.js does. `kgt` and `msk`
 * are answered by `onTransfer` and `onSkip`, which return the code; a transfer that goes through is on its way for
 * an hour with what it carries.
 */
export function runStorm(relPath, { storm = {}, main = {}, others = [], options = {}, held = { "60MinSkip": 10, "5HourSkip": 10, "24HourSkip": 10 }, fresh, onTransfer, onSkip } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    Object.assign(bot.botConfig.plugins, options)
    bot.botConfig.plugins.skips = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true }
    const stormCastle = {
        id: 900, kingdomID: STORM, areaInfo: { type: 12 }, mead: 1_000_000, food: 1000, ...storm,
        getProductionData: {
            maxAmountMead: 10_000_000, MeadConsumptionRate: 0, maxAmountFood: 10_000, FoodConsumptionRate: 100,
            foodConsumptionReductionPercentage: 1, deltaFood: 0, ...storm.getProductionData,
        },
    }
    const mainCastle = { id: 1, kingdomID: GREAT_EMPIRE, areaInfo: { type: 1 }, mead: 1_000_000, food: 1_000_000, ...main }
    const world = [stormCastle, mainCastle, ...others]
    const transfers = [], skips = [], log = []
    const resources = { "1MinSkip": 0, "5MinSkip": 0, "10MinSkip": 0, "30MinSkip": 0, "60MinSkip": 0, "5HourSkip": 0, "24HourSkip": 0, ...held }
    const protocols = {
        KingdomID: { stormIslands: STORM, berimond: BERIMOND, greatEmpire: GREAT_EMPIRE },
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
                    stormCastle.resourceTransfer = { remainingTime: 3600, resources: Object.fromEntries(args[3].map(([code, n]) => [FIELD[code], n])) }
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
    loadModule(relPath, { bot, extra: { "protocols.js": protocols, "/protocols": protocols } })
    bot.events.emit("load")
    const checks = () => bot.sent.filter(([cmd]) => cmd == "dcl").length
    const said = key => log.some(args => args[0] == key)
    return { bot, storm: stormCastle, main: mainCastle, transfers, skips, log, said, checks, resources }
}
