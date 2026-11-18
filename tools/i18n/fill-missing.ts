import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Copies every English app-catalog key a locale lacks into that locale, at the end, with English's text. The locale then
 * passes `pnpm i18n:check` and falls back to English words until it is translated. Usage: `node tools/i18n/fill-missing.ts`.
 */

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "packages", "i18n", "catalogs")
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, string>

let added = 0
for (const file of readdirSync(join(dir, "en")).filter(f => f.endsWith(".json"))) {
    const en = read(join(dir, "en", file))
    for (const locale of readdirSync(dir).filter(l => l !== "en" && statSync(join(dir, l)).isDirectory())) {
        const path = join(dir, locale, file)
        const have = read(path)
        const missing = Object.keys(en).filter(key => !(key in have))
        if (!missing.length) continue
        const merged = { ...have }
        for (const key of missing) merged[key] = en[key]!
        writeFileSync(path, JSON.stringify(merged, null, 2) + "\n")
        added += missing.length
    }
}
console.log(`${added} entries added`)
