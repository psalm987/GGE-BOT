import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"
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

    test("Waves sends the written plan", async () => {
        const slot = (item, amount) => ({ item, amount })
        const none = { kind: "preset", preset: 0 }
        const first = { kind: "custom", left: { tools: [slot(901, 5), null], units: [slot(603, 40), null] }, front: { tools: [null, null, null], units: [null, null, null, null, null, null] }, right: { tools: [null, null], units: [null, null] } }
        const { cra } = await berimond({ armyMode: "waves", waves: { kind: "manual", waves: [first, none, none, none], ast: [null, null, null], rw: [null, null, null, null, null, null, null, null] } })
        expect(cra.A[0].L).toEqual({ T: [[901, 5], [-1, 0]], U: [[603, 40], [-1, 0]] })
        expect(cra.A.slice(1).some(hasTools)).toBe(false)
    })

    test("log only sends no attack and spends no skip", async () => {
        const { sent, skipped } = await berimond({ dryRun: true }, { areas: [{ ...camp(110, RED), extraData: [0, 12, 300, 0, RED, 0, 100] }], wait: 10 })
        expect([sent, skipped]).toEqual([[], []])
    })
})
