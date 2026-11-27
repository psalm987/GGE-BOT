import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")
const { PluginStatus } = require("../actions.json")
const en = require("../locales/en.json")

const MINUTE = 60_000

afterEach(() => vi.useRealTimers())

const SWORD = 1, RUBY = 2, ARCHER = 3
const units = [
    { wodID: SWORD, type: "Swordsman", healingCostC1: "20" },
    { wodID: RUBY, type: "Rubyknight", healingCostC1: "10", healingCostC2: "3" },
    { wodID: ARCHER, type: "Archer", healingCostC1: "30" },
]
const costOf = wodID => Number(units.find(u => u.wodID == wodID).healingCostC1)

const FREE = [-1, 0, 0, 0, 0, 0], LOCKED = [-2, 0, 0, 0, 0, 0]

/** A castle as the game reports it: its hospital flag, its wounded by wodID, and its hospital's slots (PIDL). */
const castle = (id, { kingdom = 0, hospital = 1, wounded = {}, slots = [FREE, FREE, LOCKED] } = {}) =>
    ({ id, kingdom, hospital, wounded, slots: slots.map(slot => [...slot]) })

/**
 * The plugin against a game that answers dcl, jca, hfl, hru and ahr from `world`. `refuse(params, n)` gives the n-th
 * hru's refusal code, 0 to accept. An accepted heal starts a batch of `batchSeconds` in the first free slot.
 */
function run({ options = {}, world = [castle(10, { wounded: { [SWORD]: 500 } })], coins = 1_000_000, refuse = () => 0, batchSeconds = 3600, alliance = -1 } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.playerInfo.playerID = 7
    bot.playerInfo.alliance = { id: alliance }
    bot.botConfig.plugins.healTroops = { state: true, coinFloor: 0, ...options }
    const logs = [], warns = [], reports = []
    const state = { coins, heals: 0, batch: 500 }
    const reply = (cmd, body, result = 0) => setTimeout(() => bot.xtHandler.emit(cmd, body, result), 100)
    const find = (kingdom, id) => world.find(c => c.kingdom == kingdom && c.id == id)
    const hi = c => Object.entries(c.wounded).map(([wodID, amount]) => [Number(wodID), amount])
    bot.sendXT = async (cmd, params) => {
        const p = JSON.parse(params)
        bot.sent.push([cmd, p])
        if (cmd == "dcl")
            reply("dcl", { C: [...new Set(world.map(c => c.kingdom))].map(KID => ({ KID, AI: world.filter(c => c.kingdom == KID).map(c => ({ AID: c.id, W: 0, S: 0, H: c.hospital, HI: hi(c) })) })) })
        if (cmd == "jca") {
            const c = find(p.KID, p.CID)
            world.forEach(w => { w.current = w === c })
            reply("jaa", { KID: c.kingdom, grc: { KID: c.kingdom, AID: c.id, W: 0, S: 0 }, gca: { BD: [], scl: { OIDL: [] } }, gpa: {}, spl2: { LID: 2, PIDL: c.slots } })
        }
        if (cmd == "hfl")
            reply("hfl", { ...p, HRF: 1 })
        if (cmd == "hru") {
            const c = world.find(w => w.current)
            const code = refuse(p, state.heals++)
            if (code)
                return reply("hru", {}, code)
            c.wounded[p.U] -= p.A
            state.coins -= costOf(p.U) * p.A
            c.slots[c.slots.findIndex(slot => slot[0] == -1)] = [p.U, p.A, batchSeconds, 0, 0, state.batch++]
            reply("hru", { spl: { LID: 2, PIDL: c.slots.map(slot => [...slot]) }, gcu: { C1: state.coins, C2: 0 } })
        }
        if (cmd == "ahr")
            reply("ahh", { LID: 90, PID: 7, TID: p.T, P: 0, AC: 0, OP: { AID: world.find(w => w.current)?.id }, RT: 3600 })
    }
    const parentPort = { postMessage: message => message[0] == PluginStatus && reports.push(message[1]), on() {} }
    vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args))
    vi.spyOn(console, "warn").mockImplementation((...args) => warns.push(args[0]))
    loadModule("plugins/healTroops.js", { bot, parentPort, items: { units } })
    bot.events.emit("load")
    bot.xtHandler.emit("gcu", { C1: coins, C2: 0 }, 0)
    const sent = cmd => bot.sent.filter(([c]) => c == cmd).map(([, p]) => p)
    const setCoins = c => { state.coins = c; bot.xtHandler.emit("gcu", { C1: c, C2: 0 }, 0) }
    return { bot, sent, status: () => reports.at(-1), logs, warns, world, state, setCoins }
}

const row = (amount, id = 10, kingdom = 0) => ({ castle: { kingdom, id }, healAmount: amount })
const settle = () => vi.advanceTimersByTimeAsync(8 * MINUTE)
const nextRound = () => vi.advanceTimersByTimeAsync(11 * MINUTE)

describe("the catalog entry", () => {
    test("is accepted by the API and offers castles with amounts, an interval, a coin floor, a spend cap, a dry run and alliance help", () => {
        const { mod } = loadModule("plugins/healTroops.js", { mainThread: true })
        const entry = { key: "healTroops", force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions, checks: mod.checks }
        expect(PluginCatalogEntry.safeParse(entry).error).toBeUndefined()
        expect(mod.pluginOptions.map(o => o.key)).toEqual(["healCastles", "healInterval", "coinFloor", "spendCap", "dryRunOrders", "askAllianceHelp"])
        expect(mod.pluginOptions.find(o => o.key == "askAllianceHelp").default).toBe(false)
    })

    test("every key it shows or logs is in en.json", () => {
        const keys = ["healTroops", "healTroops.description", "healCastles", "healAmount", "healInterval", "askAllianceHelp", "dryRunHru", "healRefused", "healNoHospital", "healTooMany", "allianceHelpAsked", "allianceHelpRefused", "allianceHelpForHeal", "allianceHelpForRecruit", "dryRunAhr"]
        for (const status of ["Starting", "NoTargets", "Healed", "NothingWounded", "HospitalFull", "CoinFloor", "SpendCap", "NoCoins", "TooMany", "Refused", "NoHospital", "NoCastle", "NoAnswer"])
            keys.push(`statusHealTroops${status}`)
        expect(keys.filter(key => typeof en[key] != "string")).toEqual([])
    })
})

describe("a heal", () => {
    test("opens the hospital as the client does, then heals up to the castle's amount from inside the castle", async () => {
        const { bot, sent, status } = run({ options: { healCastles: [row(100)] } })
        await settle()
        const order = bot.sent.map(([cmd]) => cmd).filter(cmd => ["jca", "hfl", "hru"].includes(cmd))
        expect(order).toEqual(["jca", "hfl", "hru"])
        expect(sent("hfl")).toEqual([{ KID: 0, AID: 10, HRF: -1 }])
        expect(sent("hru")).toEqual([{ U: SWORD, A: 100 }])
        expect(status()).toMatchObject({ state: "running", reasonKey: "statusHealTroopsHealed", params: { heals: 1, troops: 100 } })
    })

    test("heals fewer than the amount when fewer are wounded, the biggest stack first, into each free slot", async () => {
        const world = [castle(10, { wounded: { [SWORD]: 30, [ARCHER]: 50 } })]
        const { sent } = run({ options: { healCastles: [row(100)] }, world })
        await settle()
        expect(sent("hru")).toEqual([{ U: ARCHER, A: 50 }, { U: SWORD, A: 30 }])
    })

    test("never heals a unit the game heals for rubies, and doesn't enter a castle with nothing else wounded", async () => {
        const world = [castle(10, { wounded: { [RUBY]: 200 } })]
        const { sent, status } = run({ options: { healCastles: [row(100)] }, world })
        await settle()
        expect(sent("jca")).toEqual([])
        expect(sent("hru")).toEqual([])
        expect(status()).toMatchObject({ state: "waiting", reasonKey: "statusHealTroopsNothingWounded" })
    })

    test("keeps the coin floor", async () => {
        const { sent, status } = run({ options: { healCastles: [row(500)], coinFloor: 8000 }, coins: 10_000 })
        await settle()
        expect(sent("hru")).toEqual([{ U: SWORD, A: 100 }])

        const broke = run({ options: { healCastles: [row(500)], coinFloor: 8000 }, coins: 8010 })
        await settle()
        expect(broke.sent("hru")).toEqual([])
        expect(broke.status()).toMatchObject({ state: "waiting", reasonKey: "statusHealTroopsCoinFloor" })
        expect(status().reasonKey).toBe("statusHealTroopsHealed")
    })

    test("spends at most the spend cap in a run, across all castles", async () => {
        const world = [castle(10, { wounded: { [SWORD]: 500 } }), castle(11, { wounded: { [SWORD]: 500 } })]
        const { sent } = run({ options: { healCastles: [row(100, 10), row(100, 11)], spendCap: 3000 }, world })
        await settle()
        expect(sent("hru")).toEqual([{ U: SWORD, A: 100 }, { U: SWORD, A: 50 }])
    })

    test("a dry run logs each heal and sends nothing, not even a castle join", async () => {
        const { sent, logs } = run({ options: { healCastles: [row(100)], dryRunOrders: true } })
        await settle()
        expect(sent("jca")).toEqual([])
        expect(sent("hfl")).toEqual([])
        expect(sent("hru")).toEqual([])
        expect(logs.find(line => line[0] == "dryRunHru")).toBeDefined()
    })

    test("never changes the player's saved castles", async () => {
        const rows = [row(100)]
        const { bot } = run({ options: { healCastles: rows }, refuse: () => 88 })
        await settle()
        await nextRound()
        expect(bot.botConfig.plugins.healTroops.healCastles).toEqual([row(100)])
    })
})

describe("a full hospital", () => {
    test("is not entered until its shortest batch ends, plus 10 seconds", async () => {
        const world = [castle(10, { wounded: { [SWORD]: 500 }, slots: [FREE, LOCKED] })]
        const { sent } = run({ options: { healCastles: [row(10), ], healInterval: 10 }, world, batchSeconds: 25 * 60 })
        await settle()
        expect(sent("hru")).toHaveLength(1)
        world[0].slots = [FREE, LOCKED]
        await nextRound()
        await nextRound()
        expect(sent("jca")).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(10 * MINUTE)
        expect(sent("hru")).toHaveLength(2)
    })

    test("a castle whose join shows no free slot is left until a slot frees", async () => {
        const busy = [SWORD, 10, 3600, 0, 0, 77]
        const world = [castle(10, { wounded: { [SWORD]: 500 }, slots: [busy, LOCKED] })]
        const { sent } = run({ options: { healCastles: [row(10)] }, world })
        await settle()
        expect(sent("hfl")).toEqual([])
        await nextRound()
        expect(sent("jca")).toHaveLength(1)
    })
})

describe("refusals", () => {
    test("short of coins waits until there are coins for that whole heal", async () => {
        const { sent, setCoins, status } = run({ options: { healCastles: [row(100)] }, coins: 5000, refuse: (_p, n) => n == 0 ? 10 : 0 })
        await settle()
        expect(status().reasonKey).toBe("statusHealTroopsNoCoins")
        setCoins(1500)
        await nextRound()
        expect(sent("hru")).toHaveLength(1)
        setCoins(2500)
        await nextRound()
        expect(sent("hru")).toEqual([{ U: SWORD, A: 100 }, { U: SWORD, A: 100 }])
    })

    test("too many at once halves the amount at the next round", async () => {
        const { sent, warns } = run({ options: { healCastles: [row(100)] }, refuse: (_p, n) => n == 0 ? 88 : 0 })
        await settle()
        await nextRound()
        expect(sent("hru").map(p => p.A)).toEqual([100, 50])
        expect(warns).toContain("healTooMany")
    })

    test("a full queue is retried later without a word in the log", async () => {
        const { sent, warns, status } = run({ options: { healCastles: [row(100)] }, refuse: (_p, n) => n == 0 ? 63 : 0 })
        await settle()
        expect(warns).toEqual([])
        expect(status().reasonKey).toBe("statusHealTroopsHospitalFull")
        await vi.advanceTimersByTimeAsync(60 * MINUTE)
        expect(sent("hru").length).toBeGreaterThan(1)
    })

    test("NOT_IN_OWNED_CASTLE joins again and heals once more, and only once", async () => {
        const { sent } = run({ options: { healCastles: [row(100)] }, refuse: (_p, n) => n == 0 ? 53 : 0 })
        await settle()
        expect(sent("jca")).toHaveLength(2)
        expect(sent("hru")).toHaveLength(2)

        const stuck = run({ options: { healCastles: [row(100)] }, refuse: () => 53 })
        await settle()
        expect(stuck.sent("hru")).toHaveLength(2)
        expect(stuck.status().reasonKey).toBe("statusHealTroopsRefused")
    })

    test("a heal the game keeps refusing is asked 1, 2, then 4 rounds apart, and at least once an hour", async () => {
        const { sent, warns } = run({ options: { healCastles: [row(100)], healInterval: 10 }, refuse: () => 114 })
        const at = []
        for (let minute = 0; minute < 4 * 60; minute++) {
            const before = sent("hru").length
            await vi.advanceTimersByTimeAsync(MINUTE)
            if (sent("hru").length > before)
                at.push(minute)
        }
        const gaps = at.slice(1).map((t, i) => t - at[i])
        expect(gaps.slice(0, 3).map(gap => Math.round(gap / 10))).toEqual([1, 2, 4])
        expect(Math.max(...gaps)).toBeLessThanOrEqual(75)
        expect(warns).toContain("healRefused")
    })
})

describe("a castle without a hospital", () => {
    test("is never entered, and is said to have none after two looks in a row", async () => {
        const world = [castle(10, { hospital: 0, wounded: { [SWORD]: 500 } })]
        const { sent, warns, status } = run({ options: { healCastles: [row(100)] }, world })
        await settle()
        expect(warns).not.toContain("healNoHospital")
        await nextRound()
        expect(warns.filter(w => w == "healNoHospital")).toHaveLength(1)
        expect(status().reasonKey).toBe("statusHealTroopsNoHospital")
        expect(sent("jca")).toEqual([])
    })

    test("is healed again once a look shows its hospital", async () => {
        const world = [castle(10, { hospital: 0, wounded: { [SWORD]: 500 } })]
        const { sent } = run({ options: { healCastles: [row(100)] }, world })
        await settle()
        await nextRound()
        world[0].hospital = 1
        await nextRound()
        expect(sent("hru")).toHaveLength(1)
    })
})

describe("alliance help", () => {
    test("asks for help with the batch it just started, from inside the castle", async () => {
        const { sent } = run({ options: { healCastles: [row(100)], askAllianceHelp: true }, alliance: 5 })
        await settle()
        expect(sent("ahr")).toEqual([{ ID: 500, T: 2 }])
    })

    test("asks nothing when the option is off", async () => {
        const { sent } = run({ options: { healCastles: [row(100)] }, alliance: 5 })
        await settle()
        expect(sent("ahr")).toEqual([])
    })

    test("never asks for a batch that had help, nor one about to end, nor the same batch twice", async () => {
        const helped = [SWORD, 10, 3000, 0, 120, 61], ending = [SWORD, 10, 30, 0, 0, 62]
        const world = [castle(10, { wounded: { [SWORD]: 500 }, slots: [helped, ending, FREE, LOCKED] })]
        const { sent } = run({ options: { healCastles: [row(10)], askAllianceHelp: true }, alliance: 5, world })
        await settle()
        expect(sent("ahr")).toEqual([{ ID: 500, T: 2 }])
        await nextRound()
        expect(sent("ahr")).toEqual([{ ID: 500, T: 2 }])
    })
})
