import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { checkCatalogs } from "../src/index.ts"
import { loadCatalogDir } from "../src/node.ts"

const base = { en: { common: { a: "A {{x}}", b: "B" } } }

describe("checkCatalogs", () => {
    it("passes identical shapes", () => {
        expect(checkCatalogs({ ...base, de: { common: { a: "Ä {{x}}", b: "B" } } })).toEqual([])
    })
    it("reports missing keys and namespaces", () => {
        expect(checkCatalogs({ ...base, de: { common: { a: "Ä {{x}}" } } })).toEqual([
            { locale: "de", namespace: "common", key: "b", kind: "missing" },
        ])
        expect(checkCatalogs({ ...base, de: {} })).toContainEqual({ locale: "de", namespace: "common", key: "*", kind: "missing" })
    })
    it("reports extra keys", () => {
        expect(checkCatalogs({ ...base, de: { common: { a: "{{x}}", b: "B", c: "C" } } })).toEqual([
            { locale: "de", namespace: "common", key: "c", kind: "extra" },
        ])
    })
    it("reports placeholder mismatch", () => {
        expect(checkCatalogs({ ...base, de: { common: { a: "Ä {{y}}", b: "B" } } })).toEqual([
            { locale: "de", namespace: "common", key: "a", kind: "placeholders" },
        ])
    })
    it("reports empty strings", () => {
        expect(checkCatalogs({ ...base, de: { common: { a: "Ä {{x}}", b: "" } } })).toEqual([
            { locale: "de", namespace: "common", key: "b", kind: "empty" },
        ])
    })

    const plural = (o: Record<string, string>) => ({ common: o })
    const en = plural({ "n_one": "{{count}} item", "n_other": "{{count}} items" })
    it("flags a pl family missing _many", () => {
        const pl = plural({ n_one: "{{count}} a", n_few: "{{count}} b", n_other: "{{count}} d" })
        expect(checkCatalogs({ en, pl })).toEqual([{ locale: "pl", namespace: "common", key: "n", kind: "plural" }])
    })
    it("accepts pl with one/few/many/other while en has one/other", () => {
        const pl = plural({ n_one: "{{count}} a", n_few: "{{count}} b", n_many: "{{count}} c", n_other: "{{count}} d" })
        expect(checkCatalogs({ en, pl })).toEqual([])
    })
})

describe("shipped catalogs", () => {
    it("are consistent", () => {
        const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "catalogs")
        expect(checkCatalogs(loadCatalogDir(dir))).toEqual([])
    })
})
