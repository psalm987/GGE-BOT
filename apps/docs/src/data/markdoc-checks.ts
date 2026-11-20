// Build-time checks for the docs tags, so a wrong id, key or plugin fails the build instead of printing a blank.
import type { Config, Node, ValidationError } from "@markdoc/markdoc"
import { isIcon } from "./icons.ts"
import { parsePoints, screenIds } from "./screens.ts"
import { readGenerated, readTerms } from "./registry-files.ts"

type Check = (node: Node, config: Config) => ValidationError[]

const fail = (message: string, node: Node): ValidationError[] => [{ id: "gge-tag", level: "error", message, location: { start: { line: (node.lines[0] ?? 0) + 1 }, end: { line: (node.lines[1] ?? 0) + 1 } } }]

let termIds: Set<string> | undefined
let uiKeys: Set<string> | undefined
let pluginKeys: Set<string> | undefined

export const knownTerm: Check = node => {
    termIds ??= new Set(readTerms("en").map(t => t.id))
    const id = String(node.attributes.id)
    return termIds.has(id) ? [] : fail(`term id "${id}" is not in src/content/terms/en.yaml`, node)
}

export const knownUiKey: Check = node => {
    uiKeys ??= new Set(Object.keys(readGenerated.ui().en ?? {}))
    const key = String(node.attributes.key)
    return uiKeys.has(key) ? [] : fail(`ui key "${key}" is not in the app's English catalogs`, node)
}

export const knownPlugin: Check = node => {
    pluginKeys ??= new Set(readGenerated.plugins().map(p => p.key))
    const key = String(node.attributes.plugin)
    return pluginKeys.has(key) ? [] : fail(`plugin "${key}" is not in the plugin registry`, node)
}

export const knownIcon: Check = node => {
    const id = String(node.attributes.id)
    return isIcon(id) ? [] : fail(`icon id "${id}" is not in packages/ui/src/icons/credits.json`, node)
}

let screens: Set<string> | undefined

export const knownScreen: Check = node => {
    screens ??= new Set(screenIds("en"))
    const id = String(node.attributes.id)
    const errors = screens.has(id) ? [] : fail(`screenshot "${id}" has no capture in src/assets/screens/en (run scripts/capture.ts)`, node)
    if (!String(node.attributes.alt ?? "").trim()) errors.push(...fail(`screenshot "${id}" needs alt text`, node))
    return errors
}

/** The legend is the one list inside the tag. Each item gets a marker, so the point lists must match it. */
export const validHotspots: Check = node => {
    const errors = knownScreen(node, {} as Config)
    const items = [...node.walk()].filter(child => child.type === "item").length
    for (const name of ["at", "narrow"] as const) {
        const points = parsePoints(String(node.attributes[name] ?? ""))
        if (!points) errors.push(...fail(`hotspots "${name}" must be points like "12,30 40,55", each a percentage`, node))
        else if (points.length !== items) errors.push(...fail(`hotspots "${name}" has ${points.length} points but the legend has ${items} items`, node))
    }
    return errors
}
