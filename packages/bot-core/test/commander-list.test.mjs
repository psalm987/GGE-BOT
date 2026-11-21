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
        expect([takeFreeCommander("5;2"), takeFreeCommander("5;2"), takeFreeCommander("5;2")].map(lord => lord?.lordID)).toEqual([104, 101, undefined])
    })
    test("the written order is the order commanders are taken in", async () => {
        const { waitForCommanderAvailable } = pool()
        const taken = []
        for (let i = 0; i < 3; i++)
            taken.push((await waitForCommanderAvailable("5;2;9")).lordPosition + 1)
        expect(taken).toEqual([5, 2, 9])
    })
    test("a plugin's own order gives way to the written one", async () => {
        const { waitForCommanderAvailable } = pool()
        const fastestFirst = (a, b) => b.lordPosition - a.lordPosition
        expect((await waitForCommanderAvailable("5;2;9", undefined, fastestFirst)).lordPosition + 1).toBe(5)
    })
    test("an empty list names no order, so the plugin's own order picks", async () => {
        const { waitForCommanderAvailable } = pool()
        expect((await waitForCommanderAvailable("", undefined, (a, b) => b.lordPosition - a.lordPosition)).lordPosition + 1).toBe(20)
        expect((await waitForCommanderAvailable("")).lordPosition + 1).toBe(1)
    })
    test.each(["1-50", "1-99"])("%j is every commander in order, so the plugin's own order still picks", async list => {
        const { waitForCommanderAvailable } = pool()
        expect((await waitForCommanderAvailable(list, undefined, (a, b) => b.lordPosition - a.lordPosition)).lordPosition + 1).toBe(20)
    })
    test("a list picked in order but short of every commander keeps its written order", async () => {
        const { waitForCommanderAvailable } = pool()
        expect((await waitForCommanderAvailable("1-20", undefined, (a, b) => b.lordPosition - a.lordPosition)).lordPosition + 1).toBe(1)
    })
    test("a commander taken without waiting is also the first free one in the written order", () => {
        const { takeFreeCommander } = pool()
        expect([takeFreeCommander("7;3"), takeFreeCommander("7;3")].map(lord => lord.lordPosition + 1)).toEqual([7, 3])
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
