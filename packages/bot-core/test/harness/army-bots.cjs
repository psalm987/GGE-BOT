const { EventEmitter } = require("node:events")
const { loadModule, fakeBot } = require("./load.cjs")

const BARON = 2, FORTRESS = 11, MAIN = 1, OUTPOST = 12

const unit = (wodID, amount, info) => ({ amount, unitInfo: { wodID, fightType: 0, ...info } })
const melee = (wodID, amount, info) => unit(wodID, amount, { role: "melee", foodSupply: "1", ...info })
const ranged = (wodID, amount, info) => unit(wodID, amount, { role: "ranged", foodSupply: "1", ...info })
const tool = (wodID, amount, info) => unit(wodID, amount, { fightType: undefined, toolCategory: "Basic", typ: "Attack", slotTypes: "1,2,9", ...info })

const horses = [
    { wodID: 1, costFactorC1: "1", costFactorC2: "0", unitBoost: "10" },
    { wodID: 2, costFactorC1: "1", costFactorC2: "0", unitBoost: "5" },
]

/**
 * Runs a shared attack builder through its first attack against a stand-in game and returns the `cra` it built, or
 * undefined when it sent none. The real attack engine builds the frame; the map, the queue and the send are stood in.
 * `start` gets the loaded builder and starts it.
 */
async function firstCra(relPath, start, { kingdomID = 0, inventory, area, effects = {}, playerLevel = 70, skips = {}, resources = {} }) {
    const bot = fakeBot()
    bot.playerInfo.level = playerLevel
    bot.botConfig.plugins.skips = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true, ...skips }
    const allResources = { pegasusTicket: 5, coins: 0, ...resources }
    const castle = { id: 1, kingdomID, areaInfo: { type: kingdomID == 0 ? MAIN : OUTPOST, x: 100, y: 100 }, unlockedHorses: [1, 2], unitInventory: inventory }
    const protocols = {
        castles: [castle], movements: [], movementEvents: new EventEmitter(), resources: allResources, ClassTypes: {},
        AreaType: { barron: BARON, fortress: FORTRESS, mainCastle: MAIN, externalKingdom: OUTPOST },
        KingdomID: { greatEmpire: 0, burningSands: 1, everWinterGlacier: 2, firePeaks: 3, 0: "greatEmpire", 1: "burningSands", 2: "everWinterGlacier", 3: "firePeaks" },
        ClientCommands: {
            preSpyInfo: async () => {},
            skipTarget: async (...args) => { skipped.push(args.at(-1)); area.extraData[2] = 0; return { result: 0 } },
        },
    }
    const skipped = []
    const engine = loadModule("plugins/attack/attack.js", { bot, items: { horses }, extra: { protocols } }).mod
    const sent = []
    const statuses = []
    let handedOut = 0
    const attack = {
        ...engine,
        waitToAttack: job => job(),
        sendAttack: async attackInfo => {
            sent.push(structuredClone(attackInfo))
            return { AAM: { UM: { L: { VIS: 0 } }, M: { KID: kingdomID, TA: [0, area.x, area.y], TT: 60, PT: 0 } } }
        },
    }
    const { mod } = loadModule(relPath, {
        bot, items: { horses },
        parentPort: { postMessage: ([, report]) => statuses.push(report), on() {} },
        extra: {
            protocols, "protocols.js": protocols,
            "./attack.js": attack, "./attack": attack,
            "../commander": {
                waitForCommanderAvailable: () => handedOut++ ? new Promise(() => {}) : Promise.resolve({ lordID: 9, getEffects: () => effects }),
                freeCommander() {}, useCommander() {},
            },
            "mapScan.js": { mapGrid: true, scanGrid: async () => [area], wholeMapRects: () => [], areasAround: async () => [area] },
        },
    })
    const stopped = []
    Promise.resolve(start(mod)).catch(error => stopped.push(error))
    for (let i = 0; i < 50 && sent.length == 0 && stopped.length == 0; i++)
        await new Promise(resolve => setTimeout(resolve, 1))
    return { cra: sent[0], skipped, statuses, stopped, castle }
}

const barons = (options, game) => firstCra("plugins/attack/sharedBarronAttackLogic.js",
    hit => hit(BARON, game.kingdomID ?? 0, options, 81, "/plugins/attackBarronsGreatEmpire.js"), { area: { type: BARON, x: 110, y: 105, extraData: [0, 400, 0], timeSinceRequest: 0 }, ...game })

const fortress = (options, game) => firstCra("plugins/attack/sharedFortressAttackLogic.js",
    hit => hit(game.kingdomID ?? 1, game.level ?? 60, options, "/plugins/attackFortressesBurningSands.js"), { kingdomID: 1, area: { type: FORTRESS, x: 120, y: 90, extraData: [0, 0, 0], timeSinceRequest: 0 }, ...game })

module.exports = { firstCra, barons, fortress, unit, melee, ranged, tool, BARON, FORTRESS }
