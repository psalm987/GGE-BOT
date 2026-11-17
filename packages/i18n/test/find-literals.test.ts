import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { findLiterals, format, parseAllowlist } from "../../../tools/i18n/find-literals.ts"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "i18n", "fixtures")
const scan = (allowlist = join(fixtures, "allowlist.txt")) =>
    findLiterals({ root: fixtures, projects: [{ tsconfig: "tsconfig.json", scope: "src" }], allowlist })

describe("shipped sources", () => {
    it("hold no hard-coded user-visible text", { timeout: 60_000 }, () => {
        expect(findLiterals().map(format)).toEqual([])
    })
})

describe("findLiterals", () => {
    const found = scan().map(format)

    it("reports each kind of user-visible literal in a seeded bad file", () => {
        expect(found).toEqual([
            `src/bad.tsx:7: "Saved"`,
            `src/bad.tsx:8: "Could not save"`,
            `src/bad.tsx:9: "Remove it?"`,
            `src/bad.tsx:9: "Remove"`,
            `src/bad.tsx:10: "Name"`,
            `src/bad.tsx:11: "Enter a name"`,
            `src/bad.tsx:13: "Settings"`,
            `src/bad.tsx:13: "Busy"`,
            `src/bad.tsx:13: "Idle"`,
            `src/bad.tsx:14: "Hello there"`,
            `src/bad.tsx:15: "Search"`,
            `src/bad.tsx:16: "Working"`,
            `src/bad.tsx:17: "Total "`,
        ])
    })

    it("accepts translated, symbolic and allowlisted text", () => {
        expect(found.filter(line => line.startsWith("src/good.tsx"))).toEqual([])
    })

    it("lets a per-file allowlist entry silence one literal", () => {
        const allow = parseAllowlist(`"GGE"\nsrc/bad.tsx: "Saved"\n`)
        expect(allow.global.has("GGE")).toBe(true)
        expect(allow.perFile.has("src/bad.tsx\0Saved")).toBe(true)
    })
})
