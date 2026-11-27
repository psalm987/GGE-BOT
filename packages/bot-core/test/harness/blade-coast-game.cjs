/**
 * A small stand-in for the game's Blade Coast, for plugin tests: it answers the plugin's requests the way Lazy Lord's
 * capture says the game does (docs/protocol/blade-coast.md) and applies what they change. Every map has one island, a
 * port behind it and a Kraken behind both. A camp starts one storehouse, one tent and one decoration short.
 * Buildings finish at once, trips arrive at once and every attack wins. The rows are hand-made, not the game's.
 */
const { loadModule, fakeBot } = require("./load.cjs")
const { MAPS } = require("../../bladeCoastPlan.js")

const MAP_IDS = [22, 27, 28]
const nodesOf = mid => ({ island: mid * 10 + 1, kraken: mid * 10 + 2, port: mid * 10 + 3 })

const items = {
    units: [
        { wodID: 1, type: "Corsair", name: "Eventunit", role: "melee", fightType: "0", level: "1", recruitmentTime: "60", costC1: "10", kingdomTravellingCost: "10", allowedToTravel: "22+8#27+8#28+8", allowedToAttack: "22+7#27+7#28+7" },
        { wodID: 20, type: "Ladder", name: "Workshop", fightType: "0", slotTypes: "1,2", wallBonus: "10", recruitmentTime: "60", costC1: "10" },
        { wodID: 21, type: "Ram", name: "Workshop", fightType: "0", slotTypes: "1", gateBonus: "10", recruitmentTime: "60", costC1: "10" },
        { wodID: 22, type: "Mantlet", name: "Workshop", fightType: "0", slotTypes: "2", defRangeBonus: "10", recruitmentTime: "60", costC1: "10" },
    ],
    tmaps: MAP_IDS.map(mid => ({ mapID: String(mid), tmapnodeIDs: Object.values(nodesOf(mid)).join("+"), endNodeID: String(nodesOf(mid).kraken) })),
    tmapnodes: MAP_IDS.flatMap(mid => {
        const n = nodesOf(mid)
        return [
            { tmapnodeID: String(n.island), type: "DUNGEON", dungeonType: "main", pos: "1", dungeonlevel: "5" },
            { tmapnodeID: String(n.kraken), type: "BOSSDUNGEON", dungeonType: "main", pos: "2", dungeonlevel: "10", orUnlockIDs: String(n.island), andUnlockIDs: String(n.port) },
            { tmapnodeID: String(n.port), type: "PORT", orUnlockIDs: String(n.island), partPayPriceID: "9" },
        ]
    }),
    prebuiltcastles: [{ preBuiltCastleID: "29", minLevel: "30", costWood: "1000", costStone: "1000", costFood: "1000", costC1: "5000", costC2: "300" }],
    partpayprices: [{ partPayPriceID: "9", wood: "2000", stone: "2000" }],
    buildings: [
        { wodID: 200, name: "Castle", width: "20", height: "20" },
        { wodID: 265, name: "Storage", width: "2", height: "2", costWood: "100", costStone: "100" },
        { wodID: 263, name: "Unittent", level: "1", width: "2", height: "2", costWood: "100" },
        { wodID: 330, name: "Deco", type: "TrainingGround", width: "2", height: "2", costWood: "100" },
        { wodID: 329, name: "Deco", type: "Flag", width: "2", height: "2", costWood: "100" },
    ],
    expansions: [],
}

const EFFECTS = {
    265: camp => { camp.MRW += 7500; camp.MRS += 7500 },
    263: camp => { camp.MU += 10 },
    330: camp => { camp.M += 50 },
    329: camp => { camp.M += 50 },
}

function newCamp(mid) {
    const space = MAPS[mid].space
    return { MU: space - 10, U: 0, M: space - 50, W: 60_000, S: 60_000, F: 60_000, MRW: 3000 + 9 * 7500, MRS: 3000 + 9 * 7500, MRF: 70_500, I: new Map(), won: new Set(), buildings: [], nextOID: 1 }
}

/**
 * The game, its supply castle and the plugin loaded against them. `memory` is the plugin memory the runner hands the
 * run. `answer(cmd, payload)` applies a request, which the dry-run test uses to play the logged requests by hand.
 */
function bladeCoastGame({ options = {}, memory, camps = {}, closed = [] } = {}) {
    const messages = []
    const game = { camps: new Map(Object.entries(camps).map(([mid, camp]) => [Number(mid), { ...newCamp(Number(mid)), ...camp }])), closed: new Set(closed), movementID: 900 }
    const bot = fakeBot()
    bot.playerInfo.level = 60
    bot.botConfig.plugins = {
        bladeCoast: {
            state: true, filename: "plugins/bladeCoast", eventOnly: 4, useSkips: true, shortestRoute: false, coinFloor: 100_000, dryRun: false,
            bladeSetup: { castle: { kingdom: 0, id: -1 }, troop: "Corsair#1", tools: { wall: "Ladder#0", gate: "Ram#0", ranged: "Mantlet#0" } },
            ...options,
        },
    }
    if (memory)
        bot.botConfig.pluginMemory = { bladeCoast: memory }

    const reply = (cmd, obj, result = 0) => Promise.resolve().then(() => bot.xtHandler.emit(cmd, obj, result))
    const entry = mid => {
        const camp = game.camps.get(mid)
        if (!camp || game.closed.has(mid))
            return { MID: mid }
        const n = nodesOf(mid)
        return {
            MID: mid, M: camp.M, I: [...camp.I], UT: { RS: 0 }, RT: { RS: 0 },
            S: { MU: camp.MU, U: camp.U, W: camp.W, S: camp.S, F: camp.F, MRW: camp.MRW, MRS: camp.MRS, MRF: camp.MRF },
            N: Object.values(n).map(NID => ({ NID, A: camp.won.has(NID) ? 1 : 0 })),
        }
    }
    const castle = () => protocols.castles[0]
    const take = (wod, n) => { castle().unitInventory.find(u => u.unitInfo.wodID == wod).amount -= n }

    function answer(cmd, p) {
        const camp = game.camps.get(Number(p.MID ?? p.SID))
        switch (cmd) {
            case "tmp": return reply("tmp", { TM: [entry(p.MID)] })
            case "csc": {
                const next = MAP_IDS.find(mid => !game.camps.has(mid))
                game.camps.set(next, newCamp(next))
                return reply("csc", {})
            }
            case "jea": {
                const BD = camp.buildings.map(b => [b.wod, b.oid, b.x, b.y, 0, 0, 0, 100, 100, 100, 0, 0, 0, 0, 0, 0])
                return reply("jaa", { gca: { BG: [[200, 1, 0, 0, 0]], BD }, grc: { KID: p.MID, W: camp.W, S: camp.S }, gpa: { MRW: camp.MRW } })
            }
            case "ebu": {
                const current = [...game.camps.values()].at(-1)
                current.buildings.push({ wod: p.WID, oid: current.nextOID++, x: p.X, y: p.Y })
                EFFECTS[p.WID](current)
                current.W -= 100
                return reply("ebu", {})
            }
            case "tut":
                for (const [wod, n] of p.I) {
                    take(wod, n)
                    camp.I.set(wod, (camp.I.get(wod) ?? 0) + n)
                    if (wod == 1)
                        camp.U += n
                }
                return reply("tut", {})
            case "tgt":
                for (const [k, n] of p.G)
                    camp[k] += Math.floor(n * 0.75)
                return reply("tgt", {})
            case "ule": {
                const current = [...game.camps.values()].at(-1)
                current.W -= p.W
                current.S -= p.S
                current.won.add(nodesOf([...game.camps.keys()].at(-1)).port)
                return reply("ule", {})
            }
            case "tai": return reply("tai", { CD: 0, gui: { I: [...camp.I] } })
            case "thm":
                camp.won.add(p.NID)
                return reply("thm", { TM: { M: { MID: game.movementID++, TT: 100, PT: 0 } } })
            case "tfm":
                game.closed.add(p.MID)
                return reply("tfm", {})
            case "dcl": case "dfc": return undefined
            default: return reply(cmd, {})
        }
    }
    bot.sendXT = async (cmd, params) => {
        const payload = JSON.parse(params)
        bot.sent.push([cmd, payload])
        answer(cmd, payload)
    }

    const { mod } = loadModule("plugins/bladeCoast.js", { bot, items, parentPort: { postMessage: message => messages.push(structuredClone(message)), on() {} } })
    const protocols = require("../../protocols.js")
    protocols.resources.coins = 1_000_000
    protocols.castles.push({
        id: 1001, kingdomID: 0, name: "Keep", areaInfo: { type: protocols.AreaType.mainCastle }, wood: 1e6, stone: 1e6, food: 1e6,
        getProductionData: { maxAmountWood: 1e6, maxAmountStone: 1e6, maxAmountFood: 1e6 },
        unitInventory: [1, 20, 21, 22].map(wodID => ({ unitInfo: { wodID }, amount: 5000 })),
    })
    const startEvent = async (RS = 86_400) => {
        bot.events.emit("load")
        bot.xtHandler.emit("sei", { E: [{ EID: 4, RS }] }, 0)
    }
    const stopEvent = () => bot.xtHandler.emit("sei", { E: [] }, 0)
    return { bot, game, mod, messages, answer, startEvent, stopEvent, nodesOf, protocols }
}

module.exports = { bladeCoastGame, nodesOf }
