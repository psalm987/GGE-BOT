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

const EVERY_COLOUR = { sellGrey: true, sellGreen: true, sellPurple: true, sellOrange: true }

test("with no slot choices saved every slot sells, so only the colours decide", async () => {
    expect((await sold({})).equipment).toEqual([3, 4, 6])
    expect((await sold(EVERY_COLOUR)).equipment).toEqual([1, 2, 3, 4, 5, 6, 10])
})

test("unticking a slot keeps its items of every colour", async () => {
    expect((await sold({ ...EVERY_COLOUR, sellSlotHero: false, sellSlotArmour: false })).equipment).toEqual([2, 3, 4, 10])
})

test("a skin follows the colour alone, since it has no slot choice", async () => {
    expect((await sold({ sellGrey: false, sellGreen: false, sellPurple: true, sellOrange: false, sellSlotArmour: false, sellSlotHero: false })).equipment).toEqual([10])
})

test("loose gems sell up to the level set, and not at all when unticked", async () => {
    const run = options => sold(options, {
        stored: [], gemList: [[1, 2], [2, 3]],
        gemItems: [{ gemID: 1, gemColorID: 1, gemLevelID: "2" }, { gemID: 2, gemColorID: 1, gemLevelID: "9" }],
    }).then(result => result.gems)
    expect(await run({})).toEqual([1, 1, 2, 2, 2])
    expect(await run({ sellGemMaxLevel: 5 })).toEqual([1, 1])
    expect(await run({ sellLooseGems: false })).toEqual([])
})
