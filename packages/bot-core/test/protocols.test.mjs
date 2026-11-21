import { createRequire } from "node:module"
import { describe, test, expect } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

const productionData = { SAFE_F: 111, SAFE_W: 222, SAFE_S: 333, MRF: 1, MRW: 2, MRS: 3 }

describe("castle production data", () => {
    test("safeWood comes from SAFE_W, not SAFE_F (protocols.js:401)", () => {
        const { mod, bot } = loadModule("protocols.js")
        bot.xtHandler.emit("dcl", { C: [{ KID: 0, AI: [{ AID: 1, gpa: productionData }] }] }, 0)

        const data = mod.castles[0].getProductionData
        expect(data.safeFood).toBe(111)
        expect(data.safeStone).toBe(333)
        expect(data.safeWood).toBe(222)
    })
})

function answerGaa(bot) {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            const index = bot.sent.findIndex(([cmd]) => cmd === "gaa")
            if (index === -1)
                return
            const [, req] = bot.sent.splice(index, 1)[0]
            bot.xtHandler.emit("gaa", { KID: req.KID, AI: [[0, req.AX1, req.AY1]] }, 0)
            clearInterval(timer)
            resolve(req)
        }, 1)
    })
}

describe("getAreaInfo cache", () => {
    test("a repeated identical request is served from cache (protocols.js:329)", async () => {
        const { mod, bot } = loadModule("protocols.js")
        const getAreaInfo = mod.ClientCommands.getAreaInfo

        await Promise.all([getAreaInfo(1, 0, 0, 12, 12), answerGaa(bot)])
        const second = await Promise.race([
            getAreaInfo(1, 0, 0, 12, 12).then(() => "cached"),
            new Promise(resolve => setTimeout(() => resolve("sent again"), 300)),
        ])

        expect(second).toBe("cached")
    })

    test("boxes that share a corner are not served each other's result (protocols.js:289)", async () => {
        const { mod, bot } = loadModule("protocols.js")
        const getAreaInfo = mod.ClientCommands.getAreaInfo

        const [, first] = await Promise.all([getAreaInfo(1, 0, 0, 12, 12), answerGaa(bot)])
        const [, second] = await Promise.all([getAreaInfo(1, 0, 0, 24, 24), answerGaa(bot)])

        expect(first.AX2).toBe(12)
        expect(second.AX2).toBe(24)
    })
})

describe("movement removal", () => {
    test("dms emits return with the removed Movement (protocols.js:1304)", () => {
        const { mod, bot } = loadModule("protocols.js")
        bot.xtHandler.emit("gam", { M: [{ M: { MID: 42, T: 0, KID: 0, OID: 99, TID: 99, SID: 99, TT: 60, PT: 30, TA: [], SA: [] } }], O: [] }, 0)
        expect(mod.movements.map(m => m.id)).toContain(42)

        const returned = []
        mod.movementEvents.prependListener("return", m => returned.push(m))
        bot.xtHandler.emit("dms", { MID: [42] }, 0)

        expect(returned).toHaveLength(1)
        expect(returned[0].id).toBe(42)
        expect(mod.movements.map(m => m.id)).not.toContain(42)
    })
})

describe("movement armies", () => {
    const units = [{ wodID: 10, role: "ranged" }, { wodID: 11, role: "melee" }, { wodID: 611 }]
    const march = army => ({ M: { MID: 7, T: 0, KID: 0, OID: 99, TID: 98, SID: 99, TT: 60, PT: 30, TA: [], SA: [] }, ...army })
    const waves = movement => [movement.left, movement.middle, movement.right, movement.courtyard]
        .map(wave => wave.map(unit => [unit.unitInfo.wodID, unit.amount]))

    test("an army sent as FA, with no GA, is read and counts as visible", () => {
        const { mod, bot } = loadModule("protocols.js", { items: { units } })
        bot.xtHandler.emit("gam", { M: [march({ FA: { L: [[10, 5]], M: [[611, 2], [11, 8]], R: [[10, 3]], RW: [[11, 4]] } })], O: [] }, 0)

        const [movement] = mod.movements
        expect(waves(movement)).toEqual([[[10, 5]], [[611, 2], [11, 8]], [[10, 3]], [[11, 4]]])
        expect(movement.canSeeArmy).toBe(true)
    })

    test("an army sent as GA is read as before, and a movement with neither has no visible army", () => {
        const { mod, bot } = loadModule("protocols.js", { items: { units } })
        bot.xtHandler.emit("gam", { M: [march({ GA: { L: [[10, 5]], M: [], R: [], RW: [] } }), { ...march(), M: { ...march().M, MID: 8 } }], O: [] }, 0)

        const [seen, unseen] = mod.movements
        expect(waves(seen)).toEqual([[[10, 5]], [], [], []])
        expect(seen.canSeeArmy).toBe(true)
        expect(waves(unseen)).toEqual([[], [], [], []])
        expect(unseen.canSeeArmy).toBe(false)
    })
})

describe("alliance lookup by name", () => {
    test("finds the alliance through the highscore and returns its info", async () => {
        const bot = fakeBot()
        bot.sendXT = async (cmd, params) => {
            const p = JSON.parse(params)
            bot.sent.push([cmd, p])
            setImmediate(() => {
                if (cmd == "hgh")
                    bot.xtHandler.emit("hgh", { LT: 11, SV: p.SV, L: [[1, 0, [12, "Wolves"]], [2, 0, [77, "Lambs"]]] }, 0)
                if (cmd == "ain")
                    bot.xtHandler.emit("ain", { A: { AID: p.AID, M: [{ OID: 5, N: "Ada", AID: p.AID }], MP: 0 } }, 0)
            })
        }
        const { mod } = loadModule("protocols.js", { bot })

        const alliance = await mod.ClientCommands.getAllianceByName("lambs")

        expect(bot.sent).toEqual([["hgh", { LT: 11, SV: "lambs" }], ["ain", { AID: 77 }]])
        expect(alliance.allianceID).toBe(77)
        expect(alliance.members.map(m => m.name)).toEqual(["Ada"])
    })
})

describe("finding the next map object", () => {
    const fixture = name => require(`./fixtures/protocol/${name}.json`).find_target_fnm.payload

    test("asks for invader camps with the owner id it is given, and resolves with the camp", async () => {
        const { mod, bot } = loadModule("protocols.js")
        const camp = mod.ClientCommands.getNextMapObject(34, 0, -701)
        await new Promise(resolve => setImmediate(resolve))
        bot.xtHandler.emit("fnm", { gaa: { KID: 0, AI: [[34, 500, 600, 40]], OI: [] } }, 0)

        expect(bot.sent).toEqual([["fnm", fixture("bloodcrow")]])
        expect(await camp).toMatchObject({ result: 0, areaInfo: { type: 34, x: 500, y: 600 } })
    })

    test("asks for alliance nomad camps when no owner id is given", () => {
        const { mod, bot } = loadModule("protocols.js")
        mod.ClientCommands.getNextMapObject(35, 0)

        expect(bot.sent).toEqual([["fnm", { T: 35, KID: 0, LMIN: -1, LMAX: -1, NID: -801 }]])
    })
})

describe("skipping a camp's wait", () => {
    const sentTwice = async bot => {
        while (bot.sent.length < 2)
            await new Promise(resolve => setImmediate(resolve))
    }
    const samuraiRun = require("./fixtures/protocol/samurai-20261120.json")
    const captured = require("./fixtures/protocol/samurai-20261121.json")
    /** The captured fnm row of the camp at 641:607, with its wait over as an msd reply would carry it. */
    const otherCamp = captured.fnm_1.reply.payload.gaa.AI[0].toSpliced(5, 1, 0)

    test("each skip takes the reply about its own camp, not another Samurai camp's", async () => {
        const { mod, bot } = loadModule("protocols.js")
        const here = mod.ClientCommands.skipTarget(29, 694, 525, 0, "MS5")
        const there = mod.ClientCommands.skipTarget(29, 641, 607, 0, "MS5")
        await new Promise(resolve => setImmediate(resolve))
        expect(bot.sent[0]).toEqual(["msd", samuraiRun.msd_1.payload])

        bot.xtHandler.emit("msd", { AI: otherCamp }, 0)
        bot.xtHandler.emit("msd", samuraiRun.msd_reply.reply.payload, 0)
        expect(await here).toMatchObject({ result: 0, areaInfo: { type: 29, x: 694, y: 525 } })

        await sentTwice(bot)
        bot.xtHandler.emit("msd", { AI: otherCamp }, 0)
        expect(await there).toMatchObject({ result: 0, areaInfo: { type: 29, x: 641, y: 607 } })
    })

    test("an error reply settles only the skip it answers, and the next skip is sent after it", async () => {
        const { mod, bot } = loadModule("protocols.js")
        const here = mod.ClientCommands.skipTarget(29, 694, 525, 0, "MS5")
        const there = mod.ClientCommands.skipTarget(29, 641, 607, 0, "MS5")
        await new Promise(resolve => setImmediate(resolve))
        expect(bot.sent.map(([command]) => command)).toEqual(["msd"])

        // No refusal is captured, so this one names no camp; 437 stands in for any error code.
        bot.xtHandler.emit("msd", {}, 437)
        expect(await here).toEqual({ result: 437 })

        await sentTwice(bot)
        expect(bot.sent[1]).toEqual(["msd", { X: 641, Y: 607, MID: -1, NID: -1, MST: "MS5", KID: "0" }])
        bot.xtHandler.emit("msd", { AI: otherCamp }, 0)
        expect(await there).toMatchObject({ result: 0, areaInfo: { type: 29, x: 641, y: 607 } })
    })

    test("a skip whose reply never comes does not hold up the next one", async () => {
        const bot = fakeBot()
        const waitForResult = bot.waitForResult
        let waits = 0
        bot.waitForResult = (...args) => waits++ == 0 ? Promise.reject("TIMED_OUT") : waitForResult(...args)
        const { mod } = loadModule("protocols.js", { bot })
        const here = mod.ClientCommands.skipTarget(29, 694, 525, 0, "MS5")
        const there = mod.ClientCommands.skipTarget(29, 641, 607, 0, "MS5")
        await expect(here).rejects.toBe("TIMED_OUT")

        await sentTwice(bot)
        bot.xtHandler.emit("msd", { AI: otherCamp }, 0)
        expect(await there).toMatchObject({ result: 0, areaInfo: { type: 29, x: 641, y: 607 } })
    })
})
