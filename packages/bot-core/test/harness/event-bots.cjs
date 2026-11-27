const { EventEmitter } = require("node:events")
const { loadModule, fakeBot } = require("./load.cjs")

const AreaType = { mainCastle: 1, externalKingdom: 12, nomadCamp: 27, samCamp: 29, beriCamp: 30, khanCamp: 35, stormTower: 25, daimyoCastle: 37 }
const KingdomID = { greatEmpire: 0, burningSands: 1, everWinterGlacier: 2, firePeaks: 3, stormIslands: 4, berimond: 10, 0: "Great Empire", 4: "Storm Islands" }

const PLUGINS = {
    attackNomads: { path: "plugins/attack/attackNomads.js", eventID: 72, kingdomID: 0 },
    attackSamurai: { path: "plugins/attack/attackSamurai.js", eventID: 80, kingdomID: 0 },
    attackDaimyo: { path: "plugins/attack/attackDaimyo.js", eventID: 80, kingdomID: 0 },
    attackKhan: { path: "plugins/attack/attackKhan.js", eventID: 72, kingdomID: 0 },
    attackBerimondInvasion: { path: "plugins/attack/attackBerimondInvasion.js", eventID: 85, kingdomID: 0 },
    attackStormForts: { path: "plugins/attack/attackStormForts.js", kingdomID: 4 },
}

const horses = [
    { wodID: 1, costFactorC1: "1", costFactorC2: "0", unitBoost: "10" },
    { wodID: 2, costFactorC1: "1", costFactorC2: "0", unitBoost: "5" },
]

/**
 * Starts an event attack plugin against a stand-in game and lets it send `sends` attacks. The real attack engine builds
 * each frame; the map, the attack queue, the commanders, the skips and the send are stood in. A plugin with an event
 * starts on `eventStart` (with `start` as the event's fields) and the others on `load`.
 *
 * `areas` is the map: `getAreaInfo` answers with the areas inside the rectangle it is asked for, a scan returns them
 * all, and `fnm` returns the first. A skip the plugin asks for is recorded in `skipped` and ends the area's wait.
 * `movements` are the marches already on the map, and `resources` the player's. A skip's reply lands once `skipLands`
 * resolves. `answer(command, params)` may return the game's reply to a frame the plugin sends, as [payload, result].
 *
 * Returns what the plugin did: `sent` (every `cra`, in order), `statuses`, `skipped`, `frames` (every other frame it
 * sent, as [command, params]), `requests` (the map rectangles it asked for) and the stand-ins a test may drive.
 * `openAttackScreen` stands in for the attack screen, which by default hands back the commander unchanged. A skip is refused
 * with `skipRefusal(area)` when that returns an error code, and an attack with `sendRefusal(cra)` when that returns an
 * error name; the names land in `refused`. `found` holds each area `fnm` handed out, and `classTypes` stands in for
 * protocols.js' ClassTypes. `lookAt(x, y, kingdomID)` answers a look at a map spot (`ssi`); by default nothing does.
 */
async function runEvent(plugin, options, {
    areas, inventory, start = {}, items = {}, effects = {}, playerLevel = 70, sends = 1, movements = [], resources = {},
    castle: castleFields = {}, castles: otherCastles = [], spendSkip = () => "MS3", extra = {}, wait = 50, waitToAttack = async job => job(),
    movementEvents = new EventEmitter(), skipLands = async () => {}, answer = () => undefined,
    openAttackScreen = async (castle, areaInfo, kingdomID, commander) => commander, skipRefusal = () => 0, sendRefusal = () => undefined,
    classTypes = {}, lookAt = () => undefined,
}) {
    const { path, eventID, kingdomID } = PLUGINS[plugin]
    const bot = fakeBot()
    const record = bot.sendXT
    bot.sendXT = async (cmd, params) => {
        await record(cmd, params)
        const reply = answer(cmd, JSON.parse(params))
        if (reply)
            setImmediate(() => bot.xtHandler.emit(cmd, ...reply))
    }
    bot.playerInfo.level = playerLevel
    bot.botConfig.plugins[plugin] = options
    const castle = Object.assign(new EventEmitter(), {
        id: 1, kingdomID, areaInfo: { type: kingdomID == 0 ? AreaType.mainCastle : AreaType.externalKingdom, x: 100, y: 100 },
        unlockedHorses: [1, 2], unitInventory: inventory, ...castleFields,
    })
    const skipped = []
    const requests = []
    const found = []
    const protocols = {
        castles: [castle, ...otherCastles], movements, movementEvents, ClassTypes: classTypes, AreaType, KingdomID,
        resources: { pegasusTicket: 5, coins: 0, ...resources },
        KingdomSkipType: { sendResource: 2, sendTroops: 1 },
        unlockInfoList: [{ kingdomID: 4, isUnlocked: true }],
        shopTurn: task => task(),
        lookTurn: task => task(),
        ClientCommands: {
            preSpyInfo: async (...spot) => lookAt(...spot),
            getNextMapObject: async () => (found.push(areas[0]), { areaInfo: areas[0] }),
            getAreaInfo: async (kid, x1, y1, x2, y2) => {
                requests.push([x1, y1, x2, y2])
                return { areaInfo: areas.filter(area => area.x >= x1 && area.x <= x2 && area.y >= y1 && area.y <= y2) }
            },
            skipTarget: async (type, x, y, kid, skip) => {
                skipped.push(skip)
                await skipLands()
                const area = areas.find(area => area.x == x && area.y == y)
                if (skipRefusal(area))
                    return { result: skipRefusal(area) }
                area.extraData[area.type == AreaType.stormTower ? 3 : 2] = 0
                return { result: 0, areaInfo: area }
            },
        },
    }
    // A test that stands in for the pacing also gets the engine's waits, such as the one at the daily cap.
    const engine = loadModule("plugins/attack/attack.js", { bot, items: { horses }, extra: { protocols, ...extra["pacing.js"] && { "pacing.js": extra["pacing.js"] } } }).mod
    const sent = []
    const refused = []
    const statuses = []
    let handedOut = 0
    const attack = {
        ...engine,
        waitToAttack,
        openAttackScreen,
        sendAttack: async (attackInfo, kid, x, y, context = {}) => {
            if (context.dryRun)
                return { dryRun: true }
            const refusal = sendRefusal(attackInfo)
            if (refusal) {
                refused.push(refusal)
                throw refusal
            }
            sent.push(structuredClone(attackInfo))
            if (sent.length >= sends && eventID)
                bot.events.emit("eventStop", { EID: eventID })
            return { AAM: { UM: { L: { VIS: 0 } }, M: { KID: kid, TA: [0, x, y], TT: 60, PT: 0 } } }
        },
    }
    const commander = {
        waitForCommanderAvailable: () => handedOut++ < sends ? Promise.resolve({ lordID: 9, getEffects: () => effects }) : new Promise(() => {}),
        freeCommander() {}, commanderRefused() {},
    }
    const mapScan = { ...loadModule("mapScan.js", { bot }).mod, mapGrid: true, MAX_RADIUS: 100, scanGrid: async () => [...areas], wholeMapRects: () => [], areasAround: async (get, kid, origin, wanted) => areas.filter(wanted) }
    loadModule(path, {
        bot, items: { horses, ...items },
        parentPort: { postMessage: ([, report]) => statuses.push(report), on() {} },
        extra: {
            protocols, "protocols.js": protocols,
            "./attack.js": attack, "./attack": attack,
            "../commander": commander, "../commander.js": commander,
            "mapScan.js": mapScan,
            "../skips.js": { spendSkip },
            "pacing.js": { pause: async () => {}, sleep: async () => {}, boxMullerRandom: () => 0 },
            ...extra,
        },
    })
    bot.events.emit(eventID ? "eventStart" : "load", { EID: eventID, ...start })
    for (let i = 0; i < wait && sent.length < sends; i++)
        await new Promise(resolve => setTimeout(resolve, 1))
    return { cra: sent[0], sent, refused, statuses, skipped, requests, found, frames: bot.sent, bot, castle, protocols, movementEvents }
}

module.exports = { runEvent, AreaType, KingdomID }
