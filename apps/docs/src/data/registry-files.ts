// Reads the term and fix files straight from disk, for the Markdoc config, the generator checks and the coverage tests.
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"
import { FixFile } from "./fixes.ts"
import { TermFile, type TermEntry } from "./terms.ts"
import type { AlertEntry, ErrorEntry, OptionLabels, PluginDoc, UiLabels } from "./generated-types.ts"

/** The config is bundled before it runs, so its own folder says nothing. Walk up to the docs package instead. */
function findRoot(from: string): string {
    for (let dir = from; ; dir = path.dirname(dir)) {
        if (existsSync(path.join(dir, "markdoc.config.mjs"))) return dir
        if (dir === path.dirname(dir)) throw new Error("apps/docs not found")
    }
}

export const DOCS_ROOT = findRoot(import.meta.dirname)
const content = (...parts: string[]) => path.join(DOCS_ROOT, "src/content", ...parts)

export function readTerms(locale: string): TermEntry[] {
    const file = content("terms", `${locale}.yaml`)
    return existsSync(file) ? TermFile.parse(parse(readFileSync(file, "utf8"))).terms : []
}

export function readFixes(collection: "errors" | "alerts", locale: string): FixFile {
    const file = content(collection, `${locale}.yaml`)
    return existsSync(file) ? FixFile.parse(parse(readFileSync(file, "utf8"))) : {}
}

const generated = (name: string) => JSON.parse(readFileSync(path.join(DOCS_ROOT, "src/generated", name), "utf8"))
export const readGenerated = {
    errors: () => generated("errors.json") as ErrorEntry[],
    alerts: () => generated("notifications.json") as AlertEntry[],
    plugins: () => generated("plugins.json") as PluginDoc[],
    optionLabels: () => generated("locales.json") as OptionLabels,
    ui: () => generated("ui.json") as UiLabels,
}
