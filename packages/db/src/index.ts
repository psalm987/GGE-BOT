import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import * as schema from "./schema.ts"

export * from "./schema.ts"
export * from "./notifications.ts"
export * from "./outbox.ts"
export * from "./grafana-role.ts"
export { schema }

export function createDb(connectionString: string) {
    // TCP keepalive lets a long-lived connection (the runner's lock) notice a dead peer.
    const pool = new pg.Pool({ connectionString, keepAlive: true })
    return Object.assign(drizzle(pool, { schema }), { $pool: pool })
}

export type Db = ReturnType<typeof createDb>

/** Postgres NOTIFY channels. */
export const CHANNELS = {
    /** Accounts, settings or owners changed: the runner reconciles (sent by triggers). */
    desired: "gge_desired",
} as const

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export async function runMigrations(db: Db) {
    await migrate(db, { migrationsFolder })
}
