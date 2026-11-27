import { eq } from "drizzle-orm"
import { afterAll, beforeAll, expect, inject, test } from "vitest"
import { createDb, pluginCatalog, type Db } from "@gge/db"
import { publishCatalog } from "../src/catalog.ts"

let db: Db
beforeAll(() => { db = createDb(inject("databaseUrl")) })
afterAll(() => db.$pool.end())

test("an event plugin's event is published with its catalog entry, and cleared when the plugin no longer names one", async () => {
    const row = async () => (await db.select().from(pluginCatalog).where(eq(pluginCatalog.key, "catalogBlade")))[0]
    await publishCatalog(db, [{ key: "catalogBlade", force: false, hidden: false, options: [], eventOnly: 4, breaksPeace: true }])
    expect(await row()).toMatchObject({ eventOnly: 4, breaksPeace: true, category: null })

    await publishCatalog(db, [{ key: "catalogBlade", force: false, hidden: false, options: [] }])
    expect(await row()).toMatchObject({ eventOnly: null, breaksPeace: false })
})

test("an attack plugin's targets are published with its catalog entry, and cleared when the plugin no longer names any", async () => {
    const row = async () => (await db.select().from(pluginCatalog).where(eq(pluginCatalog.key, "catalogFortress")))[0]
    await publishCatalog(db, [{ key: "catalogFortress", force: false, hidden: false, options: [], category: "attack", targets: [{ kingdom: 2, areaType: 11 }] }])
    expect(await row()).toMatchObject({ targets: [{ kingdom: 2, areaType: 11 }] })

    await publishCatalog(db, [{ key: "catalogFortress", force: false, hidden: false, options: [] }])
    expect(await row()).toMatchObject({ targets: null })
})
