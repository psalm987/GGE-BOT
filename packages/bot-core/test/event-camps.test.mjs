import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { parseTarget, campQueue, campTargetOptions } = require("../eventCamps.js")

const camp = (x, y, wait = 0, type = 27) => ({ type, x, y, extraData: [0, 0, wait, 0, 0, 5, 0], timeSinceRequest: Date.now() })
const items = { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50" }] }
const inventory = () => [
    melee(601, 900, { meleeAttack: "90" }),
    melee(602, 900, { meleeAttack: "140", foodSupply: undefined, meadSupply: "2" }),
    ranged(603, 900, { rangeAttack: "80" }),
    tool(614, 400, { wallBonus: "10" }),
]
const nomads = (options, game) => runEvent("attackNomads", { commanderWhiteList: "1-99", useFood: true, ...options }, { inventory: inventory(), start: { EDID: 3 }, items, ...game })
const samurai = (options, game) => runEvent("attackSamurai", { commanderWhiteList: "1-99", ...options }, { inventory: inventory(), start: { EDID: 3 }, items, ...game })
const targets = sent => sent.map(cra => [cra.TX, cra.TY])
const soldiers = cra => new Set([...cra.A.flatMap(wave => [...wave.L.U, ...wave.M.U, ...wave.R.U]), ...cra.RW].map(([wodID]) => wodID).filter(wodID => wodID != -1))

describe("a camp plugin's target", () => {
    test("a record stored before the target options cycles the camps with skips and no budget", () => {
        expect(parseTarget({})).toEqual({ mode: "cycleSkips", skips: true, at: undefined, skipBudget: 0 })
        expect(campTargetOptions().find(option => option.key == "targetMode").default).toBe(0)
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
    test("a march home brings the camp's new wait", () => {
        const area = { x: 1, y: 1, extraData: [0, 0, 0], timeSinceRequest: 1000 }
        const queue = campQueue(parseTarget({ targetMode: 1 }), [area])
        queue.update({ x: 1, y: 1, extraData: [0, 1, 900], timeSinceRequest: 5000 })
        expect(queue.pick([], 6000)).toBeUndefined()
        expect(queue.nextReadyAt()).toBe(905_000)
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

    test("troop supply and unit order choose the autofill's troops", async () => {
        const mead = await run({ supply: 2 }, { areas: [camp(110, 105, 0, type)] })
        expect([...soldiers(mead.cra)]).toEqual([602])
        const strongest = await run({ unitOrder: 2 }, { areas: [camp(110, 105, 0, type)] })
        expect(strongest.cra.A[1].L.U[0][0]).toBe(602)
    })
})
