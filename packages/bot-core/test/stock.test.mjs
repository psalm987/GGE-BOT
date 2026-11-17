import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const units = [{ wodID: 614, type: "Ladder" }, { wodID: 611, type: "Ram" }]

function account() {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(1_800_000_000_000)
    const bot = fakeBot()
    bot.playerInfo.playerID = 7
    const { mod } = loadModule("plugins/stock.js", { bot, items: { units } })
    const dcl = C => bot.xtHandler.emit("dcl", { C }, 0)
    return { bot, mod, dcl }
}

test("the catalog marks it hidden", () => {
    expect(loadModule("plugins/stock.js", { mainThread: true }).mod).toEqual({ hidden: true })
})

test("home stock sums the tool across castles, and a kingdom or a castle narrows it", () => {
    const { mod, dcl } = account()
    dcl([
        { KID: 0, AI: [{ AID: 10, AC: [[614, 5]] }, { AID: 11, AC: [[614, 7], [611, 1]] }] },
        { KID: 1, AI: [{ AID: 20, AC: [[614, 100]] }] },
    ])
    expect(mod.toolStock(614).home).toBe(112)
    expect(mod.toolStock(614, { kingdom: 0 }).home).toBe(12)
    expect(mod.toolStock(614, { castle: { kingdom: 1, id: 20 } }).home).toBe(100)
    expect(mod.toolStock(611).total).toBe(1)
})

test("a queue is read into per-tool totals, locked and occupied slots are not free", () => {
    const { mod } = account()
    const queue = mod.parseQueue({ TCT: 120, QS: [
        { P: { WID: 614, AMT: 80 }, SI: { RUT: 1 } },
        { P: [614, 20], SI: { RUT: 1 } },
        { SI: { RUT: 1 } },
        { SI: { RUT: 0 } },
    ] })
    expect(queue).toEqual({ orders: new Map([[614, 100]]), freeSlots: 1, unknown: false, seconds: 120 })
})

test("queued tools count for half an hour, then drop out so tools that finished aren't counted twice", () => {
    const { mod, dcl } = account()
    dcl([{ KID: 0, AI: [{ AID: 10, AC: [] }] }])
    const castle = { kingdomID: 0, id: 10 }
    mod.noteQueued(castle, 614, 80)
    expect(mod.toolStock(614).queued).toBe(80)
    vi.setSystemTime(Date.now() + 29 * 60_000)
    expect(mod.toolStock(614).queued).toBe(80)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect(mod.toolStock(614).queued).toBe(0)
})

test("only our own marches count as travelling, and a kingdom narrows them", () => {
    const { bot, mod } = account()
    const march = (MID, OID, KID, units) => ({ M: { MID, T: 0, KID, OID, SID: OID, TID: 99, TT: 600, PT: 0, TA: [1, 0, 0, 99, 0, 0, 0, 0, 0, 0, "Camp"], SA: [1, 0, 0, 10, 0, 0, 0, 0, 0, 0, "Keep"] }, GA: { L: units, M: [], R: [], RW: [] } })
    bot.xtHandler.emit("gam", { M: [march(1, 7, 0, [[614, 20]]), march(2, 7, 1, [[614, 5]]), march(3, 3, 0, [[614, 900]])], O: [] }, 0)
    expect(mod.toolStock(614).travelling).toBe(25)
    expect(mod.toolStock(614, { kingdom: 1 }).travelling).toBe(5)
})

test("the order in production counts, and an order it can't read makes the queue unknown", () => {
    const { mod } = account()
    expect(mod.parseQueue({ QS: [{ SI: { RUT: 1 } }], PS: { WID: 614, AMT: 30 } })).toMatchObject({ orders: new Map([[614, 30]]), unknown: false })
    expect(mod.parseQueue({ QS: [{ P: { X: 1 } }] }).unknown).toBe(true)
    expect(mod.parseQueue({}).unknown).toBe(true)
    expect(mod.parseQueue({ QS: [], PS: 3 }).unknown).toBe(false)
})
