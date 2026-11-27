import { createRequire } from "node:module"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { fortressBot } = require("./harness/fortress-bot.cjs")

beforeEach(() => {
    vi.useFakeTimers()
    for (const level of ["warn", "info", "log", "debug"])
        vi.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const cras = bot => bot.sent.filter(([cmd]) => cmd == "cra").map(([, cra]) => [cra.TX, cra.TY])
const FIVE_DAYS = 5 * 24 * 3600
/** A runner answer with these fortresses, as gge-tracker lists them. */
const listing = (...fortresses) => () => ({ ok: true, kind: "fortresses", server: "IN1", fetchedAt: Date.now(), withName: false, fortresses })
/** Far beyond the 50 tiles the map scan covers around the castle at 600:600. */
const far = { x: 900, y: 900 }

test("with the timetable the plugin asks for its kingdom's list, attacks from it, and does not scan the map", async () => {
    const { bot, log } = fortressBot({ fortresses: [{ x: 620, y: 590 }, far], timetable: listing({ ...far, availableAt: Date.now() - 60_000 }) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(log).toContain(`ask ${JSON.stringify({ kind: "fortresses", kingdom: 1 })}`)
    expect(log).not.toContain("scan 50")
    expect(cras(bot)).toEqual([[far.x, far.y]])
})

test("each timetable fortress is looked at in the game before its attack", async () => {
    const { log } = fortressBot({ fortresses: [far], timetable: listing({ ...far, availableAt: Date.now() - 60_000 }) })
    await vi.advanceTimersByTimeAsync(60_000)
    const look = log.indexOf(`look ${far.x}:${far.y}`)
    expect(look).toBeGreaterThanOrEqual(0)
    expect(look).toBeLessThan(log.indexOf("send cra"))
})

test("a fortress the timetable gives a later time is left alone until then", async () => {
    const { bot, log } = fortressBot({ fortresses: [far], timetable: listing({ ...far, availableAt: Date.now() + 20 * 60_000 }) })
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(log).not.toContain(`look ${far.x}:${far.y}`)
    expect(cras(bot)).toEqual([])
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(cras(bot)).toEqual([[far.x, far.y]])
})

test("when the game shows a timetable fortress still cooling down it is not attacked", async () => {
    const { bot, log } = fortressBot({ fortresses: [{ ...far, wait: 3600 }], timetable: listing({ ...far, availableAt: Date.now() - 60_000 }) })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(log).toContain(`look ${far.x}:${far.y}`)
    expect(cras(bot)).toEqual([])
})

test("the player's own cooldown still holds a fortress the timetable keeps listing as free", async () => {
    const { bot, marchHome } = fortressBot({
        items: { bossdungeons: [{ kID: "1", playerCooldownDelay: String(FIVE_DAYS) }] },
        fortresses: [far], timetable: listing({ ...far, availableAt: Date.now() - 60_000 }),
    })
    await vi.advanceTimersByTimeAsync(60_000)
    marchHome(0)
    await vi.advanceTimersByTimeAsync(6 * 3600_000)
    expect(cras(bot)).toEqual([[far.x, far.y]])
})

test.each([["off"], ["unavailable"], ["noServer"], ["noAnswer"]])("with no timetable (%s) the plugin scans the map around the castle as before", async error => {
    const { bot, log } = fortressBot({ fortresses: [{ x: 620, y: 590 }, far], timetable: () => ({ ok: false, error }) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(log).toContain("scan 50")
    expect(cras(bot)).toEqual([[620, 590]])
})

test("when the timetable stops answering later, the plugin goes back to the map", async () => {
    let answer = listing({ ...far, availableAt: Date.now() - 60_000 })
    const { bot, log, marchHome } = fortressBot({
        items: { bossdungeons: [{ kID: "1", playerCooldownDelay: String(FIVE_DAYS) }] },
        fortresses: [{ x: 620, y: 590 }, far], timetable: request => answer(request),
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cras(bot)).toEqual([[far.x, far.y]])
    answer = () => ({ ok: false, error: "unavailable" })
    marchHome(0)
    await vi.advanceTimersByTimeAsync(40 * 60_000)
    expect(log).toContain("scan 50")
    expect(cras(bot)).toContainEqual([620, 590])
})
