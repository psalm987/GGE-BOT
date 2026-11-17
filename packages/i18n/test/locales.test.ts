import { describe, expect, it } from "vitest"
import { COUNTRY_LOCALES, LOCALE_CODES, LOCALES, isLocale } from "../src/index.ts"

describe("locale registry", () => {
    it("has exactly the locale codes as keys", () => {
        expect(Object.keys(LOCALES).sort()).toEqual([...LOCALE_CODES].sort())
        expect(LOCALE_CODES).toHaveLength(28)
    })
    it("keys match entry codes and only ar is rtl", () => {
        for (const [key, info] of Object.entries(LOCALES)) {
            expect(info.code).toBe(key)
            expect(info.dir).toBe(key === "ar" ? "rtl" : "ltr")
        }
    })
    it("isLocale guards", () => {
        expect(isLocale("el")).toBe(true)
        expect(isLocale("xx")).toBe(false)
        expect(isLocale(3)).toBe(false)
    })
})

describe("country map", () => {
    it("has only non-empty lists of valid locales keyed by alpha-2", () => {
        for (const [country, list] of Object.entries(COUNTRY_LOCALES)) {
            expect(country).toMatch(/^[A-Z]{2}$/)
            expect(list.length).toBeGreaterThan(0)
            for (const l of list) expect(isLocale(l)).toBe(true)
        }
    })
})
