import { describe, expect, test } from "vitest"
import { codeFromBytes, normalizeCode } from "../src/index.ts"

describe("codeFromBytes", () => {
    test("spells 12 bytes as GGE and three groups of four", () => {
        expect(codeFromBytes(new Uint8Array(12))).toBe("GGE-0000-0000-0000")
        expect(codeFromBytes(Uint8Array.from([0, 1, 9, 10, 17, 18, 19, 20, 29, 30, 31, 255]))).toBe("GGE-019A-HJKM-XYZZ")
    })

    test("never uses I, L, O or U", () => {
        const all = Array.from({ length: 256 }, (_, byte) => codeFromBytes(new Uint8Array(12).fill(byte))).join("")
        expect(all.replace(/GGE-/g, "")).not.toMatch(/[ILOU]/)
    })

    test("refuses any other number of bytes", () => {
        expect(() => codeFromBytes(new Uint8Array(8))).toThrow()
    })
})

describe("normalizeCode", () => {
    const code = "GGE-01AB-CD10-XYZ0"

    test("a code in its stored form is unchanged", () => {
        expect(normalizeCode(code)).toBe(code)
        expect(normalizeCode(codeFromBytes(Uint8Array.from({ length: 12 }, (_, i) => i * 21)))).toMatch(/^GGE(-[0-9A-Z]{4}){3}$/)
    })

    test("case, spaces and dashes don't matter", () => {
        expect(normalizeCode("gge 01ab-cd10 xyz0")).toBe(code)
        expect(normalizeCode("  gge01abcd10xyz0\n")).toBe(code)
        expect(normalizeCode("G-G-E-0-1-A-B-C-D-1-0-X-Y-Z-0")).toBe(code)
    })

    test("O reads as 0, and I and L as 1", () => {
        expect(normalizeCode("gge oIab-cdLo xyzO")).toBe(code)
    })

    test("the prefix may be left off", () => {
        expect(normalizeCode("01AB-CD10-XYZ0")).toBe(code)
    })

    test("a body that itself starts with GGE keeps it", () => {
        expect(normalizeCode("GGE-GGE0-0000-0000")).toBe("GGE-GGE0-0000-0000")
        expect(normalizeCode("GGE0-0000-0000")).toBe("GGE-GGE0-0000-0000")
    })

    test("anything that can't be a code is null", () => {
        for (const bad of ["", "GGE", "GGE-01AB-CD10", "GGE-01AB-CD10-XYZ0-1", "GGE-01AB-CD10-XYU0", "GGE-01AB-CD10-XY!0", "XXX-01AB-CD10-XYZ0"])
            expect(normalizeCode(bad), bad).toBeNull()
    })
})
