import { describe, expect, it } from "vitest"
import { breadcrumbList, definedTermSet, pageJsonLd, serialize, techArticle, SITE_URL } from "../src/seo/jsonld.ts"

const base = {
    title: "Quick start",
    description: "Sign up and start your bot.",
    lang: "en",
    url: `${SITE_URL}/quick-start/`,
    crumbs: [
        { name: "GGE Command", url: `${SITE_URL}/` },
        { name: "Start here", url: `${SITE_URL}/quick-start/` },
        { name: "Quick start", url: `${SITE_URL}/quick-start/` },
    ],
}

const types = (kind: "article" | "glossary" | "home") => pageJsonLd({ ...base, kind }).map(doc => doc["@type"])

describe("pageJsonLd", () => {
    it("gives every article a TechArticle and a BreadcrumbList", () => {
        expect(types("article")).toEqual(["TechArticle", "BreadcrumbList"])
    })

    it("adds a DefinedTermSet on the glossary only", () => {
        expect(types("glossary")).toEqual(["TechArticle", "BreadcrumbList", "DefinedTermSet"])
        expect(types("article")).not.toContain("DefinedTermSet")
    })

    it("adds the publisher and the product on the home page only", () => {
        expect(types("home")).toEqual(["TechArticle", "BreadcrumbList", "Organization", "SoftwareApplication"])
        expect(types("article")).not.toContain("Organization")
    })

    it("tags every node with the schema.org context", () => {
        for (const doc of pageJsonLd({ ...base, kind: "home" })) expect(doc["@context"]).toBe("https://schema.org")
    })

    it("localises with inLanguage", () => {
        const docs = pageJsonLd({ ...base, kind: "home", lang: "de" })
        for (const doc of docs) if ("inLanguage" in doc) expect(doc.inLanguage).toBe("de")
        expect(docs.filter(doc => "inLanguage" in doc)).toHaveLength(3)
    })
})

describe("techArticle", () => {
    it("clips a long headline and keeps the date short", () => {
        const article = techArticle({ ...base, title: "x".repeat(200), updated: new Date("2026-11-18T10:00:00Z") })
        expect(article.headline.length).toBeLessThanOrEqual(110)
        expect(article.dateModified).toBe("2026-11-18")
    })

    it("omits image and date when it has none", () => {
        const article = techArticle(base)
        expect(article).not.toHaveProperty("image")
        expect(article).not.toHaveProperty("dateModified")
    })
})

describe("breadcrumbList", () => {
    it("numbers items from 1 in order", () => {
        const list = breadcrumbList(base.crumbs, "en")
        expect(list.itemListElement.map(item => item.position)).toEqual([1, 2, 3])
        expect(list.itemListElement.at(-1)?.name).toBe("Quick start")
    })
})

describe("definedTermSet", () => {
    it("emits one DefinedTerm per entry, each linking to its anchor", () => {
        const set = definedTermSet({
            name: "Glossary",
            url: `${SITE_URL}/glossary/`,
            lang: "en",
            terms: [
                { id: "totp", term: "TOTP", aliases: ["2FA"], short: "A six digit code." },
                { id: "khan-camp", term: "Khan camp", aliases: [], short: "A camp of Khan troops." },
            ],
        })
        expect(set.hasDefinedTerm).toHaveLength(2)
        expect(set.hasDefinedTerm[0]).toMatchObject({ url: `${SITE_URL}/glossary/#totp`, termCode: "totp", alternateName: ["2FA"] })
        expect(set.hasDefinedTerm[1]).not.toHaveProperty("alternateName")
    })
})

describe("serialize", () => {
    it("cannot close its script tag", () => {
        const [doc] = pageJsonLd({ ...base, kind: "article", title: "</script><b>" })
        expect(serialize(doc!)).not.toContain("</script>")
        expect(JSON.parse(serialize(doc!)).headline).toBe("</script><b>")
    })
})
