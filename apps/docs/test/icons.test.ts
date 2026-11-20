import { readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import Markdoc, { type Config, type Node } from "@markdoc/markdoc"
import { ICONS, isIcon } from "../src/data/icons.ts"
import { knownIcon } from "../src/data/markdoc-checks.ts"
import { DOCS_ROOT, readTerms } from "../src/data/registry-files.ts"
import { pages } from "./pages.ts"

const ICON_DIR = path.join(DOCS_ROOT, "../../packages/ui/src/icons")
const svgIds = readdirSync(ICON_DIR).filter(file => file.endsWith(".svg")).map(file => file.slice(0, -4)).sort()

const tagsOf = (source: string, name: string): Node[] => [...Markdoc.parse(source).walk()].filter(node => node.type === "tag" && node.tag === name)

describe("house icons", () => {
    test("every glyph file has a credit and every credit has a file", () => {
        expect(ICONS.map(icon => icon.id).sort()).toEqual(svgIds)
    })

    test("each credit names its author, source and licence", () => {
        for (const icon of ICONS) {
            expect(icon.author.trim(), icon.id).not.toBe("")
            expect(icon.source, icon.id).toMatch(/^https:\/\/game-icons\.net\//)
            expect(icon.licence, icon.id).toBe("CC BY 3.0")
            expect(icon.licenceUrl, icon.id).toMatch(/^https:\/\/creativecommons\.org\//)
        }
    })

    test("every term picture is a house icon", () => {
        const bad = readTerms("en").filter(term => term.image && !isIcon(term.image)).map(term => `${term.id}: ${term.image}`)
        expect(bad).toEqual([])
    })

    test.each(pages.map(page => [page.file, page] as const))("%s uses only known icons", (_file, page) => {
        for (const node of tagsOf(page.source, "icon")) expect(knownIcon(node, {} as Config)).toEqual([])
    })
})

describe("icon tag", () => {
    test("an unknown icon id fails", () => {
        expect(knownIcon(tagsOf('{% icon id="not-a-glyph" /%}', "icon")[0]!, {} as Config)).not.toEqual([])
    })
})
