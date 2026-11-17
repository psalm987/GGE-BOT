import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkCatalogs, type Catalogs } from "../../packages/i18n/src/catalogs.ts"
import { isLocale } from "../../packages/i18n/src/locales.ts"
import { loadCatalogDir } from "../../packages/i18n/src/node.ts"

/**
 * Checks one or more locales against English, app catalogs and the bot's catalog alike: every key present, no
 * extra keys, the same `{{placeholders}}`, the locale's own plural forms, no empty text, and the same HTML tags.
 * Usage: `pnpm i18n:check de it pl`. Exits 1 when any problem is found.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const APP_DIR = join(root, "packages", "i18n", "catalogs")
const BOT_DIR = join(root, "packages", "bot-core", "locales")

const tags = (text: string) => [...text.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)].map(m => m[0].replace(/\s.*>$/, ">").toLowerCase()).sort().join("")

export function checkLocales(locales: string[]): string[] {
    const app = loadCatalogDir(APP_DIR)
    const read = (locale: string) => {
        const file = join(BOT_DIR, `${locale}.json`)
        return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Record<string, string> : undefined
    }
    const catalogs: Catalogs = { en: { ...app.en!, bot: read("en")! } }
    const problems: string[] = []
    for (const locale of locales) {
        if (!isLocale(locale) || locale === "en") {
            problems.push(`${locale}: not one of the 27 locales to translate`)
            continue
        }
        const bot = read(locale)
        catalogs[locale] = { ...app[locale], ...(bot && { bot }) }
    }
    for (const p of checkCatalogs(catalogs).filter(p => p.locale !== "en"))
        problems.push(`${p.locale} ${p.namespace}: ${p.kind} ${p.key}`)
    for (const locale of locales.filter(l => catalogs[l])) {
        for (const [namespace, messages] of Object.entries(catalogs[locale]!)) {
            for (const [key, text] of Object.entries(messages)) {
                const base = catalogs.en![namespace]?.[key] ?? catalogs.en![namespace]?.[key.replace(/_(zero|one|two|few|many)$/, "_other")]
                if (base !== undefined && tags(text) !== tags(base))
                    problems.push(`${locale} ${namespace}: tags ${key}`)
            }
        }
    }
    return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const locales = process.argv.slice(2)
    if (locales.length === 0) {
        console.error("Name the locales to check, for example: pnpm i18n:check de it pl")
        process.exit(2)
    }
    const problems = checkLocales(locales)
    for (const line of problems)
        console.log(line)
    console.log(problems.length ? `${problems.length} problem(s) in ${locales.join(", ")}.` : `${locales.join(", ")}: every catalog matches English.`)
    process.exit(problems.length ? 1 : 0)
}
