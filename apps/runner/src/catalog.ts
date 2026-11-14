import { createRequire } from "node:module"
import path from "node:path"
import { notInArray, sql } from "drizzle-orm"
import { PluginCatalogEntry } from "@gge/contracts"
import { pluginCatalog, type Db } from "@gge/db"

const require = createRequire(import.meta.url)

export type PluginRegistry = { catalog: PluginCatalogEntry[]; filenames: Map<string, string> }

/** Loads bot-core's plugins in this (main) thread for their declarations only. */
export function readPluginRegistry(ggeConfig: Record<string, unknown>): PluginRegistry {
    Object.assign(require("@gge/bot-core/config.js"), ggeConfig)
    const plugins = require("@gge/bot-core/plugins") as [string, { force?: boolean; hidden?: boolean; pluginOptions?: unknown[] }][]
    const catalog: PluginCatalogEntry[] = []
    const filenames = new Map<string, string>()
    for (const [filename, mod] of plugins) {
        const key = path.basename(filename)
        catalog.push(PluginCatalogEntry.parse({ key, force: Boolean(mod.force), hidden: Boolean(mod.hidden), options: mod.pluginOptions ?? [] }))
        filenames.set(key, filename)
    }
    return { catalog, filenames }
}

export async function publishCatalog(db: Db, catalog: PluginCatalogEntry[]) {
    await db.transaction(async tx => {
        for (const entry of catalog)
            await tx.insert(pluginCatalog).values({ ...entry, updatedAt: new Date() })
                .onConflictDoUpdate({ target: pluginCatalog.key, set: { force: entry.force, hidden: entry.hidden, options: entry.options, updatedAt: sql`now()` } })
        await tx.delete(pluginCatalog).where(notInArray(pluginCatalog.key, catalog.map(e => e.key)))
    })
}
