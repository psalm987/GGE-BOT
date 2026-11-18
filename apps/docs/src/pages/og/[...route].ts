import { OGImageRoute } from "astro-og-canvas"
import { ogOptions } from "../../seo/og.ts"
import { ogKey } from "../../seo/og-path.ts"
import { docPages } from "../../seo/site.ts"

const pages = Object.fromEntries((await docPages()).map(page => [ogKey(page.locale, page.slug), page]))

export const { getStaticPaths, GET } = await OGImageRoute({
    pages,
    getImageOptions: (_path, page) => ogOptions({ title: page.title, slug: page.slug, lang: page.locale }),
})
