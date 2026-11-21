import { existsSync, readFileSync } from "node:fs"
import { beforeAll, expect, test, vi } from "vitest"
import { ACCOUNT_SETTINGS_PLUGINS, MODULE_GROUPS, MODULES } from "@gge/contracts"
import { readPluginRegistry } from "@gge/bot-core/pluginRegistry.mts"

const en = JSON.parse(readFileSync(new URL("../../../packages/i18n/catalogs/en/client.json", import.meta.url), "utf8")) as Record<string, string>

let shown: string[]
beforeAll(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {})
    shown = readPluginRegistry({ discordHub: true }).catalog.filter(entry => !entry.hidden).map(entry => entry.key)
})

test("every plugin a player can see belongs to exactly one live module, or to the account's own settings", () => {
    const owners = new Map<string, string[]>()
    for (const key of ACCOUNT_SETTINGS_PLUGINS) owners.set(key, ["account settings"])
    for (const module of MODULES) for (const key of module.plugins) owners.set(key, [...(owners.get(key) ?? []), module.id])
    expect(shown.filter(key => !owners.has(key)), "plugins in no module").toEqual([])
    expect([...owners].filter(([, ids]) => ids.length > 1), "plugins in two modules").toEqual([])
    const devOnly = new Set(MODULES.filter(m => m.devOnly).flatMap(m => m.plugins))
    expect([...owners.keys()].filter(key => !shown.includes(key) && !devOnly.has(key)), "module plugins the catalog does not show").toEqual([])
})

test("a live module has plugins unless it is a page of its own, a soon module has none, and several plugins say how to lay out", () => {
    for (const module of MODULES) {
        expect(module.plugins.length > 0, module.id).toBe(module.status === "live" && !module.page)
        expect(module.page === undefined || module.status === "live", module.id).toBe(true)
        expect(Boolean(module.tabs), module.id).toBe(module.plugins.length > 1)
    }
})

test("a module laid out by kingdom names the kingdom of each plugin, which is the one the plugin's castle picker lists", () => {
    const catalog = readPluginRegistry({ discordHub: true }).catalog
    for (const module of MODULES) {
        expect(module.kingdoms !== undefined, module.id).toBe(module.tabs === "kingdoms")
        if (!module.kingdoms) continue
        expect(module.kingdoms.length, module.id).toBe(module.plugins.length)
        module.plugins.forEach((key, i) => {
            const pickers = catalog.find(entry => entry.key === key)!.options.flatMap(def => def.type === "CastlePicker" ? [def.kingdom] : [])
            expect(pickers, key).toEqual([module.kingdoms![i]])
        })
    }
    expect(MODULES.find(m => m.id === "towers")).toMatchObject({ kingdoms: [0, 1, 2, 3], plugins: ["attackBarronsGreatEmpire", "attackBarronsBurningSands", "attackBarronsEverWinterGlacier", "attackBarronsFirePeaks"] })
})

test("every setting a module says is still to come has its English name and description", () => {
    for (const module of MODULES) for (const item of module.global?.soon ?? []) for (const part of ["name", "description"])
        expect(en[`modules.${module.id}.soon.${item}.${part}`], `${module.id} ${item} ${part}`).toBeTruthy()
})

test("ids and orders are unique, orders ascend and groups follow the sidebar's order", () => {
    expect(new Set(MODULES.map(m => m.id)).size).toBe(MODULES.length)
    MODULES.forEach((module, i) => {
        expect(module.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
        if (i) expect(module.order).toBeGreaterThan(MODULES[i - 1]!.order)
        if (i) expect(MODULE_GROUPS.indexOf(module.group), module.id).toBeGreaterThanOrEqual(MODULE_GROUPS.indexOf(MODULES[i - 1]!.group))
    })
})

test("every module icon is in the game-icons set and has its badge and credit committed", () => {
    const set = JSON.parse(readFileSync(new URL("../../../tools/icons/node_modules/@iconify-json/game-icons/icons.json", import.meta.url), "utf8")) as { icons: Record<string, unknown> }
    const dir = new URL("../../../packages/ui/src/icons/", import.meta.url)
    const credits = JSON.parse(readFileSync(new URL("credits.json", dir), "utf8")) as { icons: { id: string; author: string; source: string; licence: string }[] }
    for (const module of MODULES) {
        expect(module.icon in set.icons, `${module.id}: ${module.icon} is in the set`).toBe(true)
        expect(existsSync(new URL(`${module.icon}.svg`, dir)), `${module.icon}.svg`).toBe(true)
        const credit = credits.icons.find(icon => icon.id === module.icon)
        expect(credit, `${module.icon} in credits.json`).toBeDefined()
        expect(credit!.author, `${module.icon} author`).toBeTruthy()
        expect(credit!.source, `${module.icon} source`).toMatch(/^https:\/\/game-icons\.net\//)
        expect(credit!.licence).toBe("CC BY 3.0")
    }
})

test("every module and group has its English name, and every module its description", () => {
    for (const module of MODULES) for (const part of ["name", "description"]) expect(en[`modules.${module.id}.${part}`], `${module.id} ${part}`).toBeTruthy()
    for (const group of MODULE_GROUPS) expect(en[`modules.group.${group}`], group).toBeTruthy()
})
