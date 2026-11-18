import { expect, test } from "vitest"
import { MODULES, moduleOfPlugin } from "@gge/contracts"
import { buildNav, moduleIdOf, moduleKey, pathOf } from "../src/nav.ts"

const allKeys = new Set(MODULES.flatMap(m => m.plugins))
const labels = { client: (key: string) => key, common: (key: string) => key }

test("every module is one sidebar link to its page, and soon ones are tagged", () => {
    const links = buildNav(labels, true, allKeys).flatMap(group => group.children ?? [])
    for (const module of MODULES) {
        const link = links.find(item => item.key === moduleKey(module.id))
        expect(link?.href, module.id).toBe(`/m/${module.id}`)
        expect(Boolean(link?.tag), module.id).toBe(module.status === "soon")
    }
})

test("the app's own pages sit in the sidebar, and the plan only when billing shows it", () => {
    const keys = (planVisible: boolean) => buildNav(labels, planVisible, allKeys).flatMap(group => group.children ?? []).map(item => item.key)
    expect(keys(true)).toEqual(expect.arrayContaining(["accounts", "logs", "plan", "settings"]))
    expect(keys(false)).not.toContain("plan")
})

test("a key leads to its path", () => {
    expect(pathOf("m:khan")).toBe("/m/khan")
    expect(pathOf("logs")).toBe("/logs")
    expect(moduleIdOf("m:khan")).toBe("khan")
    expect(moduleIdOf("logs")).toBeNull()
})

test("an old plugin link finds the module that edits the plugin", () => {
    expect(moduleOfPlugin("attackKhan")?.id).toBe("khan")
    expect(moduleOfPlugin("attackBarronsFirePeaks")?.id).toBe("towers")
    expect(moduleOfPlugin("noSuchPlugin")).toBeUndefined()
})

test("a development module shows only where the catalog has its plugin", () => {
    const keys = (catalogKeys: Set<string>) => buildNav(labels, true, catalogKeys).flatMap(group => group.children ?? []).map(item => item.key)
    expect(keys(allKeys)).toContain("m:dev-preview")
    expect(keys(new Set(["attackKhan"]))).not.toContain("m:dev-preview")
})
