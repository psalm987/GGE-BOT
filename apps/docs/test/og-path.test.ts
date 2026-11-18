import { describe, expect, it } from "vitest"
import { ogPath } from "../src/seo/og-path.ts"

describe("ogPath", () => {
    it("serves a page's image under its locale", () => {
        expect(ogPath("de", "quick-start")).toBe("/og/de/quick-start.jpeg")
        expect(ogPath("en", "plugins/attack-khan")).toBe("/og/en/plugins/attack-khan.jpeg")
    })

    it("names the home page image home, since the library drops a trailing index", () => {
        expect(ogPath("en", "index")).toBe("/og/en/home.jpeg")
    })
})
