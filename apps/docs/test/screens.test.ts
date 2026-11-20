import { readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import Markdoc, { type Config, type Node } from "@markdoc/markdoc"
import { knownScreen, validHotspots } from "../src/data/markdoc-checks.ts"
import { DOCS_ROOT } from "../src/data/registry-files.ts"
import { parsePoints, screenIds, SCREEN_WIDTHS } from "../src/data/screens.ts"
import { pages } from "./pages.ts"

const tagsOf = (source: string, name: string): Node[] => [...Markdoc.parse(source).walk()].filter(node => node.type === "tag" && node.tag === name)

describe("screenshots", () => {
    test("English has the captures the pages need, each in both crops", () => {
        const dir = path.join(DOCS_ROOT, "src/assets/screens/en")
        const files = new Set(readdirSync(dir))
        for (const id of screenIds("en")) for (const width of SCREEN_WIDTHS) expect(files.has(`${id}-${width}.webp`), `${id}-${width}`).toBe(true)
        expect(screenIds("en").length).toBeGreaterThanOrEqual(10)
    })

    test("point lists parse as percentages", () => {
        expect(parsePoints("12,30 40.5,55")).toEqual([{ x: 12, y: 30 }, { x: 40.5, y: 55 }])
        expect(parsePoints("101,5")).toBeUndefined()
        expect(parsePoints("12;30")).toBeUndefined()
        expect(parsePoints("")).toBeUndefined()
    })

    test.each(pages.map(page => [page.file, page] as const))("%s names real screenshots and gives each alt text", (_file, page) => {
        for (const node of tagsOf(page.source, "screenshot")) expect(knownScreen(node, {} as Config)).toEqual([])
        for (const node of tagsOf(page.source, "hotspots")) expect(validHotspots(node, {} as Config)).toEqual([])
    })

    test("an unknown screenshot, a missing alt and a legend that does not match its points all fail", () => {
        const unknown = tagsOf('{% screenshot id="nope" alt="x" /%}', "screenshot")[0]!
        expect(knownScreen(unknown, {} as Config)).not.toEqual([])
        const noAlt = tagsOf('{% screenshot id="overview" alt="" /%}', "screenshot")[0]!
        expect(knownScreen(noAlt, {} as Config)).not.toEqual([])
        const mismatch = tagsOf('{% hotspots id="overview" alt="x" at="10,10 20,20" narrow="10,10 20,20" %}\n1. One\n{% /hotspots %}', "hotspots")[0]!
        expect(validHotspots(mismatch, {} as Config)).not.toEqual([])
    })
})
