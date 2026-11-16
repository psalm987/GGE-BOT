import { GRAFANA_ROLE, createDb, grantGrafanaReadOnly, runMigrations } from "@gge/db"

const url = process.env.DATABASE_URL
if (!url)
    throw new Error("DATABASE_URL is required")
const db = createDb(url)
await runMigrations(db)
console.log("migrations applied")
// The password is a secret, so the role is set up here from the environment rather than in a migration.
const grafanaPassword = process.env.GRAFANA_DB_PASSWORD
if (grafanaPassword) {
    await grantGrafanaReadOnly(db, grafanaPassword)
    console.log(`Grafana's read-only role ${GRAFANA_ROLE} is up to date`)
}
await db.$pool.end()
