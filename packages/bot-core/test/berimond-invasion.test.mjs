import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { describe, expect, test, vi } from "vitest"
import { readLegacy as contractsRead } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { melee, ranged, unit } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")
const { loadModule } = require("./harness/load.cjs")
const { readLegacy } = require("../legacyOptions.js")

const options = loadModule("plugins/attack/attackBerimondInvasion.js", { mainThread: true }).mod.pluginOptions
const RED = -411, BLUE = -410
const camp = (x, owner) => ({ type: 30, x, y: 105, extraData: [0, 12, 0, 0, owner, 0, 100] })
const inventory = () => [
    melee(601, 5000, { meleeAttack: "90" }), ranged(603, 5000, { rangeAttack: "80" }),
    unit(901, 500, { fightType: 0, typ: "Attack", slotTypes: "1,2,9", pointBonus: "4" }),
]
const berimond = (stored, game = {}) => runEvent("attackBerimondInvasion", { commanderWhiteList: "1-99", ...stored }, { inventory: inventory(), areas: [camp(110, BLUE), camp(120, RED)], ...game })
const hasTools = wave => [...wave.L.T, ...wave.R.T, ...wave.M.T].some(([wodID]) => wodID == 901)

describe("the Berimond invasion", () => {
    test.each([[{}, {}], [{ wavesTillChests: "4" }, { eventToolsFrom: 0 }], [{ wavesTillChests: "1" }, { eventToolsFrom: 0 }], [{ wavesTillChests: "2", eventToolsFrom: 2 }, { eventToolsFrom: 2 }]])(
        "the never-read wavesTillChests in %j reads as %j, for the bot and the contracts alike", (stored, read) => {
            expect(readLegacy(options, stored)).toEqual(read)
            expect(contractsRead(options, stored)).toEqual(read)
        })

    test.each([[0, [110, 120]], [1, [120, 120]], [2, [110, 110]]])("camp side %i attacks the camps at x = %j", async (campSide, xs) => {
        const { sent } = await berimond({ campSide }, { sends: 2 })
        expect(sent.map(cra => cra.TX)).toEqual(xs)
    })

    test("a side with no camp nearby stops the plugin with the reason", async () => {
        const { sent, statuses } = await berimond({ campSide: 1 }, { areas: [camp(110, BLUE)], wait: 10 })
        expect(sent).toEqual([])
        expect(statuses.at(-1)).toMatchObject({ state: "stopped", reasonKey: "statusCampsNoneOfSide" })
    })

    test("event tools start in the second wave unless a later wave is picked", async () => {
        expect((await berimond({})).cra.A.map(hasTools)).toEqual([false, true, true, true])
        expect((await berimond({ eventToolsFrom: 2 })).cra.A.map(hasTools)).toEqual([false, false, false, true])
    })

    test("the first wave carries the event's wall tools, and the waves before Event tools from carry none", async () => {
        const wallTool = unit(902, 500, { fightType: 0, typ: "Attack", slotTypes: "1,2,9", pointBonus: "4", wallBonus: "10" })
        const { cra } = await berimond({ eventToolsFrom: 2 }, { inventory: [...inventory(), wallTool] })
        const toolsOf = wave => [...wave.L.T, ...wave.R.T, ...wave.M.T].map(([wodID]) => wodID).filter(wodID => wodID != -1)
        expect(toolsOf(cra.A[0])).toContain(902)
        expect(cra.A.slice(1, 3).map(toolsOf)).toEqual([[], []])
    })

    test("Waves sends the written plan", async () => {
        const slot = (item, amount) => ({ item, amount })
        const none = { kind: "preset", preset: 0 }
        const first = { kind: "custom", left: { tools: [slot(901, 5), null], units: [slot(603, 40), null] }, front: { tools: [null, null, null], units: [null, null, null, null, null, null] }, right: { tools: [null, null], units: [null, null] } }
        const { cra } = await berimond({ armyMode: "waves", waves: { kind: "manual", waves: [first, none, none, none], ast: [null, null, null], rw: [null, null, null, null, null, null, null, null] } })
        expect(cra.A[0].L).toEqual({ T: [[901, 5], [-1, 0]], U: [[603, 40], [-1, 0]] })
        expect(cra.A.slice(1).some(hasTools)).toBe(false)
    })

    test("a march home and the attack loop spend one skip between them on the camp they share", async () => {
        const movementEvents = new EventEmitter()
        const area = { ...camp(110, RED), extraData: [0, 12, 300, 0, RED, 0, 100] }
        const waitToAttack = async job => {
            movementEvents.emit("returning", { targetOwner: { ownerID: 7 }, sourceAttack: area })
            return job()
        }
        const { sent, skipped } = await berimond({}, { areas: [area], movementEvents, waitToAttack, skipLands: () => new Promise(resolve => setTimeout(resolve, 2)) })
        expect(skipped).toEqual(["MS3"])
        expect(sent).toHaveLength(1)
    })

    test("running out of skips after a march home goes to the plugin's log", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const movementEvents = new EventEmitter()
        await berimond({}, { areas: [camp(110, RED)], movementEvents, spendSkip: () => undefined })
        movementEvents.emit("returning", { targetOwner: { ownerID: 7 }, sourceAttack: { ...camp(110, RED), extraData: [0, 12, 300, 0, RED, 0, 100] } })
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(warn).toHaveBeenCalledWith("campOutOfSkips")
        warn.mockRestore()
    })

    test("a picked capital is where the camps are looked for around and the attacks leave from", async () => {
        const capital = { id: 66, kingdomID: 0, areaInfo: { type: 3, x: 300, y: 310, extraData: [] }, unlockedHorses: [1, 2], unitInventory: inventory() }
        const scans = []
        const areasAround = async (get, kid, origin, wanted) => (scans.push([origin.x, origin.y]), [camp(110, BLUE)].filter(wanted))
        const { cra } = await berimond({ sourceCastle: { kingdom: 0, id: 66 } }, { castles: [capital], extra: { "mapScan.js": { areasAround } } })
        expect([cra.SX, cra.SY]).toEqual([300, 310])
        expect(scans).toEqual([[300, 310]])
    })

    test("a picked castle the account no longer holds falls back to the main castle, logs it and says so", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { cra, statuses } = await berimond({ sourceCastle: { kingdom: 0, id: 66 } })
        expect([cra.SX, cra.SY]).toEqual([100, 100])
        expect(warn).toHaveBeenCalledWith("campSourceCastleGone", "100:100")
        expect(statuses).toContainEqual(expect.objectContaining({ state: "running", reasonKey: "statusCampCastleFallback", params: { castle: "100:100" } }))
        warn.mockRestore()
    })

    test("log only sends no attack and spends no skip", async () => {
        const { sent, skipped } = await berimond({ dryRun: true }, { areas: [{ ...camp(110, RED), extraData: [0, 12, 300, 0, RED, 0, 100] }], wait: 10 })
        expect([sent, skipped]).toEqual([[], []])
    })
})

describe("camps that are not ready", () => {
    const cooling = (x, owner) => ({ ...camp(x, owner), extraData: [0, 12, 600, 0, owner, 0, 100], timeSinceRequest: Date.now() })
    const quiet = () => { vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}) }

    test("out of skips the plugin does not stop: it attacks the camp that is ready on its own", async () => {
        quiet()
        const { sent, statuses } = await berimond({}, { areas: [cooling(110, BLUE), camp(120, RED)], spendSkip: () => undefined, wait: 20 })
        expect(sent.map(cra => cra.TX)).toEqual([120])
        expect(statuses.map(status => status.state)).not.toContain("stopped")
        vi.restoreAllMocks()
    })

    test("a camp whose attack screen is refused is held while the plugin attacks the other", async () => {
        quiet()
        const openAttackScreen = async (castle, areaInfo, kingdomID, commander) => {
            if (areaInfo.x == 110)
                throw "ATTACK_SCREEN_REFUSED"
            return commander
        }
        // The refused attempt uses one of the three commanders the stand-in hands out.
        const { sent, statuses } = await berimond({}, { openAttackScreen, sends: 3, wait: 30 })
        expect(sent.map(cra => cra.TX)).toEqual([120, 120])
        expect(statuses.map(status => status.state)).not.toContain("stopped")
        vi.restoreAllMocks()
    })

    test.each(["NOT_ENOUGH_CURRENCY1", "WONT_REACH_IN_TIME"])("%s does not stop the plugin", async refusal => {
        quiet()
        let first = true
        const { refused, statuses } = await berimond({}, { sendRefusal: () => first ? (first = false, refusal) : undefined, sends: 2, wait: 20 })
        expect(refused).toEqual([refusal])
        expect(statuses.map(status => status.state)).not.toContain("stopped")
        expect(console.error).not.toHaveBeenCalled()
        vi.restoreAllMocks()
    })
})
