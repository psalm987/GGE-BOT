import { expect, test } from "vitest"
import { itemLabel } from "../src/item-names.ts"

const t = (key: string, params: Record<string, string | number>) => `${key.replace("plugins.variant.", "")}${Object.values(params).map(v => ` ${v}`).join("")}`

test("an item without a variant is its name, and its level when it has one", () => {
    expect(itemLabel("Ram", { level: null, variant: null }, t)).toBe("Ram")
    expect(itemLabel("Ram", { level: 0, variant: null }, t)).toBe("Ram")
    expect(itemLabel("Ram", { level: 3, variant: null }, t)).toBe("Ram 3")
})

test("the variant follows the name and level in brackets", () => {
    expect(itemLabel("Scaling ladder", { level: null, variant: { kind: "jade", tier: 2 } }, t)).toBe("Scaling ladder (jade 2)")
    expect(itemLabel("Hurling rocks", { level: 0, variant: { kind: "battleground" } }, t)).toBe("Hurling rocks (battleground)")
    expect(itemLabel("Warwagon", { level: 3, variant: { kind: "version", step: 2 } }, t)).toBe("Warwagon 3 (version 2)")
})

test("a bonus is named in plain words, and both attack fields read alike", () => {
    expect(itemLabel("Rage banner", { level: null, variant: { kind: "bonus", bonus: "ragePointBonus", value: 2 } }, t)).toBe("Rage banner (rage 2)")
    expect(itemLabel("Skeleton warrior", { level: null, variant: { kind: "bonus", bonus: "meleeAttack", value: 109 } }, t)).toBe("Skeleton warrior (attack 109)")
    expect(itemLabel("Archer", { level: null, variant: { kind: "bonus", bonus: "rangeAttack", value: 80 } }, t)).toBe("Archer (attack 80)")
})
