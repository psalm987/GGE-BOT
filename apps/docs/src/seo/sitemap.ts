import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { AstroIntegration } from "astro"

const URL_BLOCK = /<url>[\s\S]*?<\/url>/g
const ALTERNATE = /<xhtml:link [^>]*href="([^"]+)"[^>]*\/>/g
const LOC = /<loc>([^<]+)<\/loc>/

/**
 * Drop pages a crawler is told not to index, and the hreflang alternates that point at them.
 * Starlight's sitemap lists every locale of every page, including English fallbacks that carry `noindex`.
 */
export function trimSitemap(xml: string, isNoindex: (url: string) => boolean): string {
    return xml.replace(URL_BLOCK, block => {
        const loc = LOC.exec(block)?.[1]
        if (loc && isNoindex(loc)) return ""
        return block.replace(ALTERNATE, (link, href: string) => (isNoindex(href) ? "" : link))
    })
}

export const hasNoindex = (html: string) => /<meta name="robots" content="noindex"/.test(html)

/** Runs last, after Starlight's own sitemap integration wrote its files. */
export function trimSitemapIntegration(): AstroIntegration {
    return {
        name: "gge-trim-sitemap",
        hooks: {
            "astro:config:setup": ({ updateConfig }) => {
                updateConfig({ integrations: [lastIntegration()] })
            },
        },
    }
}

function lastIntegration(): AstroIntegration {
    return {
        name: "gge-trim-sitemap-run",
        hooks: {
            "astro:build:done": ({ dir }) => {
                const root = fileURLToPath(dir)
                const noindex = (url: string) => {
                    const file = path.join(root, new URL(url).pathname, "index.html")
                    return existsSync(file) && hasNoindex(readFileSync(file, "utf8"))
                }
                for (const name of readdirSync(root).filter(file => /^sitemap-\d+\.xml$/.test(file))) {
                    const file = path.join(root, name)
                    writeFileSync(file, trimSitemap(readFileSync(file, "utf8"), noindex))
                }
            },
        },
    }
}
