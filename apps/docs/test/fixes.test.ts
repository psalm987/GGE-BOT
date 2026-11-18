import { describe, expect, test } from "vitest"
import { INTERNAL_CODES } from "../src/data/internal-codes.ts"
import { parseDoc } from "../src/data/term-usage.ts"
import { readFixes, readGenerated } from "../src/data/registry-files.ts"
import { anchorOf } from "../src/data/generated-types.ts"
import { LOCALE_CODES } from "@gge/i18n/locales"
import { pages } from "./pages.ts"

const errors = readGenerated.errors()
const alerts = readGenerated.alerts()
const publicCodes = errors.filter(e => !INTERNAL_CODES.has(e.code)).map(e => e.code)

const tagsOn = (slug: string, tag: string) =>
    [...parseDoc(pages.find(p => p.locale === "en" && p.slug === slug)!.source).walk()].filter(n => n.type === "tag" && n.tag === tag)

describe("error codes", () => {
    const fixes = readFixes("errors", "en")

    test("every public code has fix text", () => {
        expect(publicCodes.filter(code => !fixes[code]), "codes with no fix in src/content/errors/en.yaml").toEqual([])
    })

    test("no fix text is left for a code that is gone or internal", () => {
        expect(Object.keys(fixes).filter(code => !publicCodes.includes(code)), "stale entries in src/content/errors/en.yaml").toEqual([])
    })

    test("the internal list only names codes that exist", () => {
        const known = new Set(errors.map(e => e.code))
        expect([...INTERNAL_CODES].filter(code => !known.has(code)), "stale entries in src/data/internal-codes.ts").toEqual([])
    })

    test("anchors are unique", () => {
        const anchors = errors.map(e => anchorOf(e.code))
        expect(anchors.length).toBe(new Set(anchors).size)
    })

    test.each(LOCALE_CODES.filter(l => l !== "en"))("%s fix text only covers public codes", locale => {
        expect(Object.keys(readFixes("errors", locale)).filter(code => !publicCodes.includes(code))).toEqual([])
    })

    test("the errors page lists the app's errors and the bot's", () => {
        expect(tagsOn("errors", "errors").map(n => n.attributes.source).sort()).toEqual(["app", "bot"])
    })
})

describe("alerts", () => {
    const fixes = readFixes("alerts", "en")

    test("every notification kind has fix text", () => {
        expect(alerts.filter(a => !fixes[a.id]).map(a => a.id), "kinds with no fix in src/content/alerts/en.yaml").toEqual([])
    })

    test("no fix text is left for a kind that is gone", () => {
        expect(Object.keys(fixes).filter(id => !alerts.some(a => a.id === id))).toEqual([])
    })

    test.each(LOCALE_CODES.filter(l => l !== "en"))("%s fix text only covers real kinds", locale => {
        expect(Object.keys(readFixes("alerts", locale)).filter(id => !alerts.some(a => a.id === id))).toEqual([])
    })

    test("the alerts page lists them", () => {
        expect(tagsOn("alerts", "alerts")).toHaveLength(1)
    })
})
