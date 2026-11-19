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
