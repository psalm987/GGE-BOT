import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")

afterEach(() => vi.useRealTimers())

const settle = () => vi.advanceTimersByTimeAsync(0)

/** The bot after login, with the event gate loaded and every eventStart and eventStop recorded. */
async function eventBot() {
    vi.useFakeTimers()
    const { mod: gate, bot } = loadModule("eventGate.js")
    const seen = []
    bot.events.on("eventStart", e => seen.push(["start", e.EID, gate.isActive(e.EID)]))
    bot.events.on("eventStop", e => seen.push(["stop", e.EID, gate.isActive(e.EID), e.byEndTime ?? false]))
    bot.events.emit("load")
    const list = async (...E) => {
        bot.xtHandler.emit("sei", { E }, 0)
        await settle()
    }
    return { gate, bot, seen, list }
}

describe("the running events", () => {
    test("an event starts when a list first has it and stops when a list leaves it out; handlers see it running only in between", async () => {
        const { gate, seen, list } = await eventBot()

        await list({ EID: 72, RS: 3600 })
        await list({ EID: 72, RS: 3500 }, { EID: 80, RS: 3600 })
        await list({ EID: 80, RS: 3500 })

        expect(seen).toEqual([["start", 72, true], ["start", 80, true], ["stop", 72, false, false]])
        expect([gate.isActive(72), gate.isActive(80)]).toEqual([false, true])
    })

    test("an event counts as stopped 30 s after its end time even when no new list comes", async () => {
        const { gate, seen, list } = await eventBot()
        await list({ EID: 72, RS: 100 })

        await vi.advanceTimersByTimeAsync(129_999)
        expect(gate.isActive(72)).toBe(true)
        await vi.advanceTimersByTimeAsync(1)

        expect(seen).toEqual([["start", 72, true], ["stop", 72, false, true]])
        expect(gate.isActive(72)).toBe(false)
    })

    test("a newer list moves the end time, and a list that still has an event past its end starts it again", async () => {
        const { seen, list } = await eventBot()
        await list({ EID: 72, RS: 100 })
        await vi.advanceTimersByTimeAsync(50_000)
        await list({ EID: 72, RS: 100 })

        await vi.advanceTimersByTimeAsync(129_999)
        expect(seen).toEqual([["start", 72, true]])
        await vi.advanceTimersByTimeAsync(1)
        expect(seen.at(-1)).toEqual(["stop", 72, false, true])

        await list({ EID: 72, RS: 600 })
        expect(seen.at(-1)).toEqual(["start", 72, true])
    })

    test("lists that come before login are handled after it, in the order they came", async () => {
        vi.useFakeTimers()
        const { bot } = loadModule("eventGate.js")
        const seen = []
        bot.events.on("eventStart", e => seen.push(["start", e.EID]))
        bot.events.on("eventStop", e => seen.push(["stop", e.EID]))

        bot.xtHandler.emit("fjf", { sei: { E: [{ EID: 72 }] }, mir: { gcl: { C: [] } } }, 0)
        bot.xtHandler.emit("sei", { E: [{ EID: 72 }, { EID: 80 }] }, 0)
        bot.events.emit("load")
        await settle()

        expect(seen).toEqual([["start", 72], ["start", 80]])
    })
})

describe("the event gate", () => {
    test("whenActive resolves with the event once it starts, and at once while it runs", async () => {
        const { gate, list } = await eventBot()
        let started
        gate.whenActive(72).then(e => started = e)
        await list({ EID: 80, RS: 600 })
        expect(started).toBeUndefined()

        await list({ EID: 80, RS: 600 }, { EID: 72, RS: 600 })
        expect(started).toMatchObject({ EID: 72 })
        await expect(gate.whenActive(72)).resolves.toMatchObject({ EID: 72 })
    })

    test("onStart and onStop hear only their event, until unsubscribed", async () => {
        const { gate, list } = await eventBot()
        const heard = []
        const offStart = gate.onStart(72, e => heard.push(["start", e.EID]))
        gate.onStop(72, e => heard.push(["stop", e.EID]))

        await list({ EID: 72, RS: 600 }, { EID: 80, RS: 600 })
        await list()
        offStart()
        await list({ EID: 72, RS: 600 })

        expect(heard).toEqual([["start", 72], ["stop", 72]])
    })
})
