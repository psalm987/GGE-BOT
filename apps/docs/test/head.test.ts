import { describe, expect, it } from "vitest"
import { addImage, addNoindex, keepAlternates, setCanonical, type HeadTag } from "../src/seo/head.ts"

const alternate = (hreflang: string): HeadTag => ({ tag: "link", attrs: { rel: "alternate", hreflang, href: `https://x/${hreflang}/` } })
const head = (): HeadTag[] => [
    { tag: "link", attrs: { rel: "canonical", href: "https://x/de/only-english/" } },
    alternate("en"),
    alternate("de"),
    alternate("fr"),
    alternate("x-default"),
]

describe("setCanonical", () => {
    it("rewrites only the canonical link", () => {
        const tags = head()
        setCanonical(tags, "https://x/only-english/")
        expect(tags[0]!.attrs?.href).toBe("https://x/only-english/")
        expect(tags[1]!.attrs?.href).toBe("https://x/en/")
    })
})

describe("addNoindex", () => {
    it("adds the robots meta once", () => {
        const tags = head()
        addNoindex(tags)
        addNoindex(tags)
        expect(tags.filter(t => t.attrs?.name === "robots")).toEqual([{ tag: "meta", attrs: { name: "robots", content: "noindex" } }])
    })
})

describe("keepAlternates", () => {
    it("drops languages without a real page and keeps x-default", () => {
        const kept = keepAlternates(head(), new Set(["en", "de"])).filter(t => t.attrs?.rel === "alternate").map(t => t.attrs?.hreflang)
        expect(kept).toEqual(["en", "de", "x-default"])
    })
})

describe("addImage", () => {
    it("sets og:image and twitter:image to the same URL", () => {
        const tags: HeadTag[] = []
        addImage(tags, { url: "https://x/og/en/a.jpeg", alt: "A", width: 1200, height: 630 })
        const value = (key: string) => tags.find(t => t.attrs?.property === key || t.attrs?.name === key)?.attrs?.content
        expect(value("og:image")).toBe(value("twitter:image"))
        expect(value("og:image:width")).toBe("1200")
    })
})
