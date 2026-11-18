// Helpers for components: what the page's locale has, falling back to English the way the rest of the site does.
import { getCollection } from "astro:content"
import type { AstroGlobal } from "astro"
import { mergeTerms, type TermEntry } from "./terms.ts"
import type { Fix } from "./fixes.ts"

export const routeLocale = (astro: AstroGlobal) => astro.locals.starlightRoute.lang
export const isRtl = (astro: AstroGlobal) => astro.locals.starlightRoute.dir === "rtl"

/** The URL of a docs page in a locale: English at the root, others under their code. */
export const pageHref = (locale: string, slug: string, hash?: string) =>
    `${locale === "en" ? "" : `/${locale}`}/${slug}/${hash ? `#${hash}` : ""}`

const termCache = new Map<string, Promise<TermEntry[]>>()

export function termsFor(locale: string): Promise<TermEntry[]> {
    const cached = termCache.get(locale)
    if (cached) return cached
    const loaded = (async () => {
        const files = await getCollection("terms")
        const termsOf = (code: string) => files.find(file => file.id === code)?.data.terms ?? []
        return locale === "en" ? termsOf("en") : mergeTerms(termsOf("en"), termsOf(locale))
    })()
    termCache.set(locale, loaded)
    return loaded
}

/** The fix text for a code in a locale, falling back to English. */
export async function fixesFor(collection: "errors" | "alerts", locale: string): Promise<Record<string, Fix>> {
    const files: { id: string; data: Record<string, Fix> }[] = await getCollection(collection)
    const fixesOf = (code: string) => files.find(file => file.id === code)?.data ?? {}
    return locale === "en" ? fixesOf("en") : { ...fixesOf("en"), ...fixesOf(locale) }
}

const occurrences = new WeakMap<Request, Map<string, number>>()

/** How many times a term has been rendered on this page so far, so each popover gets its own id. */
export function nextOccurrence(request: Request, id: string): number {
    const counts = occurrences.get(request) ?? new Map<string, number>()
    occurrences.set(request, counts)
    const n = (counts.get(id) ?? 0) + 1
    counts.set(id, n)
    return n
}
