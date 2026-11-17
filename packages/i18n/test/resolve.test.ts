import { describe, expect, it } from "vitest"
import { matchLocale, parseAcceptLanguage, resolveLocale } from "../src/index.ts"

describe("resolveLocale", () => {
    const cases: [string, Parameters<typeof resolveLocale>[0], { locale: string; source: string }][] = [
        ["CH prefers header language inside country list", { country: "CH", acceptLanguage: "fr-CH,fr;q=0.9" }, { locale: "fr", source: "ip" }],
        ["BE without header uses first country locale", { country: "BE" }, { locale: "nl", source: "ip" }],
        ["IT", { country: "IT" }, { locale: "it", source: "ip" }],
        ["header only", { acceptLanguage: "pt-BR,pt;q=0.8" }, { locale: "pt", source: "header" }],
        ["nn aliases to nb", { acceptLanguage: "nn-NO" }, { locale: "nb", source: "header" }],
        ["preference wins", { preference: "hu", country: "IT" }, { locale: "hu", source: "preference" }],
        ["invalid preference ignored", { preference: "xx", country: "FR" }, { locale: "fr", source: "ip" }],
        ["unmapped country falls to header", { country: "JP", acceptLanguage: "de-DE" }, { locale: "de", source: "header" }],
        ["nothing", {}, { locale: "en", source: "default" }],
        ["q ordering", { acceptLanguage: "fr;q=0.5, it;q=0.9" }, { locale: "it", source: "header" }],
        ["lowercase country", { country: "be" }, { locale: "nl", source: "ip" }],
        ["header outside country list is ignored", { country: "IT", acceptLanguage: "de" }, { locale: "it", source: "ip" }],
    ]
    it.each(cases)("%s", (_name, input, expected) => {
        expect(resolveLocale(input)).toEqual(expected)
    })
})

describe("parseAcceptLanguage", () => {
    it("orders by q, drops q=0 and junk", () => {
        expect(parseAcceptLanguage("fr;q=0.5, it;q=0.9, de;q=0, ;q=1, !!, en")).toEqual(["en", "it", "fr"])
    })
    it("keeps header order for ties", () => {
        expect(parseAcceptLanguage("es, fr, it")).toEqual(["es", "fr", "it"])
    })
    it("handles empty input", () => {
        expect(parseAcceptLanguage(null)).toEqual([])
        expect(parseAcceptLanguage("")).toEqual([])
    })
})

describe("matchLocale", () => {
    it("matches the primary subtag case-insensitively", () => {
        expect(matchLocale("PT-br")).toBe("pt")
        expect(matchLocale("no")).toBe("nb")
        expect(matchLocale("zz")).toBeUndefined()
    })
})
