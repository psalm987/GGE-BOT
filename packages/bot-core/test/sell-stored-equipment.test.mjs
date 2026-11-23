import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"
import { effectivePluginConfig, normalizePluginSettings, PluginSettingsError } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const gems = [{ gemID: 9 }]
const equipment = Array.from({ length: 30 }, (_, i) => [100 + i, 0, 0, 2, "", 0, 0, -1])

function start(options = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    const sentAt = []
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        sentAt.push([cmd, Date.now()])
        if (cmd == "gei") queueMicrotask(() => bot.xtHandler.emit("gei", { I: equipment }, 0))
        if (cmd == "ggm") queueMicrotask(() => bot.xtHandler.emit("ggm", { GEM: [[9, 50]] }, 0))
    }
    bot.botConfig.plugins.sellStoredEquipment = { sellStartDelayMinutes: "2", sellMaxPerRun: "20", ...options }
    loadModule("plugins/sellStoredEquipment.js", { bot, items: { gems } })
    bot.events.emit("load")
    return { sentAt, t0: Date.now() }
}

const sales = sentAt => sentAt.filter(([cmd]) => cmd == "seq" || cmd == "sge")

test("waits the start delay, spaces sells at least 2 s apart, and caps each run", async () => {
    const { sentAt, t0 } = start()
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1)
    expect(sentAt).toEqual([])
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 20 * 6_000)
    const first = sales(sentAt)
    expect(first).toHaveLength(20)
    expect(first[0][1] - t0).toBeGreaterThanOrEqual(2 * 60_000)
    for (let i = 1; i < first.length; i++)
        expect(first[i][1] - first[i - 1][1]).toBeGreaterThanOrEqual(2000)
})

test("a run in progress never overlaps the next one", async () => {
    const { sentAt } = start({ sellMaxPerRun: "50" })
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 60_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const s = sales(sentAt)
    for (let i = 1; i < s.length; i++)
        expect(s[i][1] - s[i - 1][1]).toBeGreaterThanOrEqual(2000)
})

test("the remainder waits for the next run", async () => {
    const { sentAt } = start()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    const s = sales(sentAt)
    expect(s.length).toBeGreaterThan(20)
    expect(sentAt.filter(([cmd]) => cmd == "gei").length).toBeGreaterThan(1)
})

const catalog = [{ key: "sellStoredEquipment", force: false, hidden: false, options: loadModule("plugins/sellStoredEquipment.js", { mainThread: true }).mod.pluginOptions }]
const saved = options => ({ sellStoredEquipment: { enabled: true, options } })

/** How many items the first run sells with these options, up to the 80 the storage holds. */
async function firstRun(options) {
    const { sentAt } = start(options)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    const second = sentAt.filter(([cmd]) => cmd == "gei")[1]
    return sales(sentAt.slice(0, sentAt.indexOf(second))).length
}

test.each(["-5", "0", "99", "abc", "", "7"])("a stored run size of %j sells as many items on the legacy host as under the runner", async stored => {
    const asStored = await firstRun({ sellMaxPerRun: stored })
    const viaRunner = await firstRun(effectivePluginConfig(catalog, saved({ sellMaxPerRun: stored })).sellStoredEquipment)

    expect(asStored).toBe(viaRunner)
})

test("a run size that is not a whole number is refused when saved", () => {
    expect(() => normalizePluginSettings(catalog, saved({ sellMaxPerRun: "2.5" }))).toThrow(PluginSettingsError)
})

const piece = (id, rarity, setID = -1) => [id, 0, 0, rarity, "", 0, 0, setID]
const gemRows = [[9, 2], [8, 3]]
const setGem = { gemID: 8, setID: 4 }

/** The commands one run sends for this storage, with a run size big enough not to cap it. */
async function run(options, rows, { logs = [] } = {}) {
    vi.useFakeTimers()
    const log = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")))
    const bot = fakeBot()
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        if (cmd == "gei") queueMicrotask(() => bot.xtHandler.emit("gei", { I: rows }, 0))
        if (cmd == "ggm") queueMicrotask(() => bot.xtHandler.emit("ggm", { GEM: gemRows }, 0))
    }
    bot.botConfig.plugins.sellStoredEquipment = { sellStartDelayMinutes: "1", sellMaxPerRun: "50", ...options }
    loadModule("plugins/sellStoredEquipment.js", { bot, items: { gems: [...gems, setGem] } })
    bot.events.emit("load")
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 60_000)
    log.mockRestore()
    const sold = bot.sent.filter(([cmd]) => cmd == "seq" || cmd == "sge")
    return {
        bot,
        equipment: sold.filter(([cmd]) => cmd == "seq").map(([, p]) => p.EID),
        gems: sold.filter(([cmd]) => cmd == "sge").map(([, p]) => p.GID),
    }
}

const rarityIds = [0, 1, 2, 3, 4, 5]
const storage = rarityIds.flatMap(rarity => [piece(rarity, rarity), piece(rarity + 10, rarity + 10)])
const nothing = { sellGrey: false, sellGreen: false, sellPurple: false, sellOrange: false, sellRed: false, sellRelic: false, sellLooseGems: false }
const ascending = list => [...list].sort((a, b) => a - b)

test("by default it sells grey and green equipment and loose gems, and keeps the rest", async () => {
    const { equipment, gems: soldGems } = await run({}, storage)
    expect(ascending(equipment)).toEqual([1, 2, 11, 12])
    expect(soldGems).toEqual([9, 9])
})

test.each([
    ["sellGrey", [1, 11]],
    ["sellGreen", [2, 12]],
    ["sellPurple", [3, 13]],
    ["sellOrange", [4, 14]],
    ["sellRed", [0, 10]],
    ["sellRelic", [5, 15]],
])("%s alone sells that colour and its hero variant", async (key, expected) => {
    const { equipment, gems: soldGems } = await run({ ...nothing, [key]: true }, storage)
    expect(ascending(equipment)).toEqual(expected)
    expect(soldGems).toEqual([])
})

test("a piece in a set is never sold, whatever colours are ticked", async () => {
    const all = { ...nothing, sellGrey: true, sellGreen: true, sellPurple: true, sellOrange: true, sellRed: true, sellRelic: true }
    const { equipment } = await run(all, [piece(1, 1, 3), piece(2, 2), piece(3, 13, 7), piece(4, 5, 1)])
    expect(equipment).toEqual([2])
})

test("a gem in a set is not sold, and gems off sells none", async () => {
    const on = await run({ ...nothing, sellLooseGems: true }, [])
    expect(on.gems).toEqual([9, 9])
    const off = await run({ sellLooseGems: false }, storage)
    expect(off.gems).toEqual([])
    expect(off.equipment.length).toBeGreaterThan(0)
})

test("with no colour and no gems ticked it sends nothing and says why", async () => {
    const logs = []
    const { bot } = await run(nothing, storage, { logs })
    expect(bot.sent).toEqual([])
    expect(logs).toEqual(["sellNothingSelected"])
})

test("ticking only gems does not read the equipment", async () => {
    const { bot } = await run({ ...nothing, sellLooseGems: true }, storage)
    expect(bot.sent.some(([cmd]) => cmd == "gei")).toBe(false)
})

test("a new install defaults to grey, green and gems", () => {
    const defaults = effectivePluginConfig(catalog, saved({})).sellStoredEquipment
    expect(defaults).toMatchObject({ sellGrey: true, sellGreen: true, sellPurple: false, sellOrange: false, sellRed: false, sellRelic: false, sellLooseGems: true })
})
