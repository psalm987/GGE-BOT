// Build-time checks for the docs tags, so a wrong id, key or plugin fails the build instead of printing a blank.
import type { Config, Node, ValidationError } from "@markdoc/markdoc"
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
