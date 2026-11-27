/**
 * A small stand-in for the game's Berimond kingdom, for plugin tests: it answers the plugin's requests with the
 * replies of the live capture (test/fixtures/protocol/berimond-kingdom.json), moved to the tower asked about, and
 * applies what they change. The real attack engine, protocols and event gate run; the commander pool and the skip
 * budget are stood in. Replies come 5 ms after a request, as from a network.
 */
const { loadModule, fakeBot } = require("./load.cjs")
const fixture = require("../fixtures/protocol/berimond-kingdom.json")
const err = require("../../err.json")

const codeOf = name => Number(Object.keys(err).find(code => err[code] == name))
const CAMP = { id: 55, x: 1296, y: 111 }
const MAIN = 1000001

const items = {
    units: [
        { wodID: 546, type: "BeriArcher", role: "ranged", fightType: "0", foodSupply: "1" },
        { wodID: 507, type: "BeriSpear", role: "melee", fightType: "0", foodSupply: "1" },
        { wodID: 216, type: "BeriAuxiliary", role: "ranged", fightType: "0", isAuxiliary: "1" },
        { wodID: 614, type: "Ladder", toolCategory: "1", typ: "Attack", wallBonus: "10", slotTypes: "1,2" },
        { wodID: 649, type: "Ram", toolCategory: "1", typ: "Attack", gateBonus: "10", slotTypes: "1" },
        { wodID: 651, type: "Mantlet", toolCategory: "1", typ: "Attack", defRangeBonus: "10", slotTypes: "1,2" },
    ],
}

/** A tower record as `ssi`, `aci` and `cra` carry it, from the capture's, at another position and level. */
const towerRecord = (x, y, level = 55) => {
    const record = structuredClone(fixture.ssi_1.reply.payload.gaa.AI[0])
    record[1] = x
    record[2] = y
    record[7] = level
    return record
}

/**
 * The game, the camp, the main castle and the plugin loaded against them. `towers` maps "x:y" to the tower's level,
 * or to "gone" for an empty spot. `refuse(cmd, payload)` may name the error the game answers a request with.
 * `memory` is the plugin memory the runner hands this run.
 */
function berimondGame({ options = {}, towers = { "1409:110": 55, "1420:123": 55 }, camp = [[546, 546], [216, 5], [614, 1000], [649, 1000], [651, 1000]],
    main = [[546, 5000], [507, 5000]], freeSpace = 185, refuse = () => undefined, memory, effects = {} } = {}) {
    const messages = []
    const game = { towers: new Map(Object.entries(towers)), camp: new Map(camp), freeSpace, transfer: undefined, attacks: [] }
    const bot = fakeBot()
    bot.playerInfo.level = 70
    bot.botConfig.plugins = {
        attack: { attackDelaySeconds: "4.5", attackDelayRandomizationSeconds: "2.5", attackLimit: "3500" },
        berimondKingdom: {
            state: true, filename: "plugins/berimondKingdom", eventOnly: 3,
            berimondTower1: "1409:110", berimondTower2: "1420:123",
            armyMode: "autofill", berimondResupplyTroops: [546], berimondResupplyAt: 100, berimondUseSkips: true, dryRun: false,
            ...options,
        },
    }
    if (memory)
        bot.botConfig.pluginMemory = { berimondKingdom: memory }

    const reply = (cmd, payload, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, payload, result), 5)
    const kpi = () => ({ kpi: { ...structuredClone(fixture.kut_1.reply.payload.kpi), UT: game.transfer ? [{ KID: 10, RS: game.transfer.RS, I: game.transfer.I }] : undefined } })
    const inventory = () => [...game.camp].filter(([, n]) => n > 0)

    function answer(cmd, p) {
        const refusal = refuse(cmd, p)
        if (refusal)
            return reply(cmd, {}, codeOf(refusal))
        const key = `${p.TX}:${p.TY}`
        const level = game.towers.get(key)
        switch (cmd) {
            case "ssi":
                if (level === undefined || level == "gone")
                    return reply("ssi", {}, codeOf("INVALID_POSITION"))
                return reply("ssi", { ...fixture.ssi_1.reply.payload, TX: p.TX, TY: p.TY, gaa: { ...fixture.ssi_1.reply.payload.gaa, AI: [towerRecord(p.TX, p.TY, level)] } })
            case "fnt":
                return reply("fnt", fixture.fnt_1.reply.payload)
            case "aci":
                if (level === undefined || level == "gone")
                    return reply("aci", {}, codeOf("INVALID_AREA"))
                return reply("aci", { ...fixture.aci_1.reply.payload, TX: p.TX, TY: p.TY, gaa: { ...fixture.aci_1.reply.payload.gaa, AI: towerRecord(p.TX, p.TY, level) },
                    gui: { ...fixture.aci_1.reply.payload.gui, I: inventory() } })
            case "cra": {
                for (const wave of p.A)
                    for (const side of ["L", "M", "R"])
                        for (const [wod, n] of [...wave[side].U, ...wave[side].T])
                            if (wod > 0)
                                game.camp.set(wod, game.camp.get(wod) - n)
                game.attacks.push(p)
                const answer = structuredClone(fixture.cra_1.reply.payload)
                answer.AAM.M.TA = towerRecord(p.TX, p.TY, level)
                return reply("cra", answer)
            }
            case "fuc":
                return reply("fuc", { FUC: game.freeSpace })
            case "kut":
                game.transfer = { RS: 7200, I: p.A }
                game.freeSpace -= p.A.reduce((sum, [, n]) => sum + n, 0)
                return reply("kut", kpi())
            case "msk":
                game.transfer.RS -= 3600
                if (game.transfer.RS <= 0) {
                    for (const [wod, n] of game.transfer.I)
                        game.camp.set(wod, (game.camp.get(wod) ?? 0) + n)
                    game.transfer = undefined
                }
                return reply("msk", kpi())
            case "pep":
                return reply("pep", { OP: [2446751], OR: [17], EID: 3 })
            case "dcl":
                return reply("dcl", { C: [] })
            default:
                return undefined
        }
    }
    bot.sendXT = async (cmd, params) => {
        const payload = JSON.parse(params)
        bot.sent.push([cmd, payload])
        answer(cmd, payload)
    }

    const pool = { handedOut: [], freed: [], refused: [] }
    const commander = {
        waitForCommanderAvailable: async () => {
            const lord = { lordID: 3, getEffects: () => effects }
            pool.handedOut.push(lord.lordID)
            return lord
        },
        freeCommander: id => pool.freed.push(id),
        commanderRefused: id => pool.refused.push(id),
    }
    const skips = { left: 10 }
    const skipsModule = {
        spendSkip: () => skips.left-- > 0 ? "MS5" : undefined,
        skipRefused: () => false,
        MinuteSkipType: { MS5: 60 },
    }

    const { mod } = loadModule("plugins/berimondKingdom.js", {
        bot, items,
        parentPort: { postMessage: message => messages.push(structuredClone(message)), on() {} },
        extra: { "./commander.js": commander, "./skips.js": skipsModule },
    })
    const protocols = require("../../protocols.js")
    const unitsOf = list => list.map(([wodID, amount]) => ({ unitInfo: items.units.find(u => u.wodID == wodID), amount }))
    protocols.castles.push(
        { id: CAMP.id, kingdomID: 10, name: "Camp", areaInfo: { type: protocols.AreaType.beriCastle, x: CAMP.x, y: CAMP.y }, unitInventory: unitsOf(camp) },
        { id: MAIN, kingdomID: 0, name: "Keep", areaInfo: { type: protocols.AreaType.mainCastle, x: 500, y: 500 }, unitInventory: unitsOf(main) },
    )
    const startEvent = (RS = 86_400) => {
        bot.events.emit("load")
        bot.xtHandler.emit("sei", { E: [{ EID: 3, RS }] }, 0)
    }
    const stopEvent = () => bot.xtHandler.emit("sei", { E: [] }, 0)
    return { bot, game, mod, messages, pool, skips, startEvent, stopEvent, protocols, codeOf }
}

module.exports = { berimondGame, towerRecord, CAMP, MAIN }
