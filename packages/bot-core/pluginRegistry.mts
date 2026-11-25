import { createRequire } from "node:module"
import path from "node:path"
import { PluginCatalogEntry } from "@gge/contracts"

const require = createRequire(import.meta.url)

export type PluginRegistry = { catalog: PluginCatalogEntry[]; filenames: Map<string, string> }

/** Loads bot-core's plugins in this (main) thread for their declarations only. */
export function readPluginRegistry(ggeConfig: Record<string, unknown>): PluginRegistry {
    Object.assign(require("./config.js"), ggeConfig)
    const plugins = require("./plugins") as [string, { force?: boolean; hidden?: boolean; targets?: unknown[]; pluginOptions?: unknown[]; checks?: unknown[]; breaksPeace?: boolean }][]
    const catalog: PluginCatalogEntry[] = []
    const filenames = new Map<string, string>()
    for (const [filename, mod] of plugins) {
        const key = path.basename(filename)
        const force = Boolean(mod.force), hidden = Boolean(mod.hidden)
        const category = !force && !hidden && filename.startsWith("plugins/attack/") ? "attack" : null
        catalog.push(PluginCatalogEntry.parse({ key, force, hidden, options: mod.pluginOptions ?? [], category,
            ...(mod.checks && { checks: mod.checks }), ...(mod.targets && { targets: mod.targets }), ...(mod.breaksPeace && { breaksPeace: true }),
        }))
        filenames.set(key, filename)
    }
    return { catalog, filenames }
}
