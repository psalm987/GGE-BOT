import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const capture = require("./fixtures/protocol/khan-20261122.json")
const stand = { movementEvents: new EventEmitter() }
const { learnTarget, refillPlan } = loadModule("khanDefence.js", { extra: { "protocols.js": stand } }).mod

const used = capture.dfc_1.reply.payload
const stockOf = layout => new Map(layout.gui.I)
const { L, M, R } = capture.dfw_12.payload
const full = {
    ...structuredClone(used),
    dfw: { ...used.dfw, L, M, R },
    dfm: { ...used.dfm, ...Object.fromEntries(["LS", "MS", "RS"].map(side => [side, capture.dfm_3.payload[side]])) },
}

describe("the layout a defence is refilled to", () => {
    test("the first layout read is the target", () => {
        expect(learnTarget(undefined, full)).toEqual(full)
    })
    test("a slot a defence used up keeps its target, and an empty slot does too", () => {
        const emptied = structuredClone(used)
        emptied.dfw.L.S[0] = [-1, 0]
        expect(learnTarget(full, used).dfw.L.S[0]).toEqual([110, 999])
        expect(learnTarget(full, emptied).dfw.L.S[0]).toEqual([110, 999])
    })
    test("a slot the player changed to another tool, or to more of its tool, takes what was seen", () => {
        const changed = structuredClone(full)
        changed.dfw.L.S[0] = [622, 100]
        changed.dfw.M.S[0] = [110, 1200]
        const learned = learnTarget(full, changed)
        expect(learned.dfw.L.S[0]).toEqual([622, 100])
        expect(learned.dfw.M.S[0]).toEqual([110, 1200])
        expect(learned.dfw.R).toEqual(full.dfw.R)
    })
})

describe("what a refill writes", () => {
    test("every slot goes back up, from the storage the same defence took it from", () => {
        const plan = refillPlan(full, used, stockOf(used))
        expect(plan.dfw.L).toEqual({ S: [[110, 999], [110, 999], [110, 999], [110, 999]], UP: 30, UC: 0 })
        expect(plan.dfw.M.S).toEqual([[110, 999], [622, 303], [110, 999], [110, 999], [622, 303], [110, 999]])
        expect(plan.dfm).toEqual({ LS: [[112, 999]], MS: [[112, 999]], RS: [[112, 999]] })
        expect(plan.placed).toBe(50497 - 46793 + 926)
    })
    test("a section nothing was missing from is not written", () => {
        expect(Object.keys(refillPlan(full, used, stockOf(used))).sort()).toEqual(["dfm", "dfw", "placed", "placedBy"])
        expect(refillPlan(used, used, stockOf(used))).toEqual({ placed: 0, placedBy: { dfw: 0, dfm: 0, dfk: 0 } })
    })
    test("a small storage is shared between the slots in table order", () => {
        const plan = refillPlan(full, used, new Map([[110, 1000]]))
        expect(plan.dfw.L.S).toEqual([[110, 999], [110, 999], [110, 999], [110, 747]])
        expect(plan.dfw.M.S).toEqual(used.dfw.M.S)
        expect(plan.dfm).toBeUndefined()
        expect(plan.placed).toBe(1000)
    })
    test("an emptied slot gets its tool back, and stays empty when storage has none", () => {
        const emptied = structuredClone(used)
        emptied.dfw.R.S[0] = [-1, 0]
        expect(refillPlan(full, emptied, new Map([[110, 5000]])).dfw.R.S[0]).toEqual([110, 999])
        expect(refillPlan(full, emptied, new Map()).dfw).toBeUndefined()
    })
    test("the write carries the fields the game client sends and no more", () => {
        const wall = structuredClone(used)
        wall.dfk = { ...wall.dfk, S: [[629, 10], [-1, 0], [-1, 0]] }
        const wanted = structuredClone(wall)
        wanted.dfk.S[0] = [629, 40]
        expect(refillPlan(wanted, wall, new Map([[629, 100]])).dfk).toEqual({ S: [[629, 40], [-1, 0], [-1, 0]], STS: wall.dfk.STS, MAUCT: 200, UC: 51 })
    })
})

describe("keeping the defence while Khan attacks land", () => {
    const castle = { id: 1000001, areaInfo: { x: 293, y: 226 } }
    const taunt = id => ({ id, kingdomID: 0, owner: { ownerID: -801 }, totalTime: 400_000, deltaTime: Date.now() + 1000 })
    const isTaunt = march => march.owner.ownerID == -801

    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }))
    afterEach(() => vi.useRealTimers())

    function start({ dryRun = false, writes = () => 0 } = {}) {
        const layouts = [full, used]
        const bot = fakeBot()
        const record = bot.sendXT
        bot.sendXT = async (cmd, params) => {
            await record(cmd, params)
            const reply = cmd == "dfc" ? [layouts.shift() ?? used, 0] : [{}, writes(cmd)]
            setImmediate(() => bot.xtHandler.emit(cmd, ...reply))
        }
        const movementEvents = new EventEmitter()
        const { mod } = loadModule("khanDefence.js", { bot, extra: { "protocols.js": { movementEvents } } })
        const keeper = mod.keepDefence({ castle, kingdomID: 0, isTaunt, dryRun })
        const commands = () => bot.sent.map(([cmd]) => cmd)
        const settle = async () => {
            for (let i = 0; i < 20; i++)
                await new Promise(resolve => setImmediate(resolve))
        }
        const landing = async march => {
            movementEvents.emit("outgoing", march)
            await vi.advanceTimersByTimeAsync(405_000)
            await settle()
        }
        return { keeper, bot, commands, landing, settle, movementEvents }
    }

    test("the first read only learns the layout, and a landing taunt refills it", async () => {
        const { keeper, bot, commands, landing } = start()
        await keeper.refill()
        expect(commands()).toEqual(["dfc"])
        await landing(taunt(1))
        expect(commands()).toEqual(["dfc", "dfc", "dfw", "dfm"])
        const [, dfw] = bot.sent.find(([cmd]) => cmd == "dfw")
        const side = { S: [[110, 999], [110, 999], [110, 999], [110, 999]], UP: 30, UC: 0 }
        expect(dfw).toEqual({
            CX: 293, CY: 226, AID: 1000001, L: side, R: side,
            M: { S: [[110, 999], [622, 303], [110, 999], [110, 999], [622, 303], [110, 999]], UP: 40, UC: 0 },
        })
        expect(bot.sent.find(([cmd]) => cmd == "dfm")[1]).toEqual({ CX: 293, CY: 226, AID: 1000001, LS: [[112, 999]], MS: [[112, 999]], RS: [[112, 999]] })
    })
    test("a march that is not a Khan attack refills nothing", async () => {
        const { keeper, commands, landing } = start()
        await keeper.refill()
        await landing({ ...taunt(1), owner: { ownerID: 7 } })
        expect(commands()).toEqual(["dfc"])
    })
    test("one taunt seen twice refills once", async () => {
        const { keeper, commands, movementEvents, settle } = start()
        await keeper.refill()
        movementEvents.emit("outgoing", taunt(1))
        movementEvents.emit("outgoing", taunt(1))
        await vi.advanceTimersByTimeAsync(405_000)
        await settle()
        expect(commands().filter(cmd => cmd == "dfc")).toHaveLength(2)
    })
    test("a request during a refill runs one more refill afterwards", async () => {
        const { keeper, commands } = start()
        await Promise.all([keeper.refill(), keeper.refill(), keeper.refill()])
        expect(commands()).toEqual(["dfc", "dfc", "dfw", "dfm"])
    })
    test("log only reads the defence and writes nothing", async () => {
        const { keeper, commands, landing } = start({ dryRun: true })
        vi.spyOn(console, "info").mockImplementation(() => {})
        await keeper.refill()
        await landing(taunt(1))
        expect(commands()).toEqual(["dfc", "dfc"])
        expect(console.info).toHaveBeenCalledWith("khanDefencePlanned", 50497 - 46793 + 926)
    })
    test("a refused write is warned about and the next write still goes out", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { keeper, commands, landing } = start({ writes: cmd => cmd == "dfw" ? 437 : 0 })
        await keeper.refill()
        await landing(taunt(1))
        expect(commands()).toEqual(["dfc", "dfc", "dfw", "dfm"])
        expect(warn).toHaveBeenCalledWith("khanDefenceRefused", "dfw", " ", "INVALID_EVENT_DIFFICULTY_ID")
    })
    test("the log counts only the tools of writes the game accepted", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const info = vi.spyOn(console, "info").mockImplementation(() => {})
        const { keeper, landing } = start({ writes: cmd => cmd == "dfw" ? 437 : 0 })
        await keeper.refill()
        await landing(taunt(1))
        expect(info).toHaveBeenCalledWith("khanDefenceRefilled", 926)
    })
    test("after the bot unloads a landing taunt refills nothing", async () => {
        const { keeper, bot, commands, landing } = start()
        await keeper.refill()
        bot.events.emit("unload")
        await landing(taunt(1))
        expect(commands()).toEqual(["dfc"])
    })
})
