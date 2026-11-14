// Usage: DATABASE_URL=... SEAL_PUBLIC_KEY=... node cli.ts --db ./user.db [--data ./data]
// Migrations must have run. Servers come from the database (the runner fills
// them at boot) or, if it is empty, from the game data in --data.
import { parseArgs } from "node:util"
import { count } from "drizzle-orm"
import { createDb, servers } from "@gge/db"
import { readPluginRegistry } from "@gge/runner/src/catalog.ts"
import { readServers } from "@gge/runner/src/game-data.ts"
import { importLegacy } from "./import.ts"

const { values } = parseArgs({ options: { db: { type: "string" }, data: { type: "string" } } })
const { DATABASE_URL, SEAL_PUBLIC_KEY } = process.env
if (!values.db || !DATABASE_URL || !SEAL_PUBLIC_KEY)
    throw new Error("Usage: DATABASE_URL=... SEAL_PUBLIC_KEY=... node cli.ts --db ./user.db [--data ./data]")

const db = createDb(DATABASE_URL)
const [{ n }] = await db.select({ n: count() }).from(servers) as [{ n: number }]
if (n === 0) {
    if (!values.data)
        throw new Error("The servers table is empty. Start the runner once, or pass --data with the game data folder (1.xml, lang/).")
    await db.insert(servers).values(await readServers(values.data)).onConflictDoNothing()
}
await importLegacy({ sqlitePath: values.db, db, sealPublicKey: SEAL_PUBLIC_KEY, catalog: readPluginRegistry({}).catalog })
await db.$pool.end()
