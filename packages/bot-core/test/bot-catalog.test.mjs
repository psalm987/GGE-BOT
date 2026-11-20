import { createRequire } from "node:module"
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { loadModule, repo } = require("./harness/load.cjs")
const { botCore, collectSourceKeys, externalLiterals, sourceFiles } = require("./harness/botKeys.cjs")
const { localeCodes } = require("../paths.js")
const errNames = new Set(Object.values(require("../err.json")))

const localesDir = path.join(botCore, "locales")
const readCatalog = code => JSON.parse(fs.readFileSync(path.join(localesDir, `${code}.json`), "utf8"))
const en = readCatalog("en")

/** A key is present as itself, or as the stem of plural forms (`key_one`, `key_other`). */
const has = (catalog, key) => key in catalog || `${key}_other` in catalog

const pluginFiles = execSync("git ls-files plugins", { cwd: repo }).toString().trim().split("\n")
    .filter(file => !file.endsWith("plugins/index.js"))
const plugins = pluginFiles.map(file => {
    const mod = loadModule(file, { mainThread: true }).mod
    return { key: path.basename(file, ".js"), hidden: Boolean(mod.hidden), options: mod.pluginOptions ?? [] }
})
const visible = plugins.filter(plugin => !plugin.hidden)

const source = collectSourceKeys()
/** Option keys, Select choices and Rows column keys, from the loaded plugins and from the source's literals. */
const optionKeys = new Map()
const selectChoices = new Set(source.choices.keys())
for (const plugin of plugins)
    for (const def of plugin.options) {
        if (!def.key)
            continue
        optionKeys.set(def.key, plugin.key)
        for (const column of def.columns ?? [])
            optionKeys.set(column.key, plugin.key)
        for (const choice of def.selection ?? [])
            selectChoices.add(choice)
    }
for (const key of source.options.keys())
    if (!optionKeys.has(key))
        optionKeys.set(key, "source")

/** Scripts that write to the log: the dashboard shows the file's name as its tag, translated through the catalog. */
const loggingScripts = sourceFiles().filter(file => /console\.(log|info|warn|error|notNow)\(|mngLog\(/.test(fs.readFileSync(file, "utf8")))
    .map(file => path.basename(file, ".js"))

const missing = keys => [...keys].filter(key => !has(en, key)).sort()

describe("every key the bot can use is in en.json", () => {
    test("plugin names, and the names that tag log lines", () => {
        expect(missing([...plugins.map(p => p.key), ...loggingScripts])).toEqual([])
    })
    test("option labels, Select choices and Rows columns", () => {
        expect(missing([...optionKeys.keys(), ...selectChoices])).toEqual([])
    })
    test("status reasons", () => {
        expect(missing(source.statuses.keys())).toEqual([])
    })
    test("log message keys", () => {
        /** Errors that never reach the log: one stops a thread that was started wrongly, the other is matched by its text and reported as PROXY_TIMEOUT. */
        const notCatalogKeys = new Set(["Run as worker", "The proxy timed out"])
        expect(missing([...source.logs.keys()].filter(key => !notCatalogKeys.has(key) && !errNames.has(key)))).toEqual([])
    })
    test("a log line is never written as a template with words in it", () => {
        expect(source.templateLogs).toEqual([])
    })
})

describe("plugin descriptions and option help", () => {
    test("every visible plugin has a description", () => {
        expect(visible.map(p => `${p.key}.description`).filter(key => !(key in en))).toEqual([])
    })
    test("a help key belongs to a real option of its plugin", () => {
        const real = new Set(plugins.flatMap(p => p.options.filter(d => d.key).map(d => `${p.key}.${d.key}.help`)))
        expect(Object.keys(en).filter(key => key.endsWith(".help") && !real.has(key))).toEqual([])
    })
    test("a description belongs to a visible plugin", () => {
        const real = new Set(visible.map(p => `${p.key}.description`))
        expect(Object.keys(en).filter(key => key.endsWith(".description") && !real.has(key))).toEqual([])
    })
})

/**
 * en.json keys the source never names. Each entry says who reads the key instead.
 */
const UNUSED_ALLOWED = {
    target: "a Rows column of the dev stack's Settings preview plugin in tools/dev/dev.ts, which is TypeScript the scan only reads for identifiers",
}

describe("en.json holds nothing nobody uses", () => {
    test("every key is named by the bot, the legacy host, the runner or a plugin", () => {
        /** A one-word key like "name" is also an ordinary string, so only a plugin, option, choice or log line counts as naming it. */
        const identifier = word => /[A-Z_0-9]/.test(word)
        const named = new Set([
            ...[...source.literals, ...externalLiterals()].filter(identifier),
            ...plugins.map(p => p.key), ...loggingScripts, ...source.logs.keys(), ...source.statuses.keys(),
            ...optionKeys.keys(), ...selectChoices, ...errNames,
        ])
        const unused = Object.keys(en).filter(key => {
            const stem = key.replace(/_(zero|one|two|few|many|other)$/, "")
            if (key.endsWith(".description") || key.endsWith(".help"))
                return false
            return !named.has(stem) && !(key in UNUSED_ALLOWED)
        })
        expect(unused.sort()).toEqual([])
    })
    test("an allowlist entry still names a key that exists and is unused", () => {
        expect(Object.keys(UNUSED_ALLOWED).filter(key => !(key in en))).toEqual([])
    })
})

describe("every other locale is a subset of en.json", () => {
    const placeholders = text => [...text.matchAll(/\{\{\s*([\w.]+)/g)].map(m => m[1]).sort().join(",")
    test.each(localeCodes().filter(code => code !== "en"))("%s keeps only en's keys, with en's placeholders", code => {
        const catalog = readCatalog(code)
        // A plural English has as `x_one`/`x_other` takes the locale's own forms (French adds `x_many`, Arabic six forms), each read against `x_other`.
        const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories
        const english = key => {
            const plural = /^(.+)_(zero|one|two|few|many|other)$/.exec(key)
            return key in en ? en[key] : plural && forms.includes(plural[2]) ? en[`${plural[1]}_other`] : undefined
        }
        expect(Object.keys(catalog).filter(key => english(key) === undefined)).toEqual([])
        expect(Object.entries(catalog).filter(([key, text]) => typeof text !== "string" || text.trim() === "")).toEqual([])
        // As in the app catalogs, a plural form other than `_other` may leave `{{count}}` out ("two castles"), but keeps every other placeholder.
        const dropsCountOnly = (key, text) => /_(zero|one|two|few|many)$/.test(key)
            && placeholders(english(key).replace(/\{\{\s*count\b[^}]*\}\}/g, "")) === placeholders(text.replace(/\{\{\s*count\b[^}]*\}\}/g, ""))
        expect(Object.entries(catalog).filter(([key, text]) => placeholders(text) !== placeholders(english(key)) && !dropsCountOnly(key, text)).map(([key]) => key)).toEqual([])
    })
    test("the locale list is read from the files", () => {
        expect(localeCodes().sort()).toEqual(fs.readdirSync(localesDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort())
    })
})

// Log parts are joined with no separator, so a text that a value follows must end in its own space.
describe("a text that ends in a colon leaves a space for the value after it", () => {
    test.each(localeCodes())("%s", code => {
        expect(Object.entries(readCatalog(code)).filter(([, text]) => /[:：]$/.test(text)).map(([key]) => key)).toEqual([])
    })
})
