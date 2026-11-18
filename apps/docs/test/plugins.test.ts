import { describe, expect, test } from "vitest"
import { readGenerated } from "../src/data/registry-files.ts"
import { parseDoc } from "../src/data/term-usage.ts"
import { pages } from "./pages.ts"

const plugins = readGenerated.plugins()

describe("settings tables", () => {
    test("the registry carries the Discord plugins", () => {
        expect(plugins.some(p => p.key === "discord")).toBe(true)
    })

    test.each(pages.map(p => [p.file, p] as const))("%s names real plugins", (_file, page) => {
        const named = [...parseDoc(page.source).walk()].filter(n => n.type === "tag" && n.tag === "settings").map(n => String(n.attributes.plugin))
        expect(named.filter(key => !plugins.some(p => p.key === key))).toEqual([])
    })

    test("lists plugin options that have no label, by locale", () => {
        const all = readGenerated.optionLabels()
        const keys = [...new Set(plugins.filter(p => !p.hidden).flatMap(p => p.options.map(o => o.key)))]
        const missing = Object.fromEntries(Object.entries(all).map(([locale, labels]) => [locale, keys.filter(key => !labels[key])]))
        const lines = Object.entries(missing).filter(([, list]) => list.length > 0).map(([locale, list]) => `${locale}: ${list.length} of ${keys.length} (${list.slice(0, 5).join(", ")})`)
        console.info(lines.length ? `Option labels missing from packages/bot-core/locales:\n  ${lines.join("\n  ")}` : `All ${keys.length} option labels exist in every locale.`)
        expect(Object.keys(all)).toContain("en")
    })
})
