import { parse } from "yaml"
import { describe, expect, it } from "vitest"
import { PageFrontmatter } from "../src/data/frontmatter.ts"
import { pages } from "./pages.ts"

const frontmatter = (source: string) => parse(source.match(/^---\n([\s\S]*?)\n---/)![1]!) as Record<string, unknown>

describe("page frontmatter", () => {
    it.each(pages.map(page => [page.file, page] as const))("%s passes the schema", (_file, page) => {
        expect(PageFrontmatter.safeParse(frontmatter(page.source)).error).toBeUndefined()
    })

    it("rejects a description over 160 characters", () => {
        expect(PageFrontmatter.safeParse({ description: "x".repeat(161) }).success).toBe(false)
    })

    it("rejects a missing description", () => {
        expect(PageFrontmatter.safeParse({}).success).toBe(false)
    })

    it("accepts the optional fields", () => {
        const result = PageFrontmatter.safeParse({
            description: "d",
            appRoute: "/plugins",
            plugin: "attackKhan",
            sources: ["packages/bot-core/plugins/**"],
            status: "beta",
            related: ["quick-start"],
            updated: "2026-11-18",
        })
        expect(result.success).toBe(true)
    })
})
