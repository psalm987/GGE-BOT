import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { describe, expect, test } from "vitest"
import { commanderPositions } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule, fakeBot } = require("./harness/load.cjs")

class Lord { constructor(e) { this.lordID = e.ID; this.lordPosition = e.VIS } }
const pool = () => {
    const bot = fakeBot()
    const { mod } = loadModule("plugins/commander.js", { bot, extra: { "protocols.js": { ClassTypes: { Lord }, movementEvents: new EventEmitter() } } })
    bot.xtHandler.emit("gli", { C: Array.from({ length: 20 }, (_, i) => ({ ID: 100 + i, VIS: i })) }, 0)
    return mod
}

const LISTS = ["1-99", "1-5,9", "1;2;3", "1-3; 7, 9", "1;;2,", " 4 ; 6 ", "abc, 9-3", "19", "2-2;2"]

describe("a commander list", () => {
    test.each(LISTS)("%j picks the same positions in the bot as on the settings page", list => {
        const { parseWhitelist } = pool()
        expect([...new Set(parseWhitelist(list))].map(position => position + 1)).toEqual([...commanderPositions(list)])
    })
    test("a list written with semicolons hands out exactly those commanders", () => {
        const { takeFreeCommander } = pool()
        expect([takeFreeCommander("2;5"), takeFreeCommander("2;5"), takeFreeCommander("2;5")].map(lord => lord?.lordID)).toEqual([101, 104, undefined])
    })
    test("the written order is the order commanders are taken in, for a plugin that asks for it", async () => {
        const { waitForCommanderAvailable, inWrittenOrder } = pool()
        const taken = []
        for (let i = 0; i < 3; i++)
            taken.push((await waitForCommanderAvailable("5;2;9", undefined, inWrittenOrder("5;2;9"))).lordPosition + 1)
        expect(taken).toEqual([5, 2, 9])
        expect(inWrittenOrder("")).toBeUndefined()
    })
    test("without it the first free commander of the game's own list is taken, whatever the list's order", async () => {
        const { waitForCommanderAvailable } = pool()
        expect((await waitForCommanderAvailable("5;2;9")).lordPosition + 1).toBe(2)
    })
    test("a range written backwards picks nothing instead of stopping the plugin", () => {
        const { parseWhitelist, takeFreeCommander } = pool()
        expect(parseWhitelist("9-3")).toEqual([])
        expect(takeFreeCommander("9-3")).toBeUndefined()
    })
    test("an empty list is still every commander", () => {
        expect(pool().takeFreeCommander("")?.lordID).toBe(100)
    })
})
