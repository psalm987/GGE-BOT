import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Catalogs } from "./catalogs.ts"

export function loadCatalogDir(dir: string): Catalogs {
    const catalogs: Catalogs = {}
    for (const locale of readdirSync(dir)) {
        const localeDir = join(dir, locale)
        if (!statSync(localeDir).isDirectory()) continue
        const namespaces: Catalogs[string] = {}
        for (const file of readdirSync(localeDir)) {
            if (!file.endsWith(".json")) continue
            namespaces[file.slice(0, -".json".length)] = JSON.parse(readFileSync(join(localeDir, file), "utf8"))
        }
        catalogs[locale] = namespaces
    }
    return catalogs
}
