import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { parseTarget, campQueue, hitsBeforeCooldown, eventCampOptions, EVENT_PROFILES } = require("../eventCamps.js")
const { campAttackLine } = require("../attackLog.js")

const camp = (x, y, wait = 0, type = 27) => ({ type, x, y, extraData: [0, 0, wait, 0, 0, 5, 0], timeSinceRequest: Date.now() })
const items = { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50" }] }
const inventory = () => [
    melee(601, 900, { meleeAttack: "90" }),
    melee(602, 900, { meleeAttack: "140", foodSupply: undefined, meadSupply: "2" }),
    ranged(603, 900, { rangeAttack: "80" }),
    tool(614, 400, { wallBonus: "10" }),
]
const nomads = (options, game) => runEvent("attackNomads", { commanderWhiteList: "1-99", ...options }, { inventory: inventory(), start: { EDID: 3 }, items, ...game })
const samurai = (options, game) => runEvent("attackSamurai", { commanderWhiteList: "1-99", ...options }, { inventory: inventory(), start: { EDID: 3 }, items, ...game })
const targets = sent => sent.map(cra => [cra.TX, cra.TY])
const soldiers = cra => new Set([...cra.A.flatMap(wave => [...wave.L.U, ...wave.M.U, ...wave.R.U]), ...cra.RW].map(([wodID]) => wodID).filter(wodID => wodID != -1))

describe("a camp plugin's target", () => {
    test("a record stored before the target options cycles the camps with skips and no budget", () => {
        expect(parseTarget({})).toEqual({ mode: "cycleSkips", skips: true, at: undefined, skipBudget: 0 })
        expect(eventCampOptions(EVENT_PROFILES.nomad).find(option => option.key == "targetMode").default).toBe(0)
    })
    test("one camp needs both coordinates, on the map", () => {
        expect(parseTarget({ targetMode: 2, targetX: 640, targetY: 12 }).at).toEqual({ x: 640, y: 12 })
        expect(parseTarget({ targetMode: 2, targetX: 640 }).at).toBeUndefined()
        expect(parseTarget({ targetMode: 2, targetX: 640, targetY: 5000 }).at).toBeUndefined()
        expect(parseTarget({ targetMode: 1, targetX: 640, targetY: 12 }).at).toBeUndefined()
    })
    test("without skips the queue hands out only camps whose wait is over and that no march is heading for", () => {
        const now = 1_000_000
        const cooling = { x: 1, y: 1, extraData: [0, 0, 600], timeSinceRequest: now }
        const ready = { x: 2, y: 2, extraData: [0, 0, 0], timeSinceRequest: now }
        const queue = campQueue(parseTarget({ targetMode: 1 }), [cooling, ready])
        expect(queue.pick([], now)).toBe(ready)
        expect(queue.pick([{ targetAttack: { x: 2, y: 2 } }], now)).toBeUndefined()
        expect(queue.nextReadyAt()).toBe(now)
        expect(queue.pick([], now + 600_000)).toBe(cooling)
    })
    describe("several attacks in flight on a camp with no wait yet", () => {
        const row = (id, coolDown) => ({ eventAutoScalingCampID: String(id), eventID: "72", difficultyID: "310", areaType: "27", coolDown: String(coolDown) })
        const rows = [...Array.from({ length: 9 }, (_, i) => row(991 + i, 0)), row(1000, 5400), { ...row(992, 0), difficultyID: "320" }]
        test("a camp takes one hit for each camp with no wait from it on, and one more for the camp that starts the wait", () => {
            expect(hitsBeforeCooldown(rows, 991)).toBe(10)
            expect(hitsBeforeCooldown(rows, 999)).toBe(2)
            expect(hitsBeforeCooldown(rows, 1000)).toBe(1)
        })
        test("a camp with no row takes one hit", () => {
            expect(hitsBeforeCooldown(rows, 5)).toBe(1)
            expect(hitsBeforeCooldown([], 991)).toBe(1)
        })
        test("rows of another difficulty or event do not extend the run", () => {
            expect(hitsBeforeCooldown([row(991, 0), { ...row(992, 0), eventID: "80" }, { ...row(993, 0), areaType: "29" }], 991)).toBe(2)
        })
        test("a ready camp is picked while fewer marches head for it than its room", () => {
            const ready = { x: 2, y: 2, extraData: [0, 0, 0], timeSinceRequest: 0 }
            const queue = campQueue(parseTarget({ targetMode: 1 }), [ready], () => 3)
            const march = { targetAttack: { x: 2, y: 2 } }
            expect(queue.pick([march, march], 0)).toBe(ready)
            expect(queue.pick([march, march, march], 0)).toBeUndefined()
        })
        test("a camp's room is one by default", () => {
            const ready = { x: 2, y: 2, extraData: [0, 0, 0], timeSinceRequest: 0 }
            expect(campQueue(parseTarget({ targetMode: 1 }), [ready]).pick([{ targetAttack: { x: 2, y: 2 } }], 0)).toBeUndefined()
        })
    })
    test("a march home brings the camp's new wait", () => {
        const area = { x: 1, y: 1, extraData: [0, 0, 0], timeSinceRequest: 1000 }
        const queue = campQueue(parseTarget({ targetMode: 1 }), [area])
        queue.update({ x: 1, y: 1, extraData: [0, 1, 900], timeSinceRequest: 5000 })
        expect(queue.pick([], 6000)).toBeUndefined()
        expect(queue.nextReadyAt()).toBe(905_000)
    })
    test("a held camp is not handed out, with or without skips, until its hold ends", () => {
        const now = 1_000_000
        const first = { x: 1, y: 1, extraData: [0, 0, 600], timeSinceRequest: now }
        const second = { x: 2, y: 2, extraData: [0, 0, 0], timeSinceRequest: now }
        const skipping = campQueue(parseTarget({}), [first, second])
        skipping.hold(first, 5 * 60_000, now)
        expect(skipping.pick([], now)).toBe(second)
        expect(skipping.pick([], now)).toBe(second)
        expect(skipping.pick([], now + 5 * 60_000)).toBe(first)

        const waiting = campQueue(parseTarget({ targetMode: 1 }), [{ ...second }])
        waiting.hold(waiting.areas[0], 60_000, now)
        expect(waiting.pick([], now)).toBeUndefined()
        expect(waiting.nextReadyAt()).toBe(now + 60_000)
    })
    test("out of skips the queue falls back to camps that are ready on their own for 5 minutes, then may skip again", () => {
        const now = 1_000_000
        const cooling = { x: 1, y: 1, extraData: [0, 0, 600], timeSinceRequest: now }
        const ready = { x: 2, y: 2, extraData: [0, 0, 0], timeSinceRequest: now }
        const queue = campQueue(parseTarget({}), [cooling, ready])
        queue.outOfSkips(now)
        expect(queue.maySkip(now)).toBe(false)
        expect(queue.pick([], now)).toBe(ready)
        expect(queue.maySkip(now + 5 * 60_000)).toBe(true)
    })
    test("the skip budget counts skips over 24 hours", () => {
        const queue = campQueue(parseTarget({ skipBudgetPerDay: 2 }))
        const now = 1_000_000
        queue.skipped(now)
        expect(queue.maySkip(now)).toBe(true)
        queue.skipped(now)
        expect(queue.maySkip(now)).toBe(false)
        expect(queue.maySkip(now + 24 * 3_600_000)).toBe(true)
    })
})

describe.each([["Nomads", nomads, 27], ["Samurai", samurai, 29]])("%s", (_, run, type) => {
    test("as stored today: every camp in turn, skipping each wait", async () => {
        const { sent, skipped } = await run({}, { areas: [camp(110, 105, 300, type), camp(120, 100, 0, type)], sends: 2 })
        expect(targets(sent)).toEqual([[110, 105], [120, 100]])
        expect(skipped).toEqual(["MS3"])
    })

    test("every camp, no time skips: a waiting camp is left alone and no skip is spent", async () => {
        const { sent, skipped } = await run({ targetMode: 1 }, { areas: [camp(110, 105, 300, type), camp(120, 100, 0, type)] })
        expect(targets(sent)).toEqual([[120, 100]])
        expect(skipped).toEqual([])
    })

    test("camps are attacked from the lowest camp id up, the nearer camp first among equals", async () => {
        const withID = (area, id) => ({ ...area, extraData: area.extraData.with(5, id).with(6, 99 - id) })
        const areas = [withID(camp(110, 105, 0, type), 7), withID(camp(130, 100, 0, type), 5), withID(camp(120, 100, 0, type), 5)]
        const rows = { eventAutoScalingCamps: [5, 7].map(id => ({ eventAutoScalingCampID: id, camplevel: "50" })) }
        const { sent } = await run({ targetMode: 1 }, { areas, sends: 2, items: rows })
        expect(targets(sent)).toEqual([[120, 100], [130, 100]])
    })

    test("every camp, no time skips: with every camp waiting it reports when the next one is ready", async () => {
        const { sent, statuses } = await run({ targetMode: 1 }, { areas: [camp(110, 105, 300, type)], wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusCampsCooling", params: { minutes: 5 } })
    })

    test("one camp: it asks for the camp's map box, attacks only that camp and skips its wait", async () => {
        const { sent, skipped, requests } = await run({ targetMode: 2, targetX: 120, targetY: 100 }, { areas: [camp(110, 105, 0, type), camp(120, 100, 300, type)], sends: 2 })
        expect(requests).toEqual([[117, 91, 129, 103]])
        expect(targets(sent)).toEqual([[120, 100], [120, 100]])
        expect(skipped).toEqual(["MS3"])
    })

    test("one camp: a tile without a camp of this event stops the plugin with the reason", async () => {
        const { sent, statuses } = await run({ targetMode: 2, targetX: 300, targetY: 300 }, { areas: [camp(110, 105, 0, type)], wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusCampTargetNotFound", params: { x: 300, y: 300 } })
    })

    test("one camp: missing coordinates ask nothing of the game", async () => {
        const { sent, statuses, requests } = await run({ targetMode: 2 }, { areas: [camp(110, 105, 0, type)], wait: 10 })
        expect([sent, requests]).toEqual([[], []])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusCampTargetNotSet" })
    })

    test("a used skip budget makes the plugin wait for the camp instead", async () => {
        const marching = [{ kingdomID: 0, targetAttack: { x: 110, y: 105 } }]
        const { sent, skipped } = await run({ skipBudgetPerDay: 1 }, { areas: [camp(110, 105, 300, type), camp(120, 100, 300, type)], movements: marching, sends: 2, wait: 15 })
        expect(skipped).toEqual(["MS3"])
        expect(targets(sent)).toEqual([[110, 105]])
    })

    test("out of skips the plugin does not stop: it attacks a camp that is ready on its own", async () => {
        const { sent, statuses } = await run({}, { areas: [camp(110, 105, 300, type), camp(120, 100, 0, type)], spendSkip: () => undefined, wait: 20 })
        expect(targets(sent)).toEqual([[120, 100]])
        expect(statuses.map(status => status.state)).not.toContain("stopped")
    })

    test("a refused skip sends no attack to the camp still cooling down", async () => {
        const { sent, skipped } = await run({}, { areas: [camp(110, 105, 300, type)], skipRefusal: () => 95, wait: 20 })
        expect(skipped).toEqual(["MS3"])
        expect(sent).toEqual([])
    })

    test("an attack screen that still shows the camp's wait sends no attack", async () => {
        const openAttackScreen = async (castle, areaInfo, kingdomID, commander) => {
            areaInfo.extraData = [0, 0, 600, 0, 0, 5, 0]
            areaInfo.timeSinceRequest = Date.now()
            return commander
        }
        const { sent } = await run({ targetMode: 1 }, { areas: [camp(110, 105, 0, type)], openAttackScreen, wait: 20 })
        expect(sent).toEqual([])
    })

    test.each(["WONT_REACH_IN_TIME", "NOT_ENOUGH_CURRENCY1", "ATTACK_SCREEN_REFUSED"])("%s does not stop the plugin", async refusal => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.spyOn(console, "error").mockImplementation(() => {})
        let first = true
        const sendRefusal = () => first ? (first = false, refusal) : undefined
        const { sent, refused, statuses } = await run({ targetMode: 1 }, { areas: [camp(110, 105, 0, type), camp(120, 100, 0, type)], sendRefusal, sends: 2, wait: 30 })
        expect(refused).toEqual([refusal])
        expect(sent.length).toBeGreaterThan(0)
        expect(statuses.map(status => status.state)).not.toContain("stopped")
        expect(console.error).not.toHaveBeenCalled()
    })

    test("log only sends no attack and spends no skip", async () => {
        const { sent, skipped } = await run({ dryRun: true }, { areas: [camp(110, 105, 300, type)], wait: 10 })
        expect([sent, skipped]).toEqual([[], []])
    })

    test("Waves sends the written plan and nothing else", async () => {
        const slot = (item, amount) => ({ item, amount })
        const none = { kind: "preset", preset: 0 }
        const first = { kind: "custom", left: { tools: [slot(614, 10), null], units: [slot(603, 40), null] }, front: { tools: [null, null, null], units: [slot(601, 100), null, null, null, null, null] }, right: { tools: [null, null], units: [null, null] } }
        const waves = { kind: "manual", waves: [first, none, none, none], ast: [null, null, null], rw: [slot(602, 50), null, null, null, null, null, null, null] }
        const { cra } = await run({ armyMode: "waves", waves }, { areas: [camp(110, 105, 0, type)] })
        expect(cra.A[0].L).toEqual({ T: [[614, 10], [-1, 0]], U: [[603, 40], [-1, 0]] })
        expect(cra.A[0].M.U[0]).toEqual([601, 100])
        expect(cra.A.slice(1).flatMap(wave => [...wave.L.U, ...wave.M.U, ...wave.R.U]).every(([wodID]) => wodID == -1)).toBe(true)
        expect(cra.RW[0]).toEqual([602, 50])
    })

    test("Waves with no plan stops with the reason and scans nothing", async () => {
        const { sent, statuses, requests } = await run({ armyMode: "waves" }, { areas: [camp(110, 105, 0, type)], wait: 10 })
        expect([sent, requests]).toEqual([[], []])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusArmyNoPlan" })
    })

    test("a march home and the attack loop spend one skip between them on the camp they share", async () => {
        const movementEvents = new EventEmitter()
        const home = { targetOwner: { ownerID: 7 }, sourceAttack: camp(120, 100, 300, type) }
        const waitToAttack = async job => {
            movementEvents.emit("returning", home)
            return job()
        }
        const { sent, skipped } = await run({ targetMode: 2, targetX: 120, targetY: 100 }, {
            areas: [camp(120, 100, 300, type)], movementEvents, waitToAttack, skipLands: () => new Promise(resolve => setTimeout(resolve, 2)),
        })
        expect(skipped).toEqual(["MS3"])
        expect(sent).toHaveLength(1)
    })

    test("running out of skips after a march home goes to the plugin's log", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const movementEvents = new EventEmitter()
        await run({}, { areas: [camp(110, 105, 0, type)], movementEvents, spendSkip: () => undefined })
        movementEvents.emit("returning", { targetOwner: { ownerID: 7 }, sourceAttack: camp(110, 105, 300, type) })
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(warn).toHaveBeenCalledWith("campOutOfSkips")
        warn.mockRestore()
    })

    test("troop supply and unit order choose the autofill's troops", async () => {
        const mead = await run({ supply: 2 }, { areas: [camp(110, 105, 0, type)] })
        expect([...soldiers(mead.cra)]).toEqual([602])
        const strongest = await run({ unitOrder: 2 }, { areas: [camp(110, 105, 0, type)] })
        expect(strongest.cra.A[1].L.U[0][0]).toBe(602)
    })

    test("the stored food switches send the troops of the troop supply they read as", async () => {
        const food = await run({ foodTroopsOnly: true }, { areas: [camp(110, 105, 0, type)] })
        expect([...soldiers(food.cra)].sort()).toEqual([601, 603])
        const mead = await run({ useFood: false }, { areas: [camp(110, 105, 0, type)] })
        expect([...soldiers(mead.cra)]).toEqual([602])
    })
})

const toolsOf = wave => [...wave.L.T, ...wave.M.T, ...wave.R.T].filter(([wodID]) => wodID != -1)
const troopsOf = side => side.U.filter(([wodID]) => wodID != -1)
const reasons = statuses => statuses.map(status => status.reasonKey)
const boosters = { attackNomads: "khanTabletBooster", attackSamurai: "samuraiTokenBooster" }

describe.each([["Nomads", nomads, 27, "attackNomads"], ["Samurai", samurai, 29, "attackSamurai"]])("%s, the Event Camp options", (_, run, type, plugin) => {
    const one = () => [camp(110, 105, 0, type)]
    /** A castle with wall tools, an event wall tool and an event booster, so every tools choice has something to send. */
    const stocked = () => [...inventory(), unit(740, 40, { fightType: 0, typ: "Attack", usageEventID: "5,72", slotTypes: "1,2,9", [boosters[plugin]]: "3", wallBonus: "25" }),
        unit(162, 60, { fightType: 0, typ: "Attack", usageEventID: "5,72", slotTypes: "1,2,9", [boosters[plugin]]: "4" })]
    afterEach(() => vi.restoreAllMocks())

    test("a record with none of the new options sends what the same record sent before, and the old keys read as the new choices", async () => {
        const game = () => ({ areas: one(), inventory: stocked() })
        const old = await run({ noChests: true, useFeather: true }, game())
        const now = await run({ tools: 1, horse: 2 }, game())
        expect(now.cra).toEqual(old.cra)
        const everySide = await run({ attackLeft: true, attackMiddle: true, attackRight: true, attackCourtyard: true, attackWaves: 0, minTroops: 0, tools: 2, horse: 0, attacksPerRun: 0 }, game())
        expect(everySide.cra).toEqual((await run({}, game())).cra)
    })

    test("source castle: attacks leave from the castle that was picked", async () => {
        const outpost = { id: 55, kingdomID: 0, areaInfo: { type: 4, x: 200, y: 200, extraData: [] }, unlockedHorses: [1, 2], unitInventory: inventory() }
        const { cra, statuses } = await run({ sourceCastle: { kingdom: 0, id: 55 } }, { areas: one(), castles: [outpost] })
        expect([cra.SX, cra.SY]).toEqual([200, 200])
        expect(statuses.find(status => status.reasonKey == "statusCampsAttacking").params.castle).toBe("200:200")
        expect(cra).toMatchSnapshot()
    })

    test("source castle: a castle that is gone falls back to the main castle and says so", async () => {
        const { cra, statuses } = await run({ sourceCastle: { kingdom: 0, id: 999 } }, { areas: one() })
        expect([cra.SX, cra.SY]).toEqual([100, 100])
        expect(statuses).toContainEqual(expect.objectContaining({ state: "waiting", reasonKey: "statusCampCastleFallback", params: { castle: "100:100" } }))
    })

    test("waves: the attack sends as many as were chosen", async () => {
        expect((await run({ attackWaves: 2 }, { areas: one() })).cra.A).toHaveLength(2)
        expect((await run({ attackWaves: 1 }, { areas: one() })).cra.A).toHaveLength(1)
        expect((await run({}, { areas: one() })).cra.A.length).toBeGreaterThan(2)
    })

    test("sides: only the ticked sides are filled, and all three off fills every side", async () => {
        const { cra } = await run({ attackLeft: true, attackMiddle: false, attackRight: false, attackCourtyard: false }, { areas: one(), inventory: stocked() })
        for (const wave of cra.A) {
            expect(troopsOf(wave.L).length).toBeGreaterThan(0)
            expect([...troopsOf(wave.M), ...troopsOf(wave.R), ...wave.M.T.filter(([wodID]) => wodID != -1), ...wave.R.T.filter(([wodID]) => wodID != -1)]).toEqual([])
        }
        expect(cra.RW.every(([wodID]) => wodID == -1)).toBe(true)
        expect(cra).toMatchSnapshot()
        const front = await run({ attackMiddle: true, attackCourtyard: true }, { areas: one() })
        expect(troopsOf(front.cra.A[0].L)).toEqual([])
        expect(front.cra.RW.some(([wodID]) => wodID != -1)).toBe(true)
        const allOff = await run({ attackLeft: false, attackMiddle: false, attackRight: false, attackCourtyard: false }, { areas: one() })
        expect(allOff.cra).toEqual((await run({}, { areas: one() })).cra)
    })

    test("tools: No tools sends troops only, and Wave 1 tools only keeps the boosters at home", async () => {
        const none = await run({ tools: 0 }, { areas: one(), inventory: stocked() })
        expect(none.cra.A.flatMap(toolsOf)).toEqual([])
        expect(none.cra).toMatchSnapshot()
        const firstWave = await run({ tools: 1 }, { areas: one(), inventory: stocked() })
        expect(toolsOf(firstWave.cra.A[0]).length).toBeGreaterThan(0)
        expect(firstWave.cra.A.slice(1).flatMap(toolsOf)).toEqual([])
        const all = await run({ tools: 2 }, { areas: one(), inventory: stocked() })
        expect(all.cra.A.slice(1).flatMap(toolsOf).map(([wodID]) => wodID)).toContain(162)
    })

    test("minimum troops: below it the plugin waits and names the floor, and it never lowers the built-in floor", async () => {
        const high = await run({ minTroops: 5000 }, { areas: one(), wait: 10 })
        expect(high.sent).toEqual([])
        expect(high.statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusCampNoTroops", params: { castle: "100:100", floor: 5000 } })
        const few = [melee(601, 90, { meleeAttack: "90" })]
        const low = await run({ minTroops: 50 }, { areas: one(), inventory: few, wait: 10 })
        expect(low.sent).toEqual([])
        expect(low.statuses.at(-1)).toMatchObject({ reasonKey: "statusCampNoTroops", params: { floor: 100 } })
        expect((await run({ minTroops: 2000 }, { areas: one() })).sent).toHaveLength(1)
    })

    test("horse by distance: the coin horse to a near camp, a feather to a far one, and the coin horse again with no feathers", async () => {
        const near = await run({ horse: 3, horseDistance: 50 }, { areas: one() })
        expect([near.cra.HBW, near.cra.PTT]).toEqual([1, 0])
        const far = await run({ horse: 3, horseDistance: 5 }, { areas: one() })
        expect([far.cra.HBW, far.cra.PTT]).toEqual([-1, 1])
        expect(far.cra).toMatchSnapshot()
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const none = await run({ horse: 3, horseDistance: 5 }, { areas: one(), resources: { pegasusTicket: 0 } })
        expect([none.cra.HBW, none.cra.PTT]).toEqual([1, 0])
        expect(warn).toHaveBeenCalledWith("campNoFeathers")
    })

    test("horse: the Select's coin horse and feather ride as the old checkboxes did", async () => {
        expect((await run({ horse: 1 }, { areas: one() })).cra).toEqual((await run({ useCoin: true }, { areas: one() })).cra)
        expect((await run({ horse: 2 }, { areas: one() })).cra.PTT).toBe(1)
        expect((await run({ horse: 0 }, { areas: one() })).cra).toMatchObject({ HBW: -1, PTT: 0 })
    })

    test("attacks per run: the plugin stops after that many and says why", async () => {
        const areas = [camp(110, 105, 0, type), camp(120, 100, 0, type), camp(130, 100, 0, type)]
        const { sent, statuses } = await run({ attacksPerRun: 2 }, { areas, sends: 5, wait: 20 })
        expect(sent).toHaveLength(2)
        expect(statuses.at(-1)).toMatchObject({ state: "stopped", reasonKey: "statusCampRunLimit", params: { limit: 2 } })
        expect(statuses).toContainEqual(expect.objectContaining({ reasonKey: "statusCampsAttacking", params: { found: 3, castle: "100:100", attacks: "1/2" } }))
    })

    test("attacks per run counts the attacks Log only builds", async () => {
        const { sent, statuses } = await run({ attacksPerRun: 1, dryRun: true }, { areas: one(), sends: 3, wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "stopped", reasonKey: "statusCampRunLimit", params: { limit: 1 } })
    })

    test("the account's daily cap makes the plugin wait with the status, and the next attack goes once there is room", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        let full = true
        const waits = []
        const waitToAttack = async job => {
            if (full)
                throw "ATTACK_LIMIT_REACHED"
            return job()
        }
        const slept = { "pacing.js": { pause: async () => {}, sleep: async ms => { waits.push(ms); await new Promise(resolve => setTimeout(resolve, 2)) }, boxMullerRandom: () => 0 } }
        const game = run({}, { areas: one(), sends: 50, wait: 15, waitToAttack, extra: slept })
        const { sent, statuses } = await game
        expect(sent).toEqual([])
        expect(waits.length).toBeGreaterThan(1)
        expect(waits[0]).toBe(5 * 60_000)
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusTowersLimitAccount", params: { minutes: 5 } })
        expect(statuses.map(s => s.state)).not.toContain("stopped")
        full = false
        for (let i = 0; i < 100 && !sent.length; i++)
            await new Promise(resolve => setTimeout(resolve, 1))
        expect(sent.length).toBeGreaterThan(0)
        expect(statuses.at(-1).state).not.toBe("stopped")
    })

    test("difficulty: keeping the game's own sets none, and waits while the event has none", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const unset = await run({ eventDifficulty: 12 }, { areas: one(), start: { EDID: -1 }, wait: 10 })
        expect([unset.sent, unset.frames, unset.requests]).toEqual([[], [], []])
        expect(unset.statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusCampDifficultyNotSet" })
        const set = await run({ eventDifficulty: 12 }, { areas: one() })
        expect(set.sent).toHaveLength(1)
        expect(set.frames.map(([command]) => command)).not.toContain("sede")
    })

    test("Skip mode: a tile that holds the other event's camp is named as such and nothing is attacked", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const other = type == 27 ? 29 : 27
        const { sent, statuses } = await run({ targetMode: 2, targetX: 110, targetY: 105 }, { areas: [camp(110, 105, 0, other)], wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "error", reasonKey: "statusCampTargetOtherEvent", params: { x: 110, y: 105 } })
    })

    test("status: it names the mode's target and the attacks of this run", async () => {
        const cycle = await run({}, { areas: [camp(110, 105, 0, type), camp(120, 100, 0, type)], sends: 2 })
        expect(cycle.statuses.filter(status => status.reasonKey == "statusCampsAttacking").map(status => status.params.attacks)).toEqual(["0", "1"])
        const single = await run({ targetMode: 2, targetX: 110, targetY: 105 }, { areas: one(), sends: 2 })
        expect(single.statuses).toContainEqual(expect.objectContaining({ state: "running", reasonKey: "statusCampAttackingOne", params: { x: 110, y: 105, castle: "100:100", attacks: "1" } }))
        expect(reasons(cycle.statuses).at(-1)).toBe("statusEventClosed")
    })

    test("log: one line for each attack, with the camp, the commander, the horse and the skips spent", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {})
        await run({ horse: 2 }, { areas: [camp(110, 105, 300, type)] })
        const line = info.mock.calls.find(([key]) => key == "hittingTargetAttack")
        expect(line).toEqual(["hittingTargetAttack", plugin == "attackNomads" ? "campOfNomads" : "campOfSamurai", " ", "C", 1, " ", 110, ":", 105, " ", "1m 0s", "tillImpactAttack", " · ", "horseFeather", " · ", "skipsSpentOnCamp", "10m"])
    })
})

describe("Samurai, setting the event difficulty", () => {
    const { eventAutoScalingDifficulties } = require("./fixtures/game-data/seed-rows.json")
    const { sede_1: sede } = require("./fixtures/protocol/samurai-20261121.json")
    const game = (answer, more = {}) => ({ areas: [camp(110, 105, 0, 29)], start: { EDID: -1 }, items: { ...items, eventAutoScalingDifficulties, ...more }, answer, wait: 10 })
    const replySede = reply => cmd => cmd == "sede" ? [reply.payload, reply.res] : undefined
    afterEach(() => vi.restoreAllMocks())

    test("sets the chosen difficulty as the player did, and attacks once the game accepts it", async () => {
        const { sent, frames } = await samurai({ eventDifficulty: 4 }, game(replySede(sede.reply)))
        expect(frames).toContainEqual(["sede", sede.payload])
        expect(sent).toHaveLength(1)
    })

    test("a difficulty the game refuses is not taken as set: nothing is attacked and the status says why", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        // The refusal code is not captured; 437 is the err table's INVALID_EVENT_DIFFICULTY_ID.
        const { sent, frames, statuses } = await samurai({ eventDifficulty: 5 }, game(replySede({ payload: "", res: 437 })))
        expect(frames).toContainEqual(["sede", { EID: 80, EDID: 205, C2U: 0 }])
        expect(sent).toEqual([])
        expect(warn).toHaveBeenCalledWith("campDifficultyRefused", "INVALID_EVENT_DIFFICULTY_ID")
        expect(statuses.at(-1)).toMatchObject({ state: "waiting", reasonKey: "statusCampDifficultyRefused" })
    })

    test("Classic, which has no difficulty to set, asks nothing of the game and attacks the classic camps", async () => {
        const { sent, frames } = await samurai({ eventDifficulty: 0 }, game(replySede(sede.reply), { samuraiCamps: [{ countVictory: "1" }] }))
        expect(frames.map(([command]) => command)).not.toContain("sede")
        expect(sent).toHaveLength(1)
    })
})

describe("the log line of a camp attack", () => {
    test("names each skip spent, or says none was", () => {
        expect(campAttackLine("campOfNomads", 3, 610, 600, "4m", { skips: ["MS3", "MS5"], horse: "coin" }).slice(-5)).toEqual([" · ", "horseCoin", " · ", "skipsSpentOnCamp", "10m+1h"])
        expect(campAttackLine("campOfNomads", 3, 610, 600, "4m", { skips: [], horse: "none" }).slice(-4)).toEqual([" · ", "horseNone", " · ", "noSkipsSpentOnCamp"])
    })
    test("every part a line can hold is in the catalog", () => {
        const en = require("../locales/en.json")
        const keys = ["campOfNomads", "campOfSamurai", "daimyoCastle", "horseNone", "horseCoin", "horseFeather", "skipsSpentOnCamp", "noSkipsSpentOnCamp"]
        expect(keys.filter(key => !(key in en))).toEqual([])
        expect(Object.values(EVENT_PROFILES).map(profile => profile.logName)).toEqual(["campOfNomads", "campOfSamurai", "daimyoCastle"])
    })
})
