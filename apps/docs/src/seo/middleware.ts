import { defineRouteMiddleware } from "@astrojs/starlight/route-data"
import type { StarlightRouteData } from "@astrojs/starlight/route-data"
import { sectionOf } from "../theme/sidebar.ts"
import { termsFor } from "../data/runtime.ts"
import { pageJsonLd, serialize, SITE_URL, APP_NAME, type Crumb, type PageKind } from "./jsonld.ts"
import { addNoindex, keepAlternates, setCanonical } from "./head.ts"
import { docPages, pageUrl, slugOf, translatedLocales } from "./site.ts"

type Head = StarlightRouteData["head"]

const kindOf = (slug: string): PageKind => (slug === "index" ? "home" : slug === "glossary" ? "glossary" : "article")

function crumbsFor(slug: string, lang: string, title: string): Crumb[] {
    const home: Crumb = { name: APP_NAME, url: new URL(lang === "en" ? "/" : `/${lang}/`, SITE_URL).href }
    if (slug === "index") return [home]
    const section = sectionOf(slug, lang)
    return [
        home,
        ...(section ? [{ name: section.label, url: pageUrl(lang, section.firstSlug) }] : []),
        { name: title, url: pageUrl(lang, slug) },
    ]
}

export const onRequest = defineRouteMiddleware(async context => {
    const route = context.locals.starlightRoute
    if (process.env.DOCS_NOINDEX === "1") addNoindex(route.head)
    const slug = slugOf(route.entry.id)
    if (!(await docPages()).some(page => page.slug === slug)) return
    const kind = kindOf(slug)
    const { title, description, updated } = route.entry.data
    const lang = route.isFallback ? "en" : route.lang
    const url = pageUrl(lang, slug)

    const translated = await translatedLocales(slug)
    route.head = keepAlternates(route.head, translated)
    if (route.isFallback) {
        addNoindex(route.head)
        setCanonical(route.head, pageUrl("en", slug))
    }

    const documents = pageJsonLd({
        kind,
        title,
        description,
        lang,
        url,
        updated,
        crumbs: crumbsFor(slug, lang, title),
        terms: kind === "glossary" ? await termsFor(lang) : undefined,
    })
    const scripts: Head = documents.map(doc => ({ tag: "script", attrs: { type: "application/ld+json" }, content: serialize(doc) }))
    route.head.push(...scripts)
})
