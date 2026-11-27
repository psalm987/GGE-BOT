import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const ME = 7, OTHER = 8
const RECRUIT = 6, HEAL = 2

/**
 * The shared module against a game with one castle (kingdom 0, id 10). `onAhr(params, n)` answers the n-th `ahr`:
 * "confirm" pushes the new request as `ahh`, a number refuses with that code, and anything else stays silent.
 */
function run({ onAhr = () => "confirm", alliance = 5 } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerID = ME
    bot.playerInfo.alliance = { id: alliance }
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    let asks = 0
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "jca")
            reply("jaa", { KID: 0, grc: { KID: 0, AID: p.CID }, gca: { BD: [], scl: { OIDL: [] } }, gpa: {} })
        if (cmd == "ahr") {
            const answer = onAhr(p, asks++)
            if (answer == "confirm")
                reply("ahh", { LID: 50 + asks, PID: ME, TID: p.T, P: 0, AC: 0, OP: { AID: 10 }, RT: 3600 })
            else if (typeof answer == "number")
                reply("ahr", {}, answer)
        }
    }
    const warns = []
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation((...args) => warns.push(args[0]))
    const { mod } = loadModule("allianceHelp.js", { bot })
    const { castles } = require("../protocols.js")
    bot.xtHandler.emit("dcl", { C: [{ KID: 0, AI: [{ AID: 10, W: 0, S: 0 }] }] }, 0)
    const castle = castles.find(c => c.id == 10)
    const ahrs = () => bot.sent.filter(([cmd]) => cmd == "ahr").map(([, p]) => p)
    const ask = async (fields, wait = 20_000) => {
        const answer = mod.askAllianceHelp(castle, fields)
        await vi.advanceTimersByTimeAsync(wait)
        return answer
    }
    return { bot, mod, castle, ahrs, ask, warns }
}

test("asks from inside the castle with the type and id, and the game's push confirms it", async () => {
    const { bot, ahrs, ask } = run()
    expect(await ask({ type: HEAL, id: 4411, ticket: 4411 })).toBe("asked")
    expect(ahrs()).toEqual([{ ID: 4411, T: HEAL }])
    const sent = bot.sent.map(([cmd]) => cmd)
    expect(sent.indexOf("jca")).toBeLessThan(sent.indexOf("ahr"))
})

test("waits a moment, as a player does, before asking", async () => {
    const { ahrs, mod, castle } = run()
    mod.askAllianceHelp(castle, { type: RECRUIT, id: 0, ticket: 1 })
    await vi.advanceTimersByTimeAsync(1400)
    expect(ahrs()).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(ahrs()).toHaveLength(1)
})

test("silence after asking is taken as asked, not as a timeout, and the request then counts as open", async () => {
    const { ask, mod, ahrs } = run({ onAhr: () => "silent" })
    expect(await ask({ type: RECRUIT, id: 0, ticket: 1 })).toBe("unconfirmed")
    expect(mod.hasOwnOpenRequest(RECRUIT, 10)).toBe(true)
    expect(await ask({ type: RECRUIT, id: 0, ticket: 2 })).toBe("skipped")
    expect(ahrs()).toHaveLength(1)
})

test("never asks twice for the same ticket", async () => {
    const { ask, ahrs, bot } = run({ onAhr: () => 2 })
    await ask({ type: HEAL, id: 9, ticket: 9 })
    bot.xtHandler.emit("ahd", { LID: 51 }, 0)
    expect(await ask({ type: HEAL, id: 9, ticket: 9 })).toBe("skipped")
    expect(ahrs()).toHaveLength(1)
})

test("a request of mine the game lists for that castle counts as open, and another castle's does not", async () => {
    const { mod, bot } = run()
    bot.xtHandler.emit("ahl", { AHL: [{ LID: 1, PID: ME, TID: HEAL, P: 1, AC: 0, OP: { AID: 10 }, RT: 600 }, { LID: 2, PID: OTHER, TID: RECRUIT, P: 0, OP: { AID: 10 }, RT: 600 }] }, 0)
    expect(mod.hasOwnOpenRequest(HEAL, 10)).toBe(true)
    expect(mod.hasOwnOpenRequest(HEAL, 11)).toBe(false)
    expect(mod.hasOwnOpenRequest(RECRUIT, 10)).toBe(false)
    bot.xtHandler.emit("ahd", { LID: 1 }, 0)
    expect(mod.hasOwnOpenRequest(HEAL, 10)).toBe(false)
})

test("NO_MULTIPLE_ALLIANCEHELP means one is open already: no warning, and no second ask meanwhile", async () => {
    const { ask, warns, mod } = run({ onAhr: () => 273 })
    expect(await ask({ type: HEAL, id: 9, ticket: 9 })).toBe("alreadyOpen")
    expect(warns).toEqual([])
    expect(mod.hasOwnOpenRequest(HEAL, 10)).toBe(true)
})

test("INVALID_PARAMETER_VALUE means the batch is done: no warning and no wait for the next batch", async () => {
    const { ask, warns, ahrs } = run({ onAhr: (_, n) => n == 0 ? 2 : "confirm" })
    expect(await ask({ type: HEAL, id: 9, ticket: 9 })).toBe("batchDone")
    expect(await ask({ type: HEAL, id: 10, ticket: 10 })).toBe("asked")
    expect(warns).toEqual([])
    expect(ahrs()).toHaveLength(2)
})

test("another refusal is logged and that castle waits an hour before asking again", async () => {
    const { ask, warns, ahrs } = run({ onAhr: (_, n) => n == 0 ? 114 : "confirm" })
    expect(await ask({ type: RECRUIT, id: 0, ticket: 1 })).toBe("refused")
    expect(warns).toEqual(["allianceHelpRefused"])
    expect(await ask({ type: RECRUIT, id: 0, ticket: 2 }, 50 * 60_000)).toBe("skipped")
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(await ask({ type: RECRUIT, id: 0, ticket: 3 })).toBe("asked")
    expect(ahrs()).toHaveLength(2)
})

test("NOT_IN_OWNED_CASTLE joins the castle again and asks once more, and only once", async () => {
    const { ask, bot, ahrs } = run({ onAhr: (_, n) => n == 0 ? 53 : "confirm" })
    expect(await ask({ type: RECRUIT, id: 0, ticket: 1 }, 30_000)).toBe("asked")
    expect(ahrs()).toHaveLength(2)
    expect(bot.sent.filter(([cmd]) => cmd == "jca")).toHaveLength(2)

    const again = run({ onAhr: () => 53 })
    expect(await again.ask({ type: RECRUIT, id: 0, ticket: 1 }, 30_000)).toBe("refused")
    expect(again.ahrs()).toHaveLength(2)
})

test("asks nothing outside an alliance", async () => {
    const { ask, ahrs } = run({ alliance: -1 })
    expect(await ask({ type: RECRUIT, id: 0, ticket: 1 })).toBe("skipped")
    expect(ahrs()).toEqual([])
})

test("a dry run logs the ask and sends nothing", async () => {
    const { ask, ahrs } = run()
    expect(await ask({ type: RECRUIT, id: 0, ticket: 1, dryRun: true })).toBe("dryRun")
    expect(ahrs()).toEqual([])
})

test("other members' open requests are helpable; mine, helped and full ones are not", () => {
    const { mod, bot } = run()
    bot.xtHandler.emit("ahl", { AHL: [
        { LID: 1, PID: OTHER, TID: RECRUIT, P: 0, AC: 0, RT: 600 },
        { LID: 2, PID: ME, TID: RECRUIT, P: 0, AC: 0, RT: 600 },
        { LID: 3, PID: OTHER, TID: RECRUIT, P: 0, AC: 1, RT: 600 },
    ] }, 0)
    expect(mod.helpable().map(r => r.listID)).toEqual([1])
})
