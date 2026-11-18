import { existsSync, readFileSync } from "node:fs"
import { beforeAll, expect, test, vi } from "vitest"
import { MODULE_GROUPS, MODULES } from "@gge/contracts"
import assets from "@gge/bot-core/assets.json" with { type: "json" }
import { readPluginRegistry } from "../src/catalog.ts"

const en = JSON.parse(readFileSync(new URL("../../../packages/i18n/catalogs/en/client.json", import.meta.url), "utf8")) as Record<string, string>

let shown: string[]
beforeAll(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {})
    shown = readPluginRegistry({ discordHub: true }).catalog.filter(entry => !entry.hidden).map(entry => entry.key)
})

test("every plugin a player can see belongs to exactly one live module", () => {
    const owners = new Map<string, string[]>()
    for (const module of MODULES) for (const key of module.plugins) owners.set(key, [...(owners.get(key) ?? []), module.id])
    expect(shown.filter(key => !owners.has(key)), "plugins in no module").toEqual([])
    expect([...owners].filter(([, ids]) => ids.length > 1), "plugins in two modules").toEqual([])
    const devOnly = new Set(MODULES.filter(m => m.devOnly).flatMap(m => m.plugins))
    expect([...owners.keys()].filter(key => !shown.includes(key) && !devOnly.has(key)), "module plugins the catalog does not show").toEqual([])
})

test("a live module has plugins, a soon module has none, and several plugins say how to lay out", () => {
    for (const module of MODULES) {
        expect(module.plugins.length > 0, module.id).toBe(module.status === "live")
        expect(Boolean(module.tabs), module.id).toBe(module.plugins.length > 1)
    }
})

test("ids and orders are unique, orders ascend and groups follow the sidebar's order", () => {
    expect(new Set(MODULES.map(m => m.id)).size).toBe(MODULES.length)
    MODULES.forEach((module, i) => {
        expect(module.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
        if (i) expect(module.order).toBeGreaterThan(MODULES[i - 1]!.order)
        if (i) expect(MODULE_GROUPS.indexOf(module.group), module.id).toBeGreaterThanOrEqual(MODULE_GROUPS.indexOf(MODULES[i - 1]!.group))
    })
})

test("every icon is a game art key", () => {
    for (const module of MODULES) expect(module.icon in assets, `${module.id}: ${module.icon}`).toBe(true)
})

test("every icon's art is committed at both sizes and credited", () => {
    const dir = new URL("../../../packages/ui/src/game-art/", import.meta.url)
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")) as { credit: string; icons: { key: string }[] }
    expect(manifest.credit).toBe("© Goodgame Studios")
    for (const module of MODULES) {
        expect(manifest.icons.some(icon => icon.key === module.icon), `${module.id} in manifest`).toBe(true)
        for (const size of [48, 96]) expect(existsSync(new URL(`${module.icon}-${size}.webp`, dir)), `${module.icon}-${size}.webp`).toBe(true)
    }
})

test("every module and group has its English name, and every module its description", () => {
    for (const module of MODULES) for (const part of ["name", "description"]) expect(en[`modules.${module.id}.${part}`], `${module.id} ${part}`).toBeTruthy()
    for (const group of MODULE_GROUPS) expect(en[`modules.group.${group}`], group).toBeTruthy()
})
