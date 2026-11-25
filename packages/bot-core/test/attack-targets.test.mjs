import { createRequire } from "node:module"
import { afterEach, describe, expect, test, vi } from "vitest"
import { emptyCustomWave, emptyPlan } from "@gge/contracts"

const require = createRequire(import.meta.url)
const { barons, melee, tool } = require("./harness/army-bots.cjs")
const { parseAllowedToAttack, allowsTarget, toolAllowedAt } = require("../attackTargets.js")
const { AreaType } = require("../areaTypes.js")
const { EVENT_PROFILES, eventCampTargets } = require("../eventCamps.js")

afterEach(() => vi.restoreAllMocks())

describe("reading allowedToAttack", () => {
    test("pairs are kingdom+areaType joined by #, and no value means no limit", () => {
        expect(parseAllowedToAttack("0+29")).toEqual([{ kingdom: 0, areaType: 29 }])
        expect(parseAllowedToAttack("0+21#0+34")).toEqual([{ kingdom: 0, areaType: 21 }, { kingdom: 0, areaType: 34 }])
        expect(parseAllowedToAttack(undefined)).toEqual([])
        expect(parseAllowedToAttack("")).toEqual([])
    })

    test("a value it can't read gives null, which allows every target", () => {
        for (const bad of ["abc", "0+", "0+29+3", "0+29#x", "0-29"]) {
            expect(parseAllowedToAttack(bad), bad).toBeNull()
            expect(allowsTarget(parseAllowedToAttack(bad), { kingdom: 5, areaType: 5 }), bad).toBe(true)
        }
    })

    test("a pair matches its kingdom and area type, and -1 matches any", () => {
        const samurai = parseAllowedToAttack("0+29")
        expect(allowsTarget(samurai, { kingdom: 0, areaType: AreaType.samCamp })).toBe(true)
        expect(allowsTarget(samurai, { kingdom: 0, areaType: AreaType.daimyoCastle })).toBe(false)
        expect(allowsTarget(samurai, { kingdom: 1, areaType: AreaType.samCamp })).toBe(false)
        expect(allowsTarget(parseAllowedToAttack("-1+29"), { kingdom: 3, areaType: 29 })).toBe(true)
        expect(allowsTarget(parseAllowedToAttack("0+-1"), { kingdom: 0, areaType: 2 })).toBe(true)
        expect(allowsTarget(parseAllowedToAttack("0+-1"), { kingdom: 1, areaType: 2 })).toBe(false)
    })

    test("an item is read from its own field", () => {
        expect(toolAllowedAt({ allowedToAttack: "0+29" }, { kingdom: 0, areaType: 37 })).toBe(false)
        expect(toolAllowedAt({}, { kingdom: 0, areaType: 37 })).toBe(true)
    })
})

test("the event plugins declare the area type of the camp they attack", () => {
    expect(eventCampTargets(EVENT_PROFILES.samurai)).toEqual([{ kingdom: 0, areaType: 29 }])
    expect(eventCampTargets(EVENT_PROFILES.daimyo)).toEqual([{ kingdom: 0, areaType: 37 }])
    expect(eventCampTargets(EVENT_PROFILES.nomad)).toEqual([{ kingdom: 0, areaType: 27 }])
})

describe("a wave plan's tool the target bars", () => {
    const LADDER = 614, SAMURAI_TOOL = 26, BARON_TOOL = 27, MELEE = 601
    const slot = (item, amount) => ({ item, amount })
    const stored = () => {
        const first = emptyCustomWave()
        first.left = { tools: [slot(SAMURAI_TOOL, 5), slot(LADDER, 10)], units: [slot(MELEE, 10), null] }
        first.front = { tools: [slot(BARON_TOOL, 4), null, null], units: [null, null, null, null, null, null] }
        return { ...emptyPlan(), waves: [first], ast: [SAMURAI_TOOL, null, null] }
    }
    const inventory = () => [
        melee(MELEE, 900), tool(LADDER, 400, { wallBonus: "10" }),
        tool(SAMURAI_TOOL, 50, { wallBonus: "25", allowedToAttack: "0+29" }),
        tool(BARON_TOOL, 50, { gateBonus: "10", slotTypes: "1,9", allowedToAttack: "0+2#0+29" }),
    ]

    test("is left out of the attack with a warning, and the allowed tools still go", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        const { cra } = await barons({ armyMode: "waves", waves: stored(), useCoin: true }, { inventory: inventory() })
        expect(cra.A[0].L.T).toEqual([[-1, 0], [LADDER, 10]])
        expect(cra.A[0].M.T[0]).toEqual([BARON_TOOL, 4])
        expect(cra.AST).toEqual([-1, -1, -1])
        expect(console.warn).toHaveBeenCalledWith("armyToolNotAllowed", SAMURAI_TOOL)
    })
})
