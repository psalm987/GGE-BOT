import { expect, test } from "vitest"
import type { GameItem } from "@gge/contracts"
import { toolsForTargets } from "../src/army-values.ts"

const item = (id: number, attackTargets: GameItem["attackTargets"]): GameItem =>
    ({ id, kind: "tool", nameKey: "t_name", name: "Tool", level: null, fameBonus: null, orderList: null, image: null, variant: null, attackTargets })
const SAMURAI_CAMP = [{ kingdom: 0, areaType: 29 }]
const DAIMYO_CASTLE = [{ kingdom: 0, areaType: 37 }]

test("the tool list is cut to what the plugin's target allows, so two plugins are offered different tools", () => {
    const items = [item(1, null), item(2, SAMURAI_CAMP), item(3, [{ kingdom: 0, areaType: 21 }, { kingdom: 0, areaType: 34 }]), item(4, [{ kingdom: -1, areaType: 37 }])]
    expect(toolsForTargets(items, SAMURAI_CAMP).offered.map(i => i.id)).toEqual([1, 2])
    expect(toolsForTargets(items, DAIMYO_CASTLE).offered.map(i => i.id)).toEqual([1, 4])
    expect([...toolsForTargets(items, DAIMYO_CASTLE).barred]).toEqual([2, 3])
})

test("a plugin that names no target is offered every tool", () => {
    const items = [item(1, null), item(2, SAMURAI_CAMP)]
    expect(toolsForTargets(items, undefined).offered).toHaveLength(2)
    expect(toolsForTargets(items, []).barred.size).toBe(0)
})
