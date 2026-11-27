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
 * The real commander pool with `count` commanders at positions 1 to `count` (lord ids 101 on), each with `effects`. A
 * "return" on `movementEvents` that comes home to the player frees its commander, as in the game.
 */
function commanderPool(bot, movementEvents, count, effects) {
    class Lord { constructor(e) { this.lordID = e.ID; this.lordPosition = e.VIS } getEffects() { return effects } }
    const { mod } = loadModule("plugins/commander.js", { bot, extra: { "protocols.js": { ClassTypes: { Lord }, movementEvents } } })
    bot.xtHandler.emit("gli", { C: Array.from({ length: count }, (_, i) => ({ ID: 101 + i, VIS: i })) }, 0)
    return mod
}

/**
 * Runs a shared attack builder through its first attack against a stand-in game and returns the `cra` it built, or
 * undefined when it sent none. The real attack engine builds the frame; the map, the queue and the send are stood in.
 * `start` gets the loaded builder and starts it. `presets` is the game's `gas` reply. `movements` are the marches on the map, and a skip's reply lands once
 * `skipLands` resolves. `castles` are the player's castles beside the kingdom's main one (id 1 at 100:100), and `scans` in
 * the result holds the tile each map scan centred on. With `commanders` set, the real commander pool hands out that many commanders; without it, one
 * stand-in commander (lord id 9) goes out once. `extra` stands in for more modules, for the engine and the builder alike.
 */
async function firstCra(relPath, start, {
    kingdomID = 0, inventory, area, effects = {}, playerLevel = 70, skips = {}, resources = {},
    movements = [], movementEvents = new EventEmitter(), waitToAttack = job => job(), skipLands = async () => {}, commanders,
    presets = { S: [] }, castles = [], extra = {}, openAttackScreen = async (castle, areaInfo, kingdomID, commander) => commander,
}) {
    const bot = fakeBot()
    // The game lists the player's in-game presets (`gas`) as `presets`.
    const record = bot.sendXT
    bot.sendXT = async (command, params) => {
        await record(command, params)
        if (command == "gas")
            setImmediate(() => bot.xtHandler.emit("gas", presets, 0))
    }
    bot.playerInfo.level = playerLevel
    bot.botConfig.plugins.skips = { "1Minute": true, "5Minute": true, "10Minute": true, "30Minute": true, "1Hour": true, "5Hour": true, "24Hour": true, ...skips }
    const allResources = { pegasusTicket: 5, coins: 0, ...resources }
    const castle = { id: 1, kingdomID, areaInfo: { type: kingdomID == 0 ? MAIN : OUTPOST, x: 100, y: 100 }, unlockedHorses: [1, 2], unitInventory: inventory }
    const protocols = {
        castles: [castle, ...castles], movements, movementEvents, resources: allResources, ClassTypes: {},
        AreaType: { barron: BARON, fortress: FORTRESS, mainCastle: MAIN, externalKingdom: OUTPOST },
        KingdomID: { greatEmpire: 0, burningSands: 1, everWinterGlacier: 2, firePeaks: 3, 0: "greatEmpire", 1: "burningSands", 2: "everWinterGlacier", 3: "firePeaks" },
        ClientCommands: {
            preSpyInfo: async () => {},
            skipTarget: async (...args) => { skipped.push(args.at(-1)); await skipLands(); area.extraData[2] = 0; return { result: 0 } },
        },
    }
    const skipped = []
    const scans = []
    const engine = loadModule("plugins/attack/attack.js", { bot, items: { horses }, extra: { protocols, ...extra } }).mod
    const sent = []
    const statuses = []
    let handedOut = 0
    const attack = {
        ...engine,
        waitToAttack,
        openAttackScreen,
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
            "../commander": commanders ? commanderPool(bot, movementEvents, commanders, effects) : {
                waitForCommanderAvailable: () => handedOut++ ? new Promise(() => {}) : Promise.resolve({ lordID: 9, getEffects: () => effects }),
                freeCommander() {}, commanderRefused() {},
            },
            "mapScan.js": { mapGrid: true, MAX_RADIUS: 100, scanGrid: async (get, kid, origin) => (scans.push([origin.x, origin.y]), [area]), wholeMapRects: () => [], areasAround: async (get, kid, origin) => (scans.push([origin.x, origin.y]), [area]) },
            ...extra,
        },
    })
    const stopped = []
    Promise.resolve(start(mod)).catch(error => stopped.push(error))
    for (let i = 0; i < 50 && sent.length == 0 && stopped.length == 0; i++)
        await new Promise(resolve => setTimeout(resolve, 1))
    return { cra: sent[0], skipped, statuses, stopped, castle, scans }
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
 * A stand-in commander pool of `count` commanders (lord ids 1 on), first come first served. Kingdoms given the same
 * pool share its commanders and may send each of them; `freeCommander` hands one to the longest waiter.
 */
function standInCommanders(count, effects = {}) {
    const lords = Array.from({ length: count }, (_, i) => ({ lordID: i + 1, lordPosition: i, getEffects: () => effects }))
    const free = [...lords]
    const waiting = []
    return {
        waitForCommanderAvailable: () => free.length ? Promise.resolve(free.shift()) : new Promise(resolve => waiting.push(resolve)),
        freeCommander(lordID) {
            const lord = lords.find(lord => lord.lordID == lordID)
            if (waiting.length) waiting.shift()(lord)
            else if (!free.includes(lord)) free.push(lord)
        },
        commanderRefused() {},
        mayUse: (whitelist, plugin, lord) => lords.includes(lord),
        freeCommanderCount: () => free.length,
    }
}

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
 * seconds, and the commander is free again. `commanders` is how many the player has; with `pool` the real commander
 * pool hands them out (lord ids 101 on), as the plugin's commander list asks. While `scanFails()` is true the
 * game leaves a map request unanswered, and `sendResult(cra)` may return an error name for the game to refuse a send with.
 * `screenRefusal(area)` refuses the attack screen on a tower, and `looks` and `screens` hold each tower looked at with
 * `ssi` and each attack screen opened. `armourer` stands in for the armourer: `{ units, packages, live }` are the game items and the package ids on offer, and
 * the coins come from `resources.coins`. Every `sbp` is kept in `orders` and delivers its tools to the castle the bot joined for it,
 * which `joins` lists by id. `history` is the kingdom's attacks of the last 24 hours as the runner hands them to a starting bot, and
 * `attackOptions` are the account's attack settings. Kingdoms started with the same `coordinator` (a createBaronCoordinator())
 * and the same `sharedCommanders` (a standInCommanders()) run as one account's kingdoms do.
 */
function startTowers(options, {
    kingdomID = 0, castles, map = [], mapGrid = false, commanders = 1, attackOptions = {}, travelSeconds = 60, cooldown = 3600, effects = {}, playerLevel = 70,
    resources = {}, horses: stable = horses, history, sendResult = () => undefined, scanFails = () => false, armourer, pool = false,
    screenRefusal = () => false, coordinator, sharedCommanders,
}) {
    const bot = fakeBot()
    bot.playerInfo.level = playerLevel
    bot.botConfig.ggeConfig = { humanize: { map_grid: mapGrid } }
    bot.botConfig.plugins.skips = {}
    bot.botConfig.plugins.attack = { attackLimit: "3500", ...attackOptions }
    if (history)
        bot.botConfig.attackHistory = { [TOWER_PLUGINS[kingdomID]]: history }
    const movementEvents = new EventEmitter()
    const requests = []
    const looks = []
    const screens = []
    const startedAt = Date.now()
    const orders = []
    const joins = []
    const protocols = {
        castles, movements: [], movementEvents, resources: { pegasusTicket: 5, coins: 0, ...resources }, ClassTypes: {},
        AreaType: { barron: BARON, fortress: FORTRESS, mainCastle: MAIN, externalKingdom: OUTPOST },
        KingdomID: { greatEmpire: 0, burningSands: 1, everWinterGlacier: 2, firePeaks: 3, 0: "greatEmpire", 1: "burningSands", 2: "everWinterGlacier", 3: "firePeaks" },
        ClientCommands: {
            preSpyInfo: async (x, y) => {
                looks.push([x, y])
                const area = map.find(area => area.x == x && area.y == y)
                if (!area)
                    return { result: 0 }
                // The wait a look shows runs down from when the tower's wait was last set.
                const left = Math.max(0, area.extraData[2] - Math.floor((Date.now() - (area.waitSince ?? startedAt)) / 1000))
                return { areaInfo: { ...area, extraData: [area.extraData[0], area.extraData[1], left], timeSinceRequest: Date.now() }, result: 0 }
            },
            skipTarget: async () => ({ result: 1 }),
            getAreaInfo: async (kid, x1, y1, x2, y2) => {
                requests.push([x1, y1, x2, y2])
                if (scanFails())
                    throw "TIMED_OUT"
                return { areaInfo: map.filter(area => area.x >= x1 && area.x <= x2 && area.y >= y1 && area.y <= y2).map(area => ({ ...area, extraData: [...area.extraData], timeSinceRequest: Date.now() })) }
            },
        },
    }
    if (armourer) {
        protocols.activeEvent = () => ({ PIDS: armourer.live })
        let inside
        protocols.setCastle = (castle, callback) => { joins.push(castle.id); inside = castle; return callback() }
        protocols.shopTurn = task => task()
        bot.sendXT = async (command, params) => {
            const order = JSON.parse(params)
            if (command == "sbp") {
                orders.push(order)
                const pack = armourer.packages.find(pack => Number(pack.packageID) == order.PID)
                const held = inside.unitInventory.find(unit => unit.unitInfo.wodID == Number(pack.unitID))
                if (held)
                    held.amount += order.AMT * Number(pack.unitAmount)
                protocols.resources.coins -= order.AMT * Number(pack.packagePriceC1)
            }
            setTimeout(() => bot.xtHandler.emit(command, command == "sbp" ? { gcu: { C1: protocols.resources.coins } } : {}, 0), 1)
        }
    }
    const items = { horses: stable, units: armourer?.units, packages: armourer?.packages }
    const engine = loadModule("plugins/attack/attack.js", { bot, items: { horses: stable }, extra: { protocols } }).mod
    const sent = []
    const statuses = []
    const standIn = sharedCommanders ?? standInCommanders(commanders, effects)
    const attack = {
        ...engine,
        waitToAttack: job => job(),
        openAttackScreen: async (castle, areaInfo, kid, commander) => {
            screens.push([areaInfo.x, areaInfo.y])
            if (screenRefusal(areaInfo))
                throw "ATTACK_SCREEN_REFUSED"
            return commander
        },
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
                target.waitSince = Date.now()
                const home = {
                    kingdomID: kid, lord: march.lord, targetOwner: { ownerID: bot.playerInfo.playerID },
                    targetAttack: { type: source.areaInfo.type, x: source.areaInfo.x, y: source.areaInfo.y, extraData: [source.id] },
                    sourceAttack: { type: BARON, x, y, extraData: [...target.extraData], timeSinceRequest: Date.now() },
                }
                protocols.movements.splice(protocols.movements.indexOf(march), 1, home)
                movementEvents.emit("returning", home)
                setTimeout(() => {
                    protocols.movements.splice(protocols.movements.indexOf(home), 1)
                    standIn.freeCommander(attackInfo.LID)
                    movementEvents.emit("return", home)
                }, travelSeconds * 1000)
            }, travelSeconds * 1000)
            return { AAM: { UM: { L: { VIS: 0 } }, M: { KID: kid, TA: [0, x, y], TT: travelSeconds, PT: 0 } } }
        },
    }
    const file = `/plugins/${TOWER_PLUGINS[kingdomID]}.js`
    const { mod } = loadModule("plugins/attack/sharedBarronAttackLogic.js", {
        bot, items,
        parentPort: { postMessage: ([, report]) => statuses.push(report), on() {} },
        extra: {
            protocols, "protocols.js": protocols,
            "./attack.js": attack, "./attack": attack,
            "../commander": pool ? commanderPool(bot, movementEvents, commanders, effects) : standIn,
            "../skips.js": { spendSkip() {}, haveEnoughSkips: () => false },
            ...coordinator && { "baronCoordinator.js": { baronCoordinator: coordinator } },
        },
    })
    const stopped = []
    const logged = []
    const info = console.info
    // The plugin's attack lines, as the runner would store them, for a test to feed back as a restart's history.
    console.info = (...parts) => { logged.push(["[12:00] ", "[", "sharedBarronAttackLogic", "] ", ...parts]); info(...parts) }
    Promise.resolve(mod(BARON, kingdomID, options, TOP_LEVELS[kingdomID], file)).catch(error => stopped.push(error))
    return { sent, statuses, requests, looks, screens, map, stopped, protocols, bot, logged, orders, joins }
}

module.exports = { firstCra, barons, fortress, startTowers, standInCommanders, tower, castleAt, unit, melee, ranged, tool, BARON, FORTRESS }
