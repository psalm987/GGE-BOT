import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { LOCALE_CODES } from "../../packages/i18n/src/locales.ts"
import type { Locale } from "../../packages/i18n/src/locales.ts"

type Term = { en: string, keys: string[], note?: string }
type Group = { title: string, terms: Term[] }
type Strings = Record<string, unknown>

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const BASE = "https://empire-html5.goodgamestudios.com/config/languages"
const USER_AGENT = "Mozilla/5.0 (compatible; glossary-fetch)"
const CACHE = process.env.GAME_LANG_CACHE ?? join(homedir(), ".cache", "gge-bot-i18n", "game-lang")
const REFRESH = process.argv.includes("--refresh")

/** Our locale code to the game's code, where they differ. */
const GAME_CODE: Partial<Record<Locale, string>> = { nb: "no" }

async function download(url: string, file: string): Promise<{ ok: true } | { ok: false, status: number }> {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
    if (!res.ok) return { ok: false, status: res.status }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    return { ok: true }
}

async function cached(url: string, name: string): Promise<{ ok: true, file: string } | { ok: false, status: number }> {
    const file = join(CACHE, name)
    if (!REFRESH && existsSync(file)) return { ok: true, file }
    const got = await download(url, file)
    return got.ok ? { ok: true, file } : got
}

const readJson = (file: string): Strings => JSON.parse(readFileSync(file, "utf8"))

function text(strings: Strings, key: string): string | undefined {
    const value = strings[key]
    if (typeof value !== "string" || value === "undefined" || value.trim() === "") return undefined
    return value
}

const cell = (value: string | undefined): string =>
    value === undefined ? "-" : value
        .replaceAll("&quot;", "\"").replaceAll("&amp;", "&").replaceAll("&#39;", "'")
        .replaceAll("|", "\\|").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", " ")

mkdirSync(CACHE, { recursive: true })

const manifest = await cached(`${BASE}/version.json`, "version.json")
if (!manifest.ok) throw new Error(`version.json: HTTP ${manifest.status}`)
const versions = readJson(manifest.file).languages as Record<string, unknown>

const locales = LOCALE_CODES.filter((code) => code !== "en")
const strings = new Map<Locale | "en", Strings>()
const unavailable = new Map<Locale, string>()

for (const code of ["en", ...locales] as const) {
    const gameCode = GAME_CODE[code as Locale] ?? code
    const version = versions[gameCode]
    if (version === undefined) {
        unavailable.set(code as Locale, "the game does not offer this language")
        continue
    }
    if (typeof version !== "string") {
        unavailable.set(code as Locale, "the game lists this language but serves no file for it")
        continue
    }
    const got = await cached(`${BASE}/${version}/${gameCode}.json`, `${version}-${gameCode}.json`)
    if (!got.ok) {
        unavailable.set(code as Locale, `HTTP ${got.status}`)
        console.error(`${code}: HTTP ${got.status}`)
        continue
    }
    strings.set(code, readJson(got.file))
}

const en = strings.get("en")
if (!en) throw new Error("English game file missing")
const available = locales.filter((code) => strings.has(code))
const groups: Group[] = JSON.parse(readFileSync(join(root, "tools", "i18n", "glossary-terms.json"), "utf8")).groups

const out: string[] = [
    "# Official game terms",
    "",
    "This file lists the official names the game uses for its own concepts, in each language the game offers. It is generated. Do not edit it by hand.",
    "",
    "Regenerate with `pnpm i18n:glossary`. The script reads `tools/i18n/glossary-terms.json` and the game's public language files, which it caches outside the repo (`GAME_LANG_CACHE`, default `~/.cache/gge-bot-i18n/game-lang`). Pass `--refresh` to download them again.",
    "",
    "## Rules for translators",
    "",
    "- Use these terms exactly. Players know the game by these names.",
    "- Keep `{{placeholders}}`, plural suffixes such as `_one` and `_other`, and HTML tags such as `<b>` intact.",
    "- Inflect the term only where the language requires it. Do not swap in a synonym.",
    "- A dash means the game has no text for that key in that language. Ask the reviewer.",
    "",
    "## Languages without official game terms",
    "",
    ...locales.filter((code) => unavailable.has(code)).map((code) => `- \`${code}\`: no official game term (${unavailable.get(code)}). Translators choose, and a native reviewer confirms.`),
    "",
    `Game language files used: ${["en", ...available].map((code) => `\`${code}\``).join(", ")}. Game code \`no\` is our \`nb\`. Our \`pt\` uses the game's \`pt\`.`,
    "",
]

let termCount = 0
const missing: string[] = []
for (const group of groups) {
    out.push(`## ${group.title}`, "")
    for (const term of group.terms) {
        termCount++
        const found = term.keys.filter((key) => text(en, key) !== undefined)
        if (found.length === 0) {
            missing.push(term.en)
            out.push(`### ${term.en}`, "", "No game key found.", "")
            continue
        }
        out.push(`### ${term.en}`, "")
        out.push(`Game keys: ${found.map((key) => `\`${key}\` (${cell(text(en, key))})`).join(", ")}.`, "")
        if (term.note) out.push(term.note, "")
        out.push(`| Locale | ${found.map((key) => `\`${key}\``).join(" | ")} |`)
        out.push(`| --- | ${found.map(() => "---").join(" | ")} |`)
        for (const code of locales) {
            const cells = unavailable.has(code) ? found.map(() => "no official game term") : found.map((key) => cell(text(strings.get(code) ?? {}, key)))
            out.push(`| ${code} | ${cells.join(" | ")} |`)
        }
        out.push("")
    }
}

writeFileSync(join(root, "packages", "i18n", "GLOSSARY.md"), `${out.join("\n").trimEnd()}\n`)
console.log(`${termCount} terms, ${available.length} of ${locales.length} locales with game text, ${missing.length} without a key${missing.length ? `: ${missing.join(", ")}` : ""}`)
for (const [code, why] of unavailable) console.log(`no game file for ${code}: ${why}`)
