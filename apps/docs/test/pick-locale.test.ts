import { describe, expect, it } from "vitest"
import { pickLocale } from "../src/seo/pick-locale.ts"

describe("pickLocale", () => {
    it("suggests the first preferred language the page has", () => {
        expect(pickLocale(["fr-FR", "de-DE", "en"], "en", ["en", "de", "ar"])).toBe("de")
    })

    it("ignores region and case", () => {
        expect(pickLocale(["DE-at"], "en", ["en", "de"])).toBe("de")
    })

    it("suggests nothing when the reader's top choice is the page's own language", () => {
        expect(pickLocale(["en-US", "de"], "en", ["en", "de"])).toBeUndefined()
    })

    it("suggests nothing when no preference has a translation", () => {
        expect(pickLocale(["fr", "ja"], "en", ["en", "de"])).toBeUndefined()
        expect(pickLocale([], "en", ["en", "de"])).toBeUndefined()
    })
})
