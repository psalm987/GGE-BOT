import { MODULES } from "@gge/contracts"
import { describe, expect, test } from "vitest"
import { sidebar } from "../src/theme/sidebar.ts"
import { englishPages } from "./pages.ts"

/** The slug Starlight serves a page at: `modules/index` is `modules`. */
const served = new Set(englishPages.map(page => page.slug.replace(/(^|\/)index$/, "")))

describe("page coverage", () => {
    test("every live module in the app has a page under modules/", () => {
        const live = MODULES.filter(module => module.status === "live" && !("devOnly" in module && module.devOnly))
        expect(live.map(module => `modules/${module.id}`).filter(slug => !served.has(slug))).toEqual([])
    })

    test("no page describes a module the app marks Soon", () => {
        const soon = MODULES.filter(module => module.status === "soon").map(module => `modules/${module.id}`)
        expect(soon.filter(slug => served.has(slug))).toEqual([])
    })

    test("every sidebar entry has an English page", () => {
        const slugs = sidebar.flatMap(group => group.items.map(item => item.slug))
        expect(slugs.filter(slug => !served.has(slug))).toEqual([])
    })
})
