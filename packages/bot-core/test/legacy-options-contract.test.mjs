import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"
import { readLegacy as contractsRead, effectivePluginConfig } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { loadModule } = require("./harness/load.cjs")
const { readLegacy } = require("../legacyOptions.js")

const plugin = file => loadModule(`plugins/attack/${file}.js`, { mainThread: true }).mod.pluginOptions
const green = plugin("attackBarronsGreatEmpire")
const fire = plugin("attackBarronsFirePeaks")

/** Records as the options were stored before the horse, tool and wave Selects, with the choices each one made. */
const STORED = [
    [{}, {}],
    [{ useFeather: true }, { horse: 2 }],
    [{ useFeather: true, useCoin: false }, { horse: 2 }],
    [{ useCoin: false }, { horse: 0 }],
    [{ useFeather: false, useCoin: true }, { horse: 1 }],
    [{ useWallTools: false }, { tools: 0 }],
    [{ useWallTools: false, useShields: true }, { tools: 0 }],
    [{ useShields: true }, { tools: 2 }],
    [{ useWallTools: true, useShields: false }, { tools: 1 }],
    [{ attackWaves: "" }, { attackWaves: 0 }],
    [{ attackWaves: "1" }, { attackWaves: 1 }],
    [{ attackWaves: "4" }, { attackWaves: 4 }],
    [{ attackWaves: "9" }, { attackWaves: 0 }],
    [{ attackWaves: 3, horse: 3, tools: 2 }, { attackWaves: 3, horse: 3, tools: 2 }],
    [{ horse: 0, useFeather: true }, { horse: 0 }],
    [{ useDogs: true, commanderWhiteList: "1-3", useCoin: false }, { useDogs: true, commanderWhiteList: "1-3", horse: 0 }],
    [{ supply: 0, foodTroopsOnly: true }, { supply: 1 }],
    [{ foodTroopsOnly: true }, { supply: 1 }],
    [{ foodTroopsOnly: false }, { supply: 0 }],
    [{ supply: 2, foodTroopsOnly: true }, { supply: 2 }],
    [{ supply: "2", foodTroopsOnly: true }, { supply: 2 }],
    [{ supply: 1, foodTroopsOnly: false }, { supply: 1 }],
    [{ supply: 2 }, { supply: 2 }],
    [{ attackWaves: 2, supply: 0, foodTroopsOnly: true, useFeather: true }, { attackWaves: 2, supply: 1, horse: 2 }],
]

describe("options stored before the horse, tool and wave Selects", () => {
    test.each(STORED)("%j reads as %j", (stored, read) => {
        expect(readLegacy(green, stored)).toEqual(read)
    })
    test.each(STORED)("the bot and the contracts read %j alike", stored => {
        expect(readLegacy(green, stored)).toEqual(contractsRead(green, stored))
        expect(readLegacy(fire, stored)).toEqual(contractsRead(fire, stored))
    })
    test("a record with none of the replaced options gets the Selects' defaults, which are what the old defaults meant", () => {
        const olds = { useFeather: false, useCoin: true, useWallTools: true, useShields: false }
        const entry = options => [{ key: "barons", force: false, hidden: false, options }]
        const read = (options, stored) => effectivePluginConfig(entry(options), { barons: { enabled: true, options: stored } }).barons
        for (const [options, waves] of [[green, "2"], [fire, ""]]) {
            const fromOld = read(options, { ...olds, attackWaves: waves })
            expect(read(options, {})).toEqual(fromOld)
            expect(fromOld).toMatchObject({ horse: 1, tools: 1, attackWaves: Number(waves) })
            expect(Object.keys(fromOld).filter(key => key in olds)).toEqual([])
        }
    })
    test("an old choice beats the Select's default on the way to the bot", () => {
        const config = effectivePluginConfig([{ key: "barons", force: false, hidden: false, options: green }], { barons: { enabled: true, options: { useFeather: true, attackWaves: "" } } })
        expect(config.barons).toMatchObject({ horse: 2, attackWaves: 0 })
    })
})

const nomads = plugin("attackNomads")
const samurai = plugin("attackSamurai")

/** Records as the event camp options were stored before the horse and tools Selects and the numeric score, with what each one reads as. */
const STORED_CAMPS = [
    [{}, {}],
    [{ noChests: true }, { tools: 1 }],
    [{ noChests: false }, { tools: 2 }],
    [{ tools: 0, noChests: true }, { tools: 0 }],
    [{ useFeather: true }, { horse: 2 }],
    [{ useCoin: true }, { horse: 1 }],
    [{ useCoin: true, useFeather: true }, { horse: 2 }],
    [{ useCoin: false }, { horse: 0 }],
    [{ horse: 3, useCoin: true }, { horse: 3 }],
    [{ scoreShutoff: "" }, {}],
    [{ scoreShutoff: "  " }, {}],
    [{ scoreShutoff: "5000" }, { scoreShutoff: 5000 }],
    [{ scoreShutoff: "five thousand" }, {}],
    [{ scoreShutoff: "-5" }, { scoreShutoff: 0 }],
    [{ scoreShutoff: "99999999999" }, { scoreShutoff: 999_999_999 }],
    [{ scoreShutoff: 700 }, { scoreShutoff: 700 }],
    [{ lowValueChests: true, foodTroopsOnly: true, noChests: true, useCoin: true, scoreShutoff: "120000" }, { lowValueChests: true, supply: 1, tools: 1, horse: 1, scoreShutoff: 120000 }],
    [{ supply: 0, foodTroopsOnly: true }, { supply: 1 }],
    [{ supply: 0, useFood: false }, { supply: 2 }],
    [{ useFood: false }, { supply: 2 }],
    [{ useFood: true }, { supply: 0 }],
    [{ supply: 2, foodTroopsOnly: true }, { supply: 2 }],
    [{ supply: 1, useFood: false }, { supply: 1 }],
    [{ foodTroopsOnly: true, useFood: false }, { supply: 1 }],
    [{ supply: 2, minTroops: 300 }, { supply: 2, minTroops: 300 }],
]

describe("event camp options stored before the horse and tools Selects and the numeric score", () => {
    test.each(STORED_CAMPS)("%j reads as %j", (stored, read) => {
        expect(readLegacy(nomads, stored)).toEqual(read)
        expect(readLegacy(samurai, stored)).toEqual(read)
    })
    test.each(STORED_CAMPS)("the bot and the contracts read %j alike", stored => {
        expect(readLegacy(nomads, stored)).toEqual(contractsRead(nomads, stored))
        expect(readLegacy(samurai, stored)).toEqual(contractsRead(samurai, stored))
    })
    test("a record with none of the replaced options gets defaults that mean what the old defaults did", () => {
        const entry = options => [{ key: "camps", force: false, hidden: false, options }]
        const read = (options, stored) => effectivePluginConfig(entry(options), { camps: { enabled: true, options: stored } }).camps
        for (const options of [nomads, samurai]) {
            const fromOld = read(options, { noChests: false, useFeather: false, useCoin: false, scoreShutoff: "" })
            expect(read(options, {})).toEqual(fromOld)
            expect(fromOld).toMatchObject({
                targetMode: 0, eventDifficulty: "4", horse: 0, tools: 2, attackWaves: 0, minTroops: 0, attacksPerRun: 0, scoreShutoff: 0,
                attackLeft: true, attackMiddle: true, attackRight: true, attackCourtyard: true, sourceCastle: null,
            })
            expect(Object.keys(fromOld).filter(key => ["noChests", "useFeather", "useCoin"].includes(key))).toEqual([])
        }
    })
    test("an old choice beats the new default on the way to the bot", () => {
        const config = effectivePluginConfig([{ key: "camps", force: false, hidden: false, options: nomads }], { camps: { enabled: true, options: { noChests: true, useFeather: true, scoreShutoff: "2500" } } })
        expect(config.camps).toMatchObject({ tools: 1, horse: 2, scoreShutoff: 2500 })
    })
    test("the food switches reach the bot as the troop supply they meant, and not as themselves", () => {
        const read = stored => effectivePluginConfig([{ key: "camps", force: false, hidden: false, options: nomads }], { camps: { enabled: true, options: stored } }).camps
        expect(read({ supply: 0, foodTroopsOnly: true })).toMatchObject({ supply: 1 })
        expect(read({ useFood: false })).toMatchObject({ supply: 2 })
        expect(read({ supply: 2, foodTroopsOnly: true })).toMatchObject({ supply: 2 })
        expect(read({})).toMatchObject({ supply: 0 })
        for (const stored of [{ foodTroopsOnly: true }, { useFood: false }])
            expect(Object.keys(read(stored)).filter(key => key in stored)).toEqual([])
    })
})

const armourer = loadModule("plugins/buyTools.js", { mainThread: true }).mod.pluginOptions

/** Armourer rows stored when a row named a kingdom, with what each reads as. */
const STORED_ROWS = [
    [{ targets: [{ kingdom: 0, tool: 614, stock: 5000 }] }, { targets: [{ tool: 614, stock: 5000, castle: { kingdom: 0, id: -1 } }] }],
    [{ targets: [{ kingdom: 3, tool: 611, stock: 10 }, { castle: { kingdom: 1, id: 20 }, tool: 614, stock: 7 }] }, { targets: [{ tool: 611, stock: 10, castle: { kingdom: 3, id: -1 } }, { castle: { kingdom: 1, id: 20 }, tool: 614, stock: 7 }] }],
    [{ targets: [] }, { targets: [] }],
    [{ margin: 100 }, { margin: 100 }],
    [{ targets: [{ tool: 614, stock: 7 }] }, { targets: [{ tool: 614, stock: 7 }] }],
]

describe("Armourer rows stored with a kingdom", () => {
    test.each(STORED_ROWS)("%j reads as %j", (stored, read) => {
        expect(readLegacy(armourer, stored)).toEqual(read)
    })
    test.each(STORED_ROWS)("the bot and the contracts read %j alike", stored => {
        expect(readLegacy(armourer, stored)).toEqual(contractsRead(armourer, stored))
    })
})
