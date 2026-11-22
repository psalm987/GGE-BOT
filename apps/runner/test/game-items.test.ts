import { fileURLToPath } from "node:url"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, expect, inject, test } from "vitest"
import { createDb, gameItems, type Db } from "@gge/db"
import { publishGameItems, readGameItems, variantsOf, type Entry } from "../src/game-items.ts"

const dataDir = fileURLToPath(new URL("./fixtures/game-data", import.meta.url))

test("reads troops, support tools, banners and tools, and skips every other shape", async () => {
    const items = await readGameItems(dataDir)
    expect(items.map(i => [i.id, i.kind])).toEqual([
        [652, "troop"], [700, "troop"], [359, "supportTool"], [660, "banner"], [77, "banner"], [611, "tool"], [308, "troop"], [701, "troop"], [666, "tool"],
        [614, "tool"], [1298, "tool"], [1299, "tool"], [1300, "tool"], [644, "tool"], [179, "tool"], [106, "tool"], [563, "tool"], [141, "tool"], [560, "tool"],
        [40, "troop"], [662, "troop"], [403, "supportTool"], [709, "supportTool"], [696, "tool"], [697, "tool"], [450, "tool"], [694, "tool"], [695, "tool"],
    ])
})

test("names an item from the first language key that exists, else by its type", async () => {
    const byId = new Map((await readGameItems(dataDir)).map(i => [i.id, i]))
    expect(byId.get(660)).toMatchObject({ nameKey: "royalBanner_name", name: "Royal banner", level: 2, fameBonus: 15 })
    expect(byId.get(700)).toMatchObject({ nameKey: "speerman_name", name: "Spearman" })
    expect(byId.get(77)).toMatchObject({ nameKey: "flag_name", name: "Banner" })
    expect(byId.get(611)).toMatchObject({ nameKey: "Ram_name", name: "Battering ram" })
    expect(byId.get(359)).toMatchObject({ nameKey: "SceatSuppKillMeleeDef_name", name: "SceatSuppKillMeleeDef", level: 1, fameBonus: null })
})

test("items sharing a kind, name and level get a variant, and the rest get none", async () => {
    const variants = new Map((await readGameItems(dataDir)).map(i => [i.id, i.variant]))
    expect(variants.get(1299)).toEqual({ kind: "jade", tier: 2 })
    expect(variants.get(614), "the plain ladder beside the Jade ones").toBeNull()
    expect(variants.get(179)).toEqual({ kind: "battleground" })
    expect(variants.get(644), "the plain mat beside the battleground one").toBeNull()
    expect(variants.get(563)).toEqual({ kind: "bonus", bonus: "ragePointBonus", value: 2 })
    expect(variants.get(141)).toEqual({ kind: "bonus", bonus: "khanTabletBooster", value: 5 })
    expect(variants.get(662)).toEqual({ kind: "bonus", bonus: "meleeAttack", value: 109 })
    expect(variants.get(660), "no other item shares its name").toBeNull()
})

test("items with nothing but an upgrade chain to tell them apart are numbered along it", async () => {
    const variants = new Map((await readGameItems(dataDir)).map(i => [i.id, i.variant]))
    expect([403, 709].map(id => variants.get(id))).toEqual([{ kind: "version", step: 1 }, { kind: "version", step: 2 }])
    expect([696, 697].map(id => variants.get(id))).toEqual([{ kind: "version", step: 1 }, { kind: "version", step: 2 }])
    expect([694, 450, 695].map(id => variants.get(id))).toEqual([{ kind: "version", step: 2 }, { kind: "version", step: 1 }, { kind: "version", step: 3 }])
})

test("level 0 and no level are the same level when grouping", () => {
    const entry = (id: number, level: number | null): Entry => ({
        unit: { wodID: id, type: "Ram", ragePointBonus: String(id) },
        item: { id, kind: "tool", nameKey: "Ram_name", name: "Ram", level, fameBonus: null, orderList: null, image: null, variant: null },
    })
    expect([...variantsOf([entry(1, null), entry(2, 0), entry(3, 5)]).keys()]).toEqual([1, 2])
})

test("only an item paid with coins or resources has a list to be ordered from", async () => {
    const byId = new Map((await readGameItems(dataDir)).map(i => [i.id, i]))
    expect(byId.get(308)!.orderList).toBe(0)
    expect(byId.get(611)!.orderList).toBe(1)
    expect(byId.get(701)!.orderList, "costs rubies as well").toBeNull()
    expect(byId.get(652)!.orderList, "has no price").toBeNull()
})

test("an item gets its CDN image when the asset list has one", async () => {
    const byId = new Map((await readGameItems(dataDir)).map(i => [i.id, i]))
    expect(byId.get(652)!.image).toMatch(/^itemassets\/.*Keep_Unit_Peasant/)
    expect(byId.get(660)!.image).toBeNull()
})

let db: Db
beforeAll(() => { db = createDb(inject("databaseUrl")) })
afterAll(() => db.$pool.end())

test("publishing replaces the table's contents with the items given", async () => {
    const items = await readGameItems(dataDir)
    await publishGameItems(db, items)
    expect((await db.select().from(gameItems).where(eq(gameItems.id, 1299)))[0]!.variant, "stored as given").toEqual({ kind: "jade", tier: 2 })
    await publishGameItems(db, items.filter(i => i.kind === "banner"))
    expect((await db.select().from(gameItems)).map(i => i.id).sort((a, b) => a - b)).toEqual([77, 660])
})
