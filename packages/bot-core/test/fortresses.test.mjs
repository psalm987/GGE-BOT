import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { fortress, castleAt, melee, ranged } = require("./harness/army-bots.cjs")
const { loadModule } = require("./harness/load.cjs")

const inventory = () => [melee(601, 5000), ranged(603, 5000)]
const CAPITAL = 3

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

describe("the castle fortress attacks leave from", () => {
    const capital = () => castleAt(1, 7, 300, 280, { type: CAPITAL, name: "Sandreach", inventory: inventory() })

    test("a picked capital is where the map scan centres and the attack leaves from", async () => {
        const { cra, scans } = await fortress({ sourceCastle: { kingdom: 1, id: 7 } }, { inventory: inventory(), castles: [capital()] })
        expect([cra.SX, cra.SY]).toEqual([300, 280])
        expect(scans).toEqual([[300, 280]])
    })

    test("with no castle picked the attacks leave from the kingdom's castle", async () => {
        const { cra, scans } = await fortress({}, { inventory: inventory(), castles: [capital()] })
        expect([cra.SX, cra.SY]).toEqual([100, 100])
        expect(scans).toEqual([[100, 100]])
    })

    test("a picked castle the account no longer holds falls back to the kingdom's castle, logs it and says so", async () => {
        const { cra, statuses } = await fortress({ sourceCastle: { kingdom: 1, id: 99 } }, { inventory: inventory() })
        expect([cra.SX, cra.SY]).toEqual([100, 100])
        expect(console.warn).toHaveBeenCalledWith("towersSourceCastleGone", "100:100")
        expect(statuses).toContainEqual(expect.objectContaining({ reasonKey: "statusTowersCastleFallback", params: { castle: "100:100" } }))
    })

    test.each([["attackFortressesBurningSands", 1], ["attackFortressesEverWinterGlacier", 2], ["attackFortressesFirePeaks", 3]])(
        "%s offers its own kingdom's castles to pick from", (plugin, kingdom) => {
            const { pluginOptions } = loadModule(`plugins/attack/${plugin}.js`, { mainThread: true }).mod
            expect(pluginOptions.find(option => option.key == "sourceCastle")).toEqual({ type: "CastlePicker", key: "sourceCastle", kingdom, default: null })
        })
})
