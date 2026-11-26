import { createRequire } from "node:module"
import { afterEach, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { melee, ranged, tool, unit, fortress } = require("./harness/army-bots.cjs")
const { runEvent } = require("./harness/event-bots.cjs")

afterEach(() => vi.restoreAllMocks())

const troops = () => [melee(601, 5000, { meleeAttack: "90" }), ranged(603, 5000, { rangeAttack: "80" })]
const eventTool = (wodID, info) => unit(wodID, 500, { fightType: 0, typ: "Attack", slotTypes: "1,2,9", ...info })

const EVENT_PLUGINS = {
    attackKhan: game => runEvent("attackKhan", { commanderWhiteList: "1-99", useFood: true }, {
        inventory: [...troops(), eventTool(563, { ragePointBonus: "2" }), eventTool(164, { khanTabletBooster: "6" })],
        areas: [{ type: 35, x: 110, y: 105, extraData: [0, 0, 0, 0, 0, 0, 5] }], start: { EDID: 3 },
        items: { eventAutoScalingCamps: [{ eventAutoScalingCampID: 5, camplevel: "50", playerRageCap: "1500" }] }, ...game,
    }),
    attackBerimondInvasion: game => runEvent("attackBerimondInvasion", { commanderWhiteList: "1-99" }, {
        inventory: [...troops(), eventTool(901, { pointBonus: "4" })], areas: [{ type: 30, x: 110, y: 105, extraData: [0, 12, 0, 0, -410, 0, 100] }], ...game,
    }),
    attackStormForts: game => runEvent("attackStormForts", { commanderWhiteList: "1-99", allowLvl70Easy: true, allowLvl80Easy: true }, {
        inventory: [...troops(), tool(614, 400, { wallBonus: "10" })], areas: [{ type: 25, x: 105, y: 100, extraData: [0, 0, 8, 0, 3, 0], timeSinceRequest: 0 }],
        castle: { aqua: 0, getProductionData: { maxAmountAqua: 1_000_000 } }, ...game,
    }),
}

/** A game at the account's daily cap until `full` is turned off, and the waits the plugin and the engine sleep. */
function dailyCap() {
    const cap = { full: true, waits: [] }
    cap.waitToAttack = async job => {
        if (cap.full)
            throw "ATTACK_LIMIT_REACHED"
        return job()
    }
    cap.extra = { "pacing.js": { pause: async () => {}, sleep: async ms => { cap.waits.push(ms); await new Promise(resolve => setTimeout(resolve, 2)) }, boxMullerRandom: () => 0 } }
    return cap
}

const atCap = { state: "waiting", reasonKey: "statusTowersLimitAccount", params: { cap: 3500, minutes: 5 } }

test.each(Object.keys(EVENT_PLUGINS))("%s waits out the account's daily cap and attacks again once there is room", async plugin => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    const cap = dailyCap()
    const { sent, statuses } = await EVENT_PLUGINS[plugin]({ sends: 50, wait: 15, waitToAttack: cap.waitToAttack, extra: cap.extra })
    expect(sent).toEqual([])
    expect(cap.waits.filter(ms => ms == 5 * 60_000).length).toBeGreaterThan(1)
    expect(statuses).toContainEqual(expect.objectContaining(atCap))
    expect(statuses.map(s => s.state)).not.toContain("stopped")
    cap.full = false
    for (let i = 0; i < 200 && !sent.length; i++)
        await new Promise(resolve => setTimeout(resolve, 1))
    expect(sent.length).toBeGreaterThan(0)
    expect(statuses.at(-1)).toMatchObject({ state: "running" })
})

test("Fortresses wait out the account's daily cap and attack again once there is room", async () => {
    const cap = dailyCap()
    let refusals = 2
    const waitToAttack = job => refusals-- > 0 ? cap.waitToAttack(job) : job()
    const { cra, stopped, statuses } = await fortress({ commanderWhiteList: "1-99" }, { inventory: troops(), commanders: 1, waitToAttack, extra: cap.extra })
    expect(stopped).toEqual([])
    expect(cap.waits).toEqual([5 * 60_000, 5 * 60_000])
    expect(statuses).toContainEqual(expect.objectContaining(atCap))
    expect(cra).toBeDefined()
    expect(statuses.at(-1)).toMatchObject({ state: "running" })
})
