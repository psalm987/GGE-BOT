import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

const melee = (wodID, amount) => ({ unitInfo: { wodID, fightType: 0, role: "melee", meleeAttack: 10 }, amount })

/**
 * Runs an event attack plugin through one attack and returns the `cra` it built.
 * The real attack engine builds the waves; only the send, the queue and the map are stood in for.
 */
async function firstAttack(plugin, { eventID, start = {}, target, inventory, protocols = {}, extra = {}, items = {}, options = {} }) {
    const bot = fakeBot()
    bot.botConfig.plugins[plugin] = options
    const engine = loadModule("plugins/attack/attack.js", { bot, extra: { "protocols": { resources: {} } } }).mod
    const castle = { id: 1, kingdomID: 0, areaInfo: { type: 1, x: 10, y: 10 }, unlockedHorses: [], unitInventory: inventory }
    const sent = []
    loadModule(`plugins/attack/${plugin}.js`, {
        bot, items,
        extra: {
            "protocols.js": {
                movementEvents: new EventEmitter(), movements: [], castles: [castle], ClassTypes: {},
                AreaType: { mainCastle: 1, khanCamp: 35, beriCamp: 30 }, KingdomID: { greatEmpire: 0 },
                ClientCommands: { getNextMapObject: async () => ({ areaInfo: target }), skipTarget: async () => ({ result: 0 }) },
                ...protocols,
            },
            "./attack.js": {
                ...engine,
                waitToAttack: job => job(),
                openAttackScreen: async (castle, areaInfo, kingdomID, commander) => commander,
                sendAttack: async attackInfo => {
                    sent.push(attackInfo)
                    bot.events.emit("eventStop", { EID: eventID })
                    return { AAM: { UM: { L: { VIS: 0 } }, M: { TA: [0, target.x, target.y], TT: 60, PT: 0 } } }
                },
            },
            "commander.js": { waitForCommanderAvailable: async () => ({ lordID: 1, getEffects: () => ({}) }), freeCommander() {}, commanderRefused() {} },
            "skips.js": { spendSkip() {} },
            ...extra,
        },
    })
    bot.events.emit("eventStart", { EID: eventID, ...start })
    for (let i = 0; i < 20 && sent.length == 0; i++)
        await new Promise(resolve => setImmediate(resolve))
    return sent[0]
}

const soldierSlots = cra => [...cra.A.flatMap(wave => [wave.L.U, wave.M.U, wave.R.U]).flat(), ...cra.RW]
    .filter(([wodID]) => wodID != -1)

describe("Khan camps", () => {
    const camp = { x: 20, y: 20, type: 35, extraData: [0, 0, 0, 0, 0, 0, 5] }
    const items = { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50" }] }

    test("troops on the blacklist (277, 34, 35) stay home", async () => {
        const cra = await firstAttack("attackKhan", {
            eventID: 72, start: { EDID: 3 }, target: camp, items,
            inventory: [melee(34, 500), melee(277, 500), melee(10, 500)],
        })

        const sentWods = new Set(soldierSlots(cra).map(([wodID]) => wodID))
        expect([...sentWods]).toEqual([10])
    })

    // At camp level 50 a flank takes 30 tools in 2 slots and the front 40 in 3.
    const banner = (wodID, ragePointBonus, amount) => ({ unitInfo: { wodID, ragePointBonus, slotTypes: "1,2,9" }, amount })
    const empty = [-1, 0]
    const toolSlots = cra => cra.A.map(wave => [wave.L.T, wave.R.T, wave.M.T])
    const khanWithBanners = options => firstAttack("attackKhan", {
        eventID: 72, start: { EDID: 3 }, target: camp, items, options,
        inventory: [melee(10, 5000), banner(106, "1", 100), banner(563, "2", 15)],
    })

    test("rage banners fill the tool room of the waves after the first, strongest first", async () => {
        expect(toolSlots(await khanWithBanners({}))).toEqual([
            [[empty, empty], [empty, empty], [empty, empty, empty]],
            [[[563, 15], [106, 15]], [[106, 30], empty], [[106, 40], empty, empty]],
            [[[106, 15], empty], [empty, empty], [empty, empty, empty]],
            [[empty, empty], [empty, empty], [empty, empty, empty]],
        ])
    })

    test("from wavesTillChests on, chest tools replace the rage banners", async () => {
        const chestTool = { unitInfo: { wodID: 900, khanTabletBooster: "5" }, amount: 100 }
        const cra = await firstAttack("attackKhan", {
            eventID: 72, start: { EDID: 3 }, target: camp, items, options: { wavesTillChests: "2" },
            inventory: [melee(10, 5000), banner(563, "2", 100), chestTool],
        })

        expect(toolSlots(cra)).toEqual([
            [[empty, empty], [empty, empty], [empty, empty, empty]],
            [[[563, 30], empty], [[563, 30], empty], [[563, 40], empty, empty]],
            [[[900, 30], empty], [[900, 30], empty], [[900, 40], empty, empty]],
            [[empty, empty], [empty, empty], [empty, empty, empty]],
        ])
    })

    test("with low-value chests the weakest rage banners go first", async () => {
        expect(toolSlots(await khanWithBanners({ lowValueChests: true }))).toEqual([
            [[empty, empty], [empty, empty], [empty, empty, empty]],
            [[[106, 30], empty], [[106, 30], empty], [[106, 40], empty, empty]],
            [[[563, 15], empty], [empty, empty], [empty, empty, empty]],
            [[empty, empty], [empty, empty], [empty, empty, empty]],
        ])
    })
})

describe("Berimond invasion camps", () => {
    const camp = (victories, flag) => ({ x: 20, y: 20, type: 30, extraData: [0, victories, 0, 0, 0, 0, flag] })
    const berimond = target => firstAttack("attackBerimondInvasion", {
        eventID: 85, target,
        inventory: [melee(10, 10_000)],
        extra: { "mapScan.js": { areasAround: async () => [target] } },
    })
    const firstFlank = cra => cra.A[0].L.U[0]

    // The camp level is its victories plus 70 when extraData[6] is 100, else plus 56.
    // A flank holds a fifth of the attackers, which is 320 from level 70 and 260 below it.
    test("a camp with flag 100 is sized at victories + 70", async () => {
        expect(firstFlank(await berimond(camp(2, 100)))).toEqual([10, 64])
    })

    test("a camp without the flag is sized at victories + 56", async () => {
        expect(firstFlank(await berimond(camp(20, 0)))).toEqual([10, 64])
        expect(firstFlank(await berimond(camp(2, 0)))).toEqual([10, 52])
    })
})
