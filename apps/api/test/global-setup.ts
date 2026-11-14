import type { TestProject } from "vitest/node"
import { createDb, runMigrations } from "@gge/db"
import { startTestPostgres } from "@gge/db/testing"

declare module "vitest" {
    export interface ProvidedContext { databaseUrl: string }
}

export default async function setup(project: TestProject) {
    const pg = await startTestPostgres()
    const db = createDb(pg.url)
    await runMigrations(db)
    await db.$pool.end()
    project.provide("databaseUrl", pg.url)
    return () => pg.stop()
}
