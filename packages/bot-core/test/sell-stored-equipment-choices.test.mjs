import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const item = (id, slot, rarity, set = -1) => [id, slot, 0, rarity, "", 0, 0, set]
const MIX = [
    item(1, 1, 3), item(2, 2, 4), item(3, 3, 2), item(4, 4, 1), item(5, 6, 13), item(6, 6, 11),
    item(7, 1, 5), item(8, 2, 0), item(9, 3, 3, 12), item(10, 5, 3),
]

async function sold(options, { stored = MIX, gemList = [], gemItems = [] } = {}) {
    vi.useFakeTimers()
    const bot = fakeBot()
    bot.sendXT = async (cmd, params) => {
        bot.sent.push([cmd, JSON.parse(params)])
        if (cmd == "gei") queueMicrotask(() => bot.xtHandler.emit("gei", { I: stored }, 0))
        if (cmd == "ggm") queueMicrotask(() => bot.xtHandler.emit("ggm", { GEM: gemList }, 0))
    }
    bot.botConfig.plugins.sellStoredEquipment = { sellStartDelayMinutes: "1", sellMaxPerRun: "50", ...options }
    loadModule("plugins/sellStoredEquipment.js", { bot, items: { gems: gemItems } })
    bot.events.emit("load")
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const ids = cmd => bot.sent.filter(([c]) => c == cmd)
    return { equipment: ids("seq").map(([, p]) => p.EID).sort((a, b) => a - b), gems: ids("sge").map(([, p]) => p.GID) }
}

test("with no choices saved it sells everything but relics, uniques and set pieces, as it always did", async () => {
    expect((await sold({})).equipment).toEqual([1, 2, 3, 4, 5, 6, 10])
})

test("unticking epic and legendary keeps those in every slot, hero ones included", async () => {
    expect((await sold({ sellRarityEpic: false, sellRarityLegendary: false })).equipment).toEqual([3, 4, 6])
})

test("unticking a slot keeps its items of every rarity", async () => {
    expect((await sold({ sellSlotHero: false, sellSlotArmour: false })).equipment).toEqual([2, 3, 4, 10])
})

test("a skin follows the rarity alone, since it has no slot choice", async () => {
    expect((await sold({ sellRarityEpic: false })).equipment).toEqual([2, 3, 4, 6])
})

test("gems sell up to the level set, and not at all when unticked", async () => {
    const run = options => sold(options, {
        stored: [], gemList: [[1, 2], [2, 3]],
        gemItems: [{ gemID: 1, gemLevelID: "2" }, { gemID: 2, gemLevelID: "9" }],
    }).then(result => result.gems)
    expect(await run({})).toEqual([1, 1, 2, 2, 2])
    expect(await run({ sellGemMaxLevel: 5 })).toEqual([1, 1])
    expect(await run({ sellGems: false })).toEqual([])
})
