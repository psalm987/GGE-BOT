import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { DOCS_ROOT } from "../src/data/registry-files.ts"

const PAGES = path.join(DOCS_ROOT, "src/content/docs")

export type Page = { file: string; locale: string; slug: string; source: string }

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".mdoc") ? [full] : []
    })
}

/** Every Markdoc page, with the locale its folder says and the slug the URL uses. */
export const pages: Page[] = walk(PAGES).map(file => {
    const relative = path.relative(PAGES, file).replace(/\.mdoc$/, "").split(path.sep)
    const locale = /^[a-z]{2}$/.test(relative[0]!) && relative.length > 1 ? relative.shift()! : "en"
    return { file: path.relative(DOCS_ROOT, file), locale, slug: relative.join("/"), source: readFileSync(file, "utf8") }
})

export const englishPages = pages.filter(page => page.locale === "en")
