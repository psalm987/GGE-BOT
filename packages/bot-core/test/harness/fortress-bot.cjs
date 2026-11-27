const { EventEmitter } = require("node:events")
const { loadModule, fakeBot } = require("./load.cjs")

const FORTRESS = 11, KINGDOM = 1, LORD = 5

/**
 * The real fortress plugin and the real attack.js against a game with fortresses and one commander, which is out until
 * a march frees it. Each fortress is { x, y, wait, level }: `wait` is the cooldown the map shows. The attack screen
 * (`abi`) answers for any fortress, or refuses with `screenRefusal(fortress)` when that returns an error code. `failing`
 * is a command whose first send fails. `items` are game items such as bossdungeons. The commander has `effects` against a
 * fortress, and the castle `troops` melee. Use fake timers.
 *
 * Returns the bot, a `log` of sends and replies, the commander `pool`, the `movements` and `marchHome(i)`, which brings
 * the i-th march home.
 */
function fortressBot({ attackDialog = false, failing, options = {}, items = {}, fortresses = [{ x: 620, y: 590 }], screenRefusal = () => undefined, onCra, effects = {}, troops = 5000 } = {}) {
    const bot = fakeBot()
    bot.playerInfo.level = 70
    bot.botConfig.ggeConfig = { humanize: { attack_dialog: attackDialog } }
    bot.botConfig.plugins.attack = { attackLimit: "", attackDelaySeconds: "20", attackDelayRandomizationSeconds: "15" }
    const movements = []
    const movementEvents = new EventEmitter()
    const pool = { held: false, freed: 0 }
    const log = []
    const map = fortresses.map(({ x, y, wait = 0, level = 0 }) => ({ type: FORTRESS, x, y, extraData: [0, level, wait], timeSinceRequest: 0 }))
    let failed = false
    bot.sendXT = async (cmd, params) => {
        if (cmd == failing && !failed) {
            failed = true
            log.push(`refused ${cmd}`)
            throw "TIMED_OUT"
        }
        const sent = JSON.parse(params)
        log.push(`send ${cmd}`)
        bot.sent.push([cmd, sent, Date.now()])
        if (cmd == "dcl")
            setTimeout(() => bot.xtHandler.emit("dcl", {}, 0), 50)
        if (cmd == "abi") {
            const fortress = map.find(area => area.x == sent.TX && area.y == sent.TY)
            const refusal = screenRefusal(fortress)
            setTimeout(() => refusal
                ? bot.xtHandler.emit("abi", {}, refusal)
                : bot.xtHandler.emit("abi", { gaa: { AI: [FORTRESS, sent.TX, sent.TY, ...fortress.extraData] } }, 0), 50)
        }
        if (cmd != "cra")
            return
        if (pool.held !== true)
            throw new Error("the commander is not held when cra leaves")
        onCra?.(sent)
        setTimeout(() => {
            movements.push({ kingdomID: sent.KID, targetAttack: { x: sent.TX, y: sent.TY, extraData: [1] }, owner: { ownerID: 7 } })
            bot.xtHandler.emit("cra", { AAM: { M: { KID: sent.KID, TA: [0, sent.TX, sent.TY], TT: 60, PT: 0 }, UM: { L: { VIS: 0 } } } }, 0)
        }, 50)
    }
    const protocols = {
        KingdomID: {}, AreaType: { fortress: FORTRESS, externalKingdom: 12 }, resources: { pegasusTicket: 1 },
        ClassTypes: {},
        castles: [{
            kingdomID: KINGDOM, id: 1, areaInfo: { type: 12, x: 600, y: 600 },
            unitInventory: [{ amount: troops, unitInfo: { wodID: 9, fightType: 0, role: "melee", speed: 1 } }],
        }],
        movements, movementEvents,
        ClientCommands: {
            preSpyInfo: async (x, y) => {
                const area = map.find(a => a.x == x && a.y == y)
                if (area)
                    area.timeSinceRequest = Date.now()
                return { areaInfo: area, result: 0 }
            },
            getAreaInfo: async (kingdomID, x1, y1, x2, y2) =>
                ({ areaInfo: map.filter(area => x1 <= area.x && x2 >= area.x && y1 <= area.y && y2 >= area.y) }),
        },
    }
    const { mod: fortressHit } = loadModule("plugins/attack/sharedFortressAttackLogic.js", {
        bot, items,
        extra: {
            "protocols": protocols,
            limiter: { RateLimiter: class { removeTokens = async () => 1; getTokensRemaining = () => 1 } },
            "mapScan.js": { mapGrid: false, areasAround: async (get, kid, origin, wanted, { radius } = {}) => {
                log.push(`scan ${radius}`)
                return (await get(kid, origin.x - radius, origin.y - radius, origin.x + radius, origin.y + radius)).areaInfo.filter(wanted)
            } },
            "../commander": {
                waitForCommanderAvailable: async () => {
                    while (pool.held)
                        await new Promise(resolve => { pool.wake = resolve })
                    pool.held = true
                    return { lordID: LORD, getEffects: type => type == FORTRESS ? effects : {} }
                },
                freeCommander: lordID => { pool.held = false; pool.freed++; pool.wake?.() },
                commanderRefused() {},
            },
        },
    })
    fortressHit(KINGDOM, 60, options, "/plugins/attackFortressesBurningSands.js").catch(error => log.push(`plugin stopped: ${error}`))
    const marchHome = i => {
        const [march] = movements.splice(i, 1)
        movementEvents.emit("return", march)
        pool.held = false
        pool.wake?.()
    }
    return { bot, log, pool, movements, movementEvents, marchHome, map, castle: protocols.castles[0] }
}

module.exports = { fortressBot, FORTRESS, KINGDOM, LORD }
