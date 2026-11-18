import { describe, expect, it } from "vitest"
import { hasNoindex, trimSitemap } from "../src/seo/sitemap.ts"

const alt = (lang: string, href: string) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${href}"/>`
const xml = `<urlset>
<url><loc>https://x/quick-start/</loc>${alt("en", "https://x/quick-start/")}${alt("de", "https://x/de/quick-start/")}${alt("fr", "https://x/fr/quick-start/")}</url>
<url><loc>https://x/fr/quick-start/</loc>${alt("fr", "https://x/fr/quick-start/")}</url>
</urlset>`
const noindex = (url: string) => url.includes("/fr/")

describe("trimSitemap", () => {
    const out = trimSitemap(xml, noindex)

    it("drops a noindex page", () => {
        expect(out).not.toContain("<loc>https://x/fr/quick-start/</loc>")
    })

    it("drops alternates that point at a noindex page and keeps the rest", () => {
        expect(out).not.toContain('hreflang="fr"')
        expect(out).toContain('hreflang="de"')
        expect(out).toContain("<loc>https://x/quick-start/</loc>")
    })
})

describe("hasNoindex", () => {
    it("reads the robots meta", () => {
        expect(hasNoindex('<head><meta name="robots" content="noindex"/></head>')).toBe(true)
        expect(hasNoindex("<head></head>")).toBe(false)
    })
})
