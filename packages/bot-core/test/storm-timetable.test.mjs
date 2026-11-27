import { createRequire } from "node:module"
import { beforeEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")

beforeEach(() => {
    for (const level of ["warn", "info", "log", "debug"])
        vi.spyOn(console, level).mockImplementation(() => {})
})

/** A fort as the game's map shows it: [2] its type, [3] seconds of cooldown, [4] victories, [5] hidden. */
const mapFort = (x, y, type) => ({ type: 25, x, y, extraData: [0, 0, type, 0, 3, 0], timeSinceRequest: 0 })
/** A fort as gge-tracker lists it. Type 9 is an easy level 80 fort. */
const listed = (x, y, { isleID = 9, availableAt = Date.now() - 60_000, visible = true } = {}) =>
    ({ x, y, isleID, victories: 2, visible, availableAt, updatedAt: Date.now() - 120_000 })
const inventory = () => [melee(601, 5000, { meleeAttack: "90" }), ranged(603, 5000, { rangeAttack: "80" }), tool(614, 400, { wallBonus: "10" })]

/** The Storm forts plugin with one map fort at 105:100, and the runner answering the gge-tracker request with `answer`. */
async function storm(answer, game = {}) {
    const asks = []
    const askTracker = async request => (asks.push(request), answer(request))
    const run = await runEvent("attackStormForts", { commanderWhiteList: "1-99", allowLvl70Easy: true, allowLvl80Easy: true }, {
        inventory: inventory(), areas: [mapFort(105, 100, 9)], castle: { aqua: 0, getProductionData: { maxAmountAqua: 1_000_000 } },
        ...game, extra: { "../ggeTracker.js": { askTracker }, ...game.extra },
    })
    return { ...run, asks, targets: run.sent.map(cra => [cra.TX, cra.TY]) }
}
const timetable = (...forts) => () => ({ ok: true, kind: "stormForts", server: "IN1", fetchedAt: Date.now(), forts })

test("with the timetable the plugin asks for the Storm forts and attacks from that list instead of the map", async () => {
    const { asks, targets } = await storm(timetable(listed(300, 300)))
    expect(asks).toEqual([{ kind: "stormForts" }])
    expect(targets).toEqual([[300, 300]])
})

test("a fort the timetable gives a later time, or of a level the player didn't tick, is not attacked", async () => {
    const { targets } = await storm(timetable(listed(300, 300, { availableAt: Date.now() + 3600_000 }), listed(310, 310, { isleID: 12 })), { wait: 30 })
    expect(targets).toEqual([])
})

test("a fort the attack screen shows still cooling down is not attacked, whatever the timetable says", async () => {
    const coolingOnScreen = async (castle, areaInfo, kingdomID, commander) => {
        areaInfo.extraData[3] = 3600
        areaInfo.timeSinceRequest = Date.now()
        return commander
    }
    const { targets } = await storm(timetable(listed(300, 300)), { openAttackScreen: coolingOnScreen, wait: 30 })
    expect(targets).toEqual([])
})

test("a fort the timetable lists that the map doesn't show yet is looked at, then left alone for a while, not looked at on every pass", async () => {
    let looks = 0
    const hidden = listed(300, 300, { visible: false })
    const { targets } = await storm(timetable(hidden), { sends: 5, wait: 30, lookAt: () => (looks++, { result: 0, areaInfo: { extraData: [0, 0, 9, 0, 2, 1], timeSinceRequest: Date.now() } }) })
    expect(targets).toEqual([])
    expect(looks).toBe(1)
})

test.each([["off"], ["unavailable"], ["noServer"], ["noAnswer"]])("with no timetable (%s) the plugin scans the map as before", async error => {
    const { targets } = await storm(() => ({ ok: false, error }))
    expect(targets).toEqual([[105, 100]])
})
