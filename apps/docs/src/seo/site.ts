import { getCollection } from "astro:content"
import { SITE_URL } from "./jsonld.ts"

export type DocPage = { id: string; slug: string; locale: string; title: string; description: string; updated?: Date }

const LOCALE_PREFIX = /^([a-z]{2})\//

export const slugOf = (id: string) => id.replace(LOCALE_PREFIX, "")

/** The path of a docs page in a locale: English at the root, the rest under their code. */
export const pagePath = (locale: string, slug: string) => `${locale === "en" ? "" : `/${locale}`}/${slug === "index" ? "" : `${slug}/`}`

export const pageUrl = (locale: string, slug: string) => new URL(pagePath(locale, slug), SITE_URL).href

let cache: Promise<DocPage[]> | undefined

/** Every docs entry in the collection: English and the real translations, never fallbacks. */
export function docPages(): Promise<DocPage[]> {
    cache ??= getCollection("docs").then(entries =>
        entries.map(entry => ({
            id: entry.id,
            slug: slugOf(entry.id),
            locale: LOCALE_PREFIX.exec(entry.id)?.[1] ?? "en",
            title: entry.data.title,
            description: entry.data.description,
            updated: entry.data.updated,
        })),
    )
    return cache
}

/** The locales (English included) that have a real page for this slug. */
export async function translatedLocales(slug: string): Promise<Set<string>> {
    return new Set((await docPages()).filter(page => page.slug === slug).map(page => page.locale))
}
