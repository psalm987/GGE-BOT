import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { stormWatch, STORM_EVENT_ID } = require("../stormClosing.js")

const EID = 999
const list = RS => ({ E: [{ EID: 1, RS: 5 }, { EID, RS }] })
function start(activeEvent, eventID = EID) {
    const xtHandler = new EventEmitter()
    const clock = { at: 0 }
    return { xtHandler, clock, watch: stormWatch(eventID, { xtHandler, activeEvent, now: () => clock.at }) }
}

describe("the end of the Storm event", () => {
    test("is unknown while the event id is unknown, so nothing is ever too late", () => {
        const { xtHandler, watch } = start(undefined, STORM_EVENT_ID ?? null)
        xtHandler.emit("sei", list(1), 0)
        watch.learn(600, 1)
        expect(watch.endsAt()).toBe(Infinity)
        expect(watch.lands(1000)).toBe(true)
    })
    test("is counted from when the sei list arrived", () => {
        const { xtHandler, clock, watch } = start()
        clock.at = 10_000
        xtHandler.emit("sei", list(100), 0)
        expect(watch.endsAt()).toBe(110_000)
    })
    test("is read from the list the login sent too, and ignores a refused list", () => {
        const { xtHandler, watch } = start()
        xtHandler.emit("sei", list(100), 5)
        expect(watch.endsAt()).toBe(Infinity)
        xtHandler.emit("fjf", { sei: list(50) }, 0)
        expect(watch.endsAt()).toBe(50_000)
    })
    test("is seeded from the list the bot already holds", () => {
        const { watch } = start(() => ({ EID, RS: 30 }))
        expect(watch.endsAt()).toBe(30_000)
    })
    test("is kept after the event drops off the list, and unset for an event never listed", () => {
        const { xtHandler, clock, watch } = start()
        xtHandler.emit("sei", { E: [{ EID: 1, RS: 5 }] }, 0)
        expect(watch.endsAt()).toBe(Infinity)
        xtHandler.emit("sei", list(60), 0)
        xtHandler.emit("sei", { E: [] }, 0)
        clock.at = 61_000
        expect(watch.lands(0)).toBe(false)
    })
})

describe("whether an attack lands before the event ends", () => {
    test("before any march is known only an event already over is too late", () => {
        const { clock, watch } = start(() => ({ EID, RS: 60 }))
        expect(watch.lands(500)).toBe(true)
        clock.at = 60_000
        expect(watch.lands(500)).toBe(false)
    })
    test("uses the slowest march seen, per tile", () => {
        const { watch } = start(() => ({ EID, RS: 100 }))
        watch.learn(60, 30)
        watch.learn(30, 30)
        expect(watch.lands(49)).toBe(true)
        expect(watch.lands(50)).toBe(false)
    })
})
