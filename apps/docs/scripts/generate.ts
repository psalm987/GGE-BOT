// Writes src/generated/*.json from the app's own sources, so the docs follow the code. Run before build, dev and test.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { readPluginRegistry } from "@gge/bot-core/pluginRegistry.mts"
import type { PluginOptionDef } from "@gge/contracts"
import { LOCALE_CODES } from "@gge/i18n/locales"
import {
    plainPlaceholders,
    type AlertEntry, type ErrorEntry, type OptionDoc, type OptionLabels, type PluginDoc, type UiLabels,
} from "../src/data/generated-types.ts"

const root = path.join(import.meta.dirname, "../../..")
const out = path.join(import.meta.dirname, "../src/generated")
const readJson = <T>(file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8")) as T
const write = (name: string, data: unknown) => writeFileSync(path.join(out, name), JSON.stringify(data, null, 1) + "\n")

const PLURAL = /_(zero|one|two|few|many)$/

/** One text for each key family: the plural family's `other` form, and a plain key as it is. */
function families(messages: Record<string, string>) {
    const result = new Map<string, string>()
    for (const [key, text] of Object.entries(messages)) {
        if (PLURAL.test(key)) continue
        result.set(key.replace(/_other$/, ""), plainPlaceholders(text))
    }
    return result
}

function errorEntries(): ErrorEntry[] {
    const api = readFileSync(path.join(root, "apps/api/src/errors.ts"), "utf8")
    const block = /export const ERRORS = \{([\s\S]*?)\} as const/.exec(api)?.[1]
    if (!block) throw new Error("apps/api/src/errors.ts no longer has an ERRORS table")
    const codes = [...block.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map(m => m[1]!)
    const texts = families(readJson<Record<string, string>>("packages/i18n/catalogs/en/errors.json"))
    const owner = (key: string) => codes.filter(c => key === c || key.startsWith(c + "_")).sort((a, b) => b.length - a.length)[0]
    const grouped = new Map<string, string[]>(codes.map(c => [c, []]))
    for (const [key, text] of texts) {
        if (key.startsWith("zod.")) continue
        const code = owner(key)
        if (!code) throw new Error(`errors.json has ${key}, but ERRORS in apps/api/src/errors.ts has no such code`)
        grouped.get(code)!.push(text)
    }
    const app = codes.map((code): ErrorEntry => ({ code, source: "app", messages: grouped.get(code)! }))
    const botTexts = readJson<Record<string, string>>("packages/bot-core/locales/en.json")
    const bot = Object.entries(botTexts).filter(([key]) => /^[A-Z][A-Z0-9_]+$/.test(key))
        .map(([code, text]): ErrorEntry => ({ code, source: "bot", messages: [/[.!?…]$/.test(text.trim()) ? text.trim() : text.trim() + "…"] }))
    for (const entry of [...app, ...bot]) if (entry.messages.length === 0) throw new Error(`${entry.code} has no text in its catalog`)
    return [...app, ...bot].sort((a, b) => a.code.localeCompare(b.code))
}

function alertEntries(): AlertEntry[] {
    const texts = families(readJson<Record<string, string>>("packages/i18n/catalogs/en/notifications.json"))
    const ids = [...texts.keys()].filter(k => k.endsWith(".title")).map(k => k.slice(0, -".title".length))
    return ids.map(id => ({
        id,
        title: texts.get(`${id}.title`)!,
        body: [...texts].filter(([k]) => k.startsWith(id + ".") && k !== `${id}.title`).map(([, t]) => t),
    }))
}

const KINDS: Record<PluginOptionDef["type"], OptionDoc["kind"] | null> = {
    "": null, Label: null, Text: "text", Checkbox: "toggle", Select: "choice", Channel: "channel", Number: "number",
    OrderedList: "list", Rows: "table", CastlePicker: "castle",
}

function optionDoc(def: PluginOptionDef): OptionDoc | null {
    const kind = KINDS[def.type]
    if (!kind || !def.key) return null
    const base: OptionDoc = { key: def.key, kind }
    switch (def.type) {
        case "Text":
            if (def.min !== undefined || def.max !== undefined)
                return { ...base, kind: "number", min: def.min, max: def.max, ...(def.default !== undefined && { default: Number(def.default) }) }
            return { ...base, ...(def.default !== undefined && { default: def.default }) }
        case "Checkbox":
            return { ...base, ...(def.default !== undefined && { default: def.default }) }
        case "Select": {
            const at = def.default === undefined ? undefined : def.selection[Number(def.default)]
            return { ...base, choices: def.selection, ...(at !== undefined && { default: at }) }
        }
        case "Number":
            return { ...base, min: def.min, max: def.max, step: def.step, unit: def.unit, ...(def.default !== undefined && { default: def.default }) }
        case "OrderedList":
            return { ...base, catalog: def.catalog }
        case "Channel":
            return { ...base, ...(def.default !== undefined && { default: def.default }) }
        default:
            return base
    }
}

const dropUndefined = <T extends object>(value: T): T => JSON.parse(JSON.stringify(value))

function pluginDocs(): PluginDoc[] {
    // A plugin logs when its optional private add-on is absent, which is normal here.
    const { debug } = console
    console.debug = () => {}
    const { catalog } = readPluginRegistry({ discordHub: true })
    console.debug = debug
    return catalog.map(entry => dropUndefined({
        key: entry.key,
        force: entry.force,
        hidden: entry.hidden,
        attack: entry.category === "attack",
        options: entry.options.flatMap(def => optionDoc(def) ?? []),
    })).sort((a, b) => a.key.localeCompare(b.key))
}

function optionLabels(plugins: PluginDoc[]): OptionLabels {
    // A Select's choices may be locale keys too, as the native village packs are.
    const keys = new Set(plugins.flatMap(p => p.options.flatMap(o => [o.key, ...o.choices ?? []])))
    const labels: OptionLabels = {}
    for (const locale of LOCALE_CODES) {
        const file = path.join(root, "packages/bot-core/locales", `${locale}.json`)
        if (!existsSync(file)) continue
        const texts = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>
        labels[locale] = Object.fromEntries([...keys].filter(k => typeof texts[k] === "string").sort().map(k => [k, texts[k]!]))
    }
    return labels
}

const UI_NAMESPACES = ["client", "common", "ui"]

function uiLabels(): UiLabels {
    const labels: UiLabels = {}
    for (const locale of LOCALE_CODES) {
        const dir = path.join(root, "packages/i18n/catalogs", locale)
        if (!existsSync(dir)) continue
        labels[locale] = {}
        for (const file of readdirSync(dir).sort()) {
            const namespace = path.basename(file, ".json")
            if (!UI_NAMESPACES.includes(namespace)) continue
            for (const [key, text] of Object.entries(JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, string>))
                labels[locale][`${namespace}:${key}`] = text
        }
    }
    return labels
}

mkdirSync(out, { recursive: true })
const plugins = pluginDocs()
write("errors.json", errorEntries())
write("notifications.json", alertEntries())
write("plugins.json", plugins)
write("locales.json", optionLabels(plugins))
write("ui.json", uiLabels())
console.log(`generated ${path.relative(root, out)}: errors, notifications, plugins, locales, ui`)
