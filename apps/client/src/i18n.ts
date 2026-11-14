import { useSyncExternalStore } from "react"
import ar from "@gge/bot-core/locales/ar.json"
import cs from "@gge/bot-core/locales/cs.json"
import de from "@gge/bot-core/locales/de.json"
import en from "@gge/bot-core/locales/en.json"
import pl from "@gge/bot-core/locales/pl.json"
import tr from "@gge/bot-core/locales/tr.json"

// Plugin names, option labels and log lines come from the bot's own locale
// files, so the app speaks the same words as the bot. The app's chrome is English.
export const LANGUAGES = { en: "English", de: "Deutsch", pl: "Polski", tr: "Türkçe", cs: "Čeština", ar: "العربية" } as const
export type Language = keyof typeof LANGUAGES
const tables: Record<Language, Record<string, string>> = { en, de, pl, tr, cs, ar }

const stored = (() => { try { return localStorage.getItem("gge.lang") } catch { return null } })()
let language: Language = stored && stored in LANGUAGES ? stored as Language : "en"
const listeners = new Set<() => void>()
document.documentElement.lang = language
document.documentElement.dir = language === "ar" ? "rtl" : "ltr"

export function setLanguage(next: Language) {
    language = next
    try { localStorage.setItem("gge.lang", next) } catch { /* private mode */ }
    document.documentElement.lang = next
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr"
    listeners.forEach(l => l())
}

export function useLanguage() {
    return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => language)
}

/** The bot's translation for a key, falling back to English, then to the key. */
export function t(key: string, lang: Language = language) {
    return tables[lang][key] ?? tables.en[key] ?? key
}

/** A log line from its raw parts, in the viewer's language. */
export const renderParts = (parts: (string | number)[], lang: Language = language) =>
    parts.map(part => typeof part === "string" ? t(part, lang) : String(part)).join("")
