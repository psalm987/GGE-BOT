import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, expect, inject, test } from "vitest"
import { createDb, gameItems, type Db } from "@gge/db"
import { publishGameItems, readGameItems } from "../src/game-items.ts"

const dataDir = fileURLToPath(new URL("./fixtures/game-data", import.meta.url))

test("reads troops, support tools, banners and tools, and skips every other shape", async () => {
    const items = await readGameItems(dataDir)
    expect(items.map(i => [i.id, i.kind])).toEqual([
        [652, "troop"], [700, "troop"], [359, "supportTool"], [660, "banner"], [77, "banner"], [611, "tool"], [666, "tool"],
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
    await publishGameItems(db, items.filter(i => i.kind === "banner"))
    expect((await db.select().from(gameItems)).map(i => i.id).sort((a, b) => a - b)).toEqual([77, 660])
})
