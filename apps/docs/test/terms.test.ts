import { describe, expect, test } from "vitest"
import { LOCALE_CODES } from "@gge/i18n/locales"
import { readGenerated, readTerms } from "../src/data/registry-files.ts"
import { parseDoc, termTags, untaggedFirstUses } from "../src/data/term-usage.ts"
import { SHORT_MAX_WORDS, TermEntry, termForms } from "../src/data/terms.ts"
import { englishPages, pages } from "./pages.ts"

const english = readTerms("en")
const ids = new Set(english.map(t => t.id))

describe("term registry", () => {
    test("English has terms, and each parses against the schema", () => {
        expect(english.length).toBeGreaterThan(0)
        for (const term of english) expect(TermEntry.safeParse(term).success, term.id).toBe(true)
    })

    test(`every short is ${SHORT_MAX_WORDS} words or fewer`, () => {
        expect(english.filter(t => t.short.trim().split(/\s+/).length > SHORT_MAX_WORDS).map(t => t.id)).toEqual([])
    })

    test("no two terms share a name or alias", () => {
        const seen = new Map<string, string>()
        const clashes: string[] = []
        for (const term of english)
            for (const form of termForms(term)) {
                const key = form.toLowerCase()
                if (seen.has(key) && seen.get(key) !== term.id) clashes.push(`${form} (${seen.get(key)}, ${term.id})`)
                seen.set(key, term.id)
            }
        expect(clashes).toEqual([])
    })

    test("see-also ids exist", () => {
        expect(english.flatMap(t => t.seeAlso.filter(id => !ids.has(id)).map(id => `${t.id} -> ${id}`))).toEqual([])
    })

    test.each(LOCALE_CODES.filter(l => l !== "en"))("%s only translates terms English has", locale => {
        expect(readTerms(locale).filter(t => !ids.has(t.id)).map(t => t.id)).toEqual([])
    })
})

describe("term tags", () => {
    test.each(pages.map(p => [p.file, p] as const))("%s tags only registered terms", (_file, page) => {
        expect(termTags(page.source).filter(id => !ids.has(id))).toEqual([])
    })

    test.each(englishPages.map(p => [p.file, p] as const))("%s tags the first use of every registered term", (_file, page) => {
        const untagged = untaggedFirstUses(page.source, english)
        expect(untagged.map(u => `line ${u.line}: "${u.found}" needs {% term id="${u.id}" %}`)).toEqual([])
    })
})

describe("ui tags", () => {
    const labels = new Set(Object.keys(readGenerated.ui().en ?? {}))
    test.each(pages.map(p => [p.file, p] as const))("%s uses labels the app has", (_file, page) => {
        const keys = [...parseDoc(page.source).walk()].filter(n => n.type === "tag" && n.tag === "ui").map(n => String(n.attributes.key))
        expect(keys.filter(key => !labels.has(key))).toEqual([])
    })
})
