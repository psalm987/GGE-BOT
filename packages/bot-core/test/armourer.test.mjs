import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

const LADDER = 28, RAM = 32
const units = [{ wodID: 611, type: "Ram" }, { wodID: 614, type: "Ladder" }]
const packages = [
    { packageID: String(LADDER), unitID: "614", unitAmount: "1", packagePriceC1: "220" },
    { packageID: String(RAM), unitID: "611", unitAmount: "1", packagePriceC1: "430" },
]

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/** The armourer module against a game with one main castle, 10 in kingdom 0, that answers each `sbp` after `delay` ms with `refuse(order)`. */
function armourer({ refuse = () => 0, delay = 100 } = {}) {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const bot = fakeBot()
    const reply = (cmd, body, result = 0, ms = 1) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), ms)
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "jca")
            reply("jaa", { KID: p.KID, grc: { KID: p.KID, AID: p.CID }, gca: { BD: [], scl: { OIDL: [] } }, gpa: {} })
        if (cmd == "gbc")
            reply("gbc", {})
        if (cmd == "sbp")
            reply("sbp", refuse(p) ? {} : { gcu: { C1: 1000 } }, refuse(p), delay)
    }
    const { mod } = loadModule("armourer.js", { bot, items: { units, packages } })
    const protocols = require("../protocols.js")
    bot.events.emit("load")
    bot.xtHandler.emit("gcl", { C: [{ KID: 0, AI: [{ AI: [1, 100, 100, 10, 0, 0, 0, 0, 0, 0, "Keep"] }] }] }, 0)
    bot.xtHandler.emit("sei", { E: [{ EID: 27, PIDS: [LADDER, RAM] }] }, 0)
    return { bot, mod, castle: () => protocols.castles.find(c => c.id == 10) }
}

test("two buys at once go through the shop one after the other, and each takes its own reply", async () => {
    const { bot, mod, castle } = armourer({ refuse: order => order.PID == LADDER ? 154 : 0 })
    await vi.advanceTimersByTimeAsync(0)
    const offers = mod.liveOffers()
    const both = Promise.all([mod.buy(offers.get(614), 1, castle()), mod.buy(offers.get(611), 1, castle())])
    await vi.advanceTimersByTimeAsync(50)
    expect(bot.sent.filter(([cmd]) => cmd == "sbp")).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await both).toEqual([154, 0])
})

test("a dry run joins nothing and sends nothing", async () => {
    const { bot, mod, castle } = armourer()
    vi.spyOn(console, "log").mockImplementation(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(await mod.buy(mod.liveOffers().get(614), 5, castle(), true)).toBe(0)
    expect(bot.sent).toEqual([])
})
