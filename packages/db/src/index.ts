import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import * as schema from "./schema.ts"

export * from "./schema.ts"
export { schema }

export function createDb(connectionString: string) {
    const pool = new pg.Pool({ connectionString })
    return Object.assign(drizzle(pool, { schema }), { $pool: pool })
}

export type Db = ReturnType<typeof createDb>

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export async function runMigrations(db: Db) {
    await migrate(db, { migrationsFolder })
}
