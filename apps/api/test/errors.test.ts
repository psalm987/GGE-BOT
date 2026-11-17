import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { loadCatalogDir } from "@gge/i18n/node"
import { ERRORS, fail } from "../src/errors.ts"

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, "..", "src")
const en = loadCatalogDir(join(here, "..", "..", "..", "packages", "i18n", "catalogs")).en!.errors!

const PLACEHOLDER = /\{\{-?\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g
const variantsOf = (code: string) => Object.keys(en).filter(key => key === code || key.startsWith(`${code}_`))
const placeholdersOf = (code: string) => new Set(variantsOf(code).flatMap(key => [...en[key]!.matchAll(PLACEHOLDER)].map(m => m[1]!)))

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? sources(path) : name.endsWith(".ts") ? [path] : []
    })
}

describe("the errors catalog", () => {
    test.each(Object.entries(ERRORS))("%s has an English text whose placeholders are its params", (code, names) => {
        expect(variantsOf(code), "no entry in packages/i18n/catalogs/en/errors.json").not.toEqual([])
        const isPlural = variantsOf(code).some(key => /_(one|other)$/.test(key))
        const wanted = new Set([...placeholdersOf(code), ...isPlural ? ["count"] : []])
        expect(new Set(names.filter(name => name !== "context"))).toEqual(wanted)
    })

    test("has no text that no code uses", () => {
        const unused = Object.keys(en).filter(key => !key.startsWith("zod.") && !Object.keys(ERRORS).some(code => key === code || key.startsWith(`${code}_`)))
        expect(unused).toEqual([])
    })

    test("covers every zod issue code", () => {
        for (const code of ["invalid_type", "too_big", "too_small", "invalid_format", "invalid_value", "not_multiple_of", "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element", "custom"])
            expect(en[`zod.${code}`], code).toBeTruthy()
    })
})

describe("fail", () => {
    test("carries the code and params, with the English text as the message", () => {
        const error = fail("FORBIDDEN", "NOT_ENOUGH_POINTS", { count: 3 })
        expect(error).toMatchObject({ code: "FORBIDDEN", status: 403, message: "You need 3 more points to redeem.", data: { code: "NOT_ENOUGH_POINTS", params: { count: 3 } } })
    })

    test("reads a context and a count out of one key", () => {
        expect(fail("FORBIDDEN", "PLAN_LIMIT", { context: "add", count: 1 }).message).toBe("Your plan allows 1 bot. Remove one to add another.")
        expect(fail("FORBIDDEN", "PLAN_LIMIT", { context: "start", count: 3 }).message).toBe("Your plan runs your 3 oldest bots and their event twins. Remove a bot to start this one.")
        expect(fail("FORBIDDEN", "PLAN_LIMIT", { context: "none", count: 0 }).message).toBe("Your plan doesn't include running bots.")
    })

    test("a code with no params has an empty params object", () => {
        expect(fail("NOT_FOUND", "CODE_INVALID").data).toEqual({ code: "CODE_INVALID", params: {} })
    })
})

describe("the API source", () => {
    test("throws API errors only through fail", () => {
        const offenders = sources(src).filter(path => !path.endsWith("errors.ts") && /new ORPCError\(/.test(readFileSync(path, "utf8")))
        expect(offenders.map(path => relative(src, path))).toEqual([])
    })
})
