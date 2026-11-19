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
            "mapScan.js": { mapGrid: true, MAX_RADIUS: 100, scanGrid: async () => [area], wholeMapRects: () => [], areasAround: async () => [area] },
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

const TOWER_PLUGINS = ["attackBarronsGreatEmpire", "attackBarronsBurningSands", "attackBarronsEverWinterGlacier", "attackBarronsFirePeaks"]
const TOP_LEVELS = [81, 61, 51, 71]

/** A tower on the stand-in map: `victories` set its level, and `wait` is the seconds before it can be attacked. */
const tower = (x, y, { victories = 0, wait = 0 } = {}) => ({ type: BARON, x, y, extraData: [0, victories, wait] })
/** One of the player's castles on the stand-in map. */
const castleAt = (kingdomID, id, x, y, { type = MAIN, name, inventory = [] } = {}) =>
    ({ id, kingdomID, areaInfo: { type, x, y, extraData: Object.assign([], { 7: name }) }, unlockedHorses: [1, 2], unitInventory: inventory })

/**
 * Starts a kingdom's tower plugin against a stand-in game and lets it run: a map of towers the real scan reads through
 * `getAreaInfo`, the player's castles, and marches that come home. The real attack engine builds each frame; the
 * attack queue and the send are stood in. Nothing here waits, so a test moves the clock itself (fake timers) and
 * reads what the plugin did from what this returns:
 * - `sent`: the `cra` of every attack, in order.
 * - `statuses`: every status the plugin reported.
 * - `requests`: every map rectangle it asked for, as [x1, y1, x2, y2].
 * - `map`: the towers, which a test may add to.
 *
 * A march takes `travelSeconds` each way. When it reaches home the tower has one more victory and waits `cooldown`
 * seconds, and the commander is free again. `commanders` is how many the player has. While `scanFails()` is true the
 * game leaves a map request unanswered, and `sendResult(cra)` may return an error name for the game to refuse a send with.
 */
function startTowers(options, {
    kingdomID = 0, castles, map = [], mapGrid = false, commanders = 1, travelSeconds = 60, cooldown = 3600, effects = {}, playerLevel = 70,
    resources = {}, horses: stable = horses, logLines = [], sendResult = () => undefined, scanFails = () => false,
}) {
    const bot = fakeBot()
    bot.playerInfo.level = playerLevel
    bot.botConfig.ggeConfig = { humanize: { map_grid: mapGrid } }
    bot.botConfig.plugins.skips = {}
    bot.botConfig.plugins.attack = { attackLimit: "3500", ...options.attack }
    const movementEvents = new EventEmitter()
    const requests = []
    const protocols = {
        castles, movements: [], movementEvents, resources: { pegasusTicket: 5, coins: 0, ...resources }, ClassTypes: {},
        AreaType: { barron: BARON, fortress: FORTRESS, mainCastle: MAIN, externalKingdom: OUTPOST },
        KingdomID: { greatEmpire: 0, burningSands: 1, everWinterGlacier: 2, firePeaks: 3, 0: "greatEmpire", 1: "burningSands", 2: "everWinterGlacier", 3: "firePeaks" },
        ClientCommands: {
            preSpyInfo: async () => {},
            skipTarget: async () => ({ result: 1 }),
            getAreaInfo: async (kid, x1, y1, x2, y2) => {
                requests.push([x1, y1, x2, y2])
                if (scanFails())
                    throw "TIMED_OUT"
                return { areaInfo: map.filter(area => area.x >= x1 && area.x <= x2 && area.y >= y1 && area.y <= y2).map(area => ({ ...area, extraData: [...area.extraData], timeSinceRequest: Date.now() })) }
            },
        },
    }
    const engine = loadModule("plugins/attack/attack.js", { bot, items: { horses: stable }, extra: { protocols } }).mod
    const sent = []
    const statuses = []
    const free = Array.from({ length: commanders }, (_, i) => ({ lordID: i + 1, lordPosition: i, getEffects: () => effects }))
    const waiting = []
    const freeCommander = lordID => {
        const lord = { lordID, lordPosition: lordID - 1, getEffects: () => effects }
        if (waiting.length) waiting.shift()(lord)
        else if (!free.some(other => other.lordID == lordID)) free.push(lord)
    }
    const attack = {
        ...engine,
        waitToAttack: job => job(),
        sendAttack: async (attackInfo, kid, x, y) => {
            const refused = sendResult(attackInfo)
            if (refused)
                throw refused
            sent.push(structuredClone(attackInfo))
            const target = map.find(area => area.x == x && area.y == y)
            const source = castles.find(castle => castle.areaInfo.x == attackInfo.SX && castle.areaInfo.y == attackInfo.SY)
            const march = { kingdomID: kid, lord: { lordID: attackInfo.LID }, targetOwner: { ownerID: -1 }, targetAttack: { type: BARON, x, y, extraData: [] }, sourceAttack: { type: MAIN } }
            protocols.movements.push(march)
            setTimeout(() => {
                target.extraData = [0, target.extraData[1] + 1, cooldown]
                const home = {
                    kingdomID: kid, lord: march.lord, targetOwner: { ownerID: bot.playerInfo.playerID },
                    targetAttack: { type: source.areaInfo.type, x: source.areaInfo.x, y: source.areaInfo.y, extraData: [source.id] },
                    sourceAttack: { type: BARON, x, y, extraData: [...target.extraData], timeSinceRequest: Date.now() },
                }
                protocols.movements.splice(protocols.movements.indexOf(march), 1, home)
                movementEvents.emit("returning", home)
                setTimeout(() => {
                    protocols.movements.splice(protocols.movements.indexOf(home), 1)
                    freeCommander(attackInfo.LID)
                    movementEvents.emit("return", home)
                }, travelSeconds * 1000)
            }, travelSeconds * 1000)
            return { AAM: { UM: { L: { VIS: 0 } }, M: { KID: kid, TA: [0, x, y], TT: travelSeconds, PT: 0 } } }
        },
    }
    const file = `/plugins/${TOWER_PLUGINS[kingdomID]}.js`
    const { mod } = loadModule("plugins/attack/sharedBarronAttackLogic.js", {
        bot, items: { horses: stable },
        parentPort: { postMessage: ([, report]) => statuses.push(report), on() {} },
        extra: {
            protocols, "protocols.js": protocols,
            "./attack.js": attack, "./attack": attack,
            "../commander": {
                waitForCommanderAvailable: () => free.length ? Promise.resolve(free.shift()) : new Promise(resolve => waiting.push(resolve)),
                freeCommander, useCommander() {},
            },
            "../skips.js": { spendSkip() {}, haveEnoughSkips: () => false },
            "attackLog.js": { recentAttacks: () => logLines },
        },
    })
    const stopped = []
    Promise.resolve(mod(BARON, kingdomID, options, TOP_LEVELS[kingdomID], file)).catch(error => stopped.push(error))
    return { sent, statuses, requests, map, stopped, protocols, bot }
}

module.exports = { firstCra, barons, fortress, startTowers, tower, castleAt, unit, melee, ranged, tool, BARON, FORTRESS }
