import { createDb, runMigrations } from "@gge/db"

const url = process.env.DATABASE_URL
if (!url)
    throw new Error("DATABASE_URL is required")
const db = createDb(url)
await runMigrations(db)
await db.$pool.end()
console.log("migrations applied")
