import { getCollection } from "astro:content"
import type { StarlightRouteData } from "@astrojs/starlight/route-data"
import { LOCALES, type Locale } from "@gge/i18n/locales"
import { docPages, pagePath, slugOf, translatedLocales } from "./site.ts"

export type LangOption = { name: string; href: string; prompt: string; close: string }

/** What the language bar may offer on this page: one entry per other locale with a real translation of it. Empty on fallback pages. */
export async function langOptions(route: StarlightRouteData): Promise<Record<string, LangOption>> {
    const slug = slugOf(route.entry.id)
    if (route.isFallback || !(await docPages()).some(page => page.slug === slug)) return {}
    const strings = new Map((await getCollection("i18n")).map(entry => [entry.id, entry.data as Record<string, string | undefined>]))
    const say = (locale: string, key: string) => strings.get(locale)?.[key] ?? strings.get("en")?.[key] ?? ""
    return Object.fromEntries(
        [...(await translatedLocales(slug))].filter(locale => locale !== route.lang).map(locale => {
            const name = LOCALES[locale as Locale].nativeName
            return [locale, { name, href: pagePath(locale, slug), prompt: say(locale, "gge.langbar.prompt").replace("{language}", name), close: say(locale, "gge.langbar.close") }]
        }),
    )
}
