import { describe, expect, it } from "vitest"
import { llmsFull, llmsIndex, markdocToMarkdown, type LlmsPage } from "../src/seo/llms.ts"
import { englishPages } from "./pages.ts"

const body = (source: string) => source.replace(/^---\n[\s\S]*?\n---\n/, "")
const pages: LlmsPage[] = englishPages.map(page => ({ slug: page.slug, title: page.slug, description: "d", body: body(page.source) }))

describe("markdocToMarkdown", () => {
    const render = (source: string) => markdocToMarkdown(source, "https://docs.neisesolutions.com/x/")

    it("drops heading ids and demotes headings one level", () => {
        expect(render("## Create {% #sign-up %}")).toBe("### Create")
    })

    it("turns an aside into a labelled quote", () => {
        expect(render('{% aside type="tip" id="a-tip" %}\nGo slow.\n{% /aside %}')).toBe("> **Pro tip.** Go slow.")
    })

    it("prints a ui tag as the app's own label and a term as its text", () => {
        expect(render('Choose {% ui key="client:signup.submit" /%} for a {% term id="plugin" %}plugin{% /term %}.')).toBe("Choose **Create account** for a plugin.")
    })

    it("makes links absolute", () => {
        expect(render("[go](/quick-start/)")).toBe("[go](https://docs.neisesolutions.com/quick-start/)")
    })
})

describe("llms output", () => {
    it("leaves no Markdoc tags in the full text", () => {
        expect(llmsFull(pages)).not.toMatch(/\{%|%\}/)
    })

    it("lists every page once in the index", () => {
        const index = llmsIndex(pages.map(page => ({ ...page, title: `T-${page.slug}` })))
        for (const page of pages) expect(index.split(`](https://docs.neisesolutions.com/${page.slug === "index" ? "" : `${page.slug}/`})`).length - 1, page.slug).toBe(1)
    })

    it("expands the generated references", () => {
        const full = llmsFull(pages)
        expect(full).toContain("`TOO_MANY_ATTACK_PLUGINS`")
        expect(full).toMatch(/- \*\*Plugin\*\*:/)
    })
})
