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
                movementEvents: new EventEmitter(), castles: [castle], ClassTypes: {},
                AreaType: { mainCastle: 1, khanCamp: 35, beriCamp: 30 }, KingdomID: { greatEmpire: 0 },
                ClientCommands: { getNextMapObject: async () => ({ areaInfo: target }), skipTarget: async () => ({ result: 0 }) },
                ...protocols,
            },
            "./attack.js": {
                ...engine,
                waitToAttack: job => job(),
                sendAttack: async attackInfo => {
                    sent.push(attackInfo)
                    bot.events.emit("eventStop", { EID: eventID })
                    return { AAM: { UM: { L: { VIS: 0 } }, M: { TA: [0, target.x, target.y], TT: 60, PT: 0 } } }
                },
            },
            "commander.js": { waitForCommanderAvailable: async () => ({ lordID: 1, getEffects: () => ({}) }), freeCommander() {}, useCommander() {} },
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
