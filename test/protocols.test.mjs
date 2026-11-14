import { createRequire } from "node:module"
import { describe, test, expect } from "vitest"

// test.fails marks a verified bug: the test passes while the bug exists and
// fails once it is fixed, at which point it becomes a plain test.

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

const productionData = { SAFE_F: 111, SAFE_W: 222, SAFE_S: 333, MRF: 1, MRW: 2, MRS: 3 }

describe("castle production data", () => {
    test.fails("known bug: safeWood comes from SAFE_W, not SAFE_F (protocols.js:401)", () => {
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
    test.fails("known bug: a repeated identical request is served from cache (protocols.js:329)", async () => {
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
    test.fails("known bug: dms emits return with the removed Movement (protocols.js:1304)", () => {
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
