import { notInArray, sql } from "drizzle-orm"
import { PluginCatalogEntry } from "@gge/contracts"
import { pluginCatalog, type Db } from "@gge/db"

export async function publishCatalog(db: Db, catalog: PluginCatalogEntry[]) {
    await db.transaction(async tx => {
        for (const entry of catalog) {
            const row = { force: entry.force, hidden: entry.hidden, options: entry.options, category: entry.category ?? null, checks: entry.checks ?? [], breaksPeace: entry.breaksPeace ?? false, eventOnly: entry.eventOnly ?? null }
            await tx.insert(pluginCatalog).values({ key: entry.key, ...row, updatedAt: new Date() })
                .onConflictDoUpdate({ target: pluginCatalog.key, set: { ...row, updatedAt: sql`now()` } })
        }
        await tx.delete(pluginCatalog).where(notInArray(pluginCatalog.key, catalog.map(e => e.key)))
    })
}
