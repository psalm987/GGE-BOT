import dayjs from "dayjs"
import i18n from "i18next"
import { useSyncExternalStore } from "react"
import { LOCALES, isLocale, type Locale } from "@gge/i18n"
import { ANTD_LOCALES, DAYJS_LOCALES, type AntdLocale } from "./loaders.ts"

export type Preference = "auto" | Locale

export type LocaleState = {
    preference: Preference
    locale: Locale
    /** What "Automatic" resolves to: a cached detection, or the browser's languages until one arrives. */
    detected: Locale | null
    antdLocale: AntdLocale | undefined
}

export const PREFERENCE_KEY = "gge.locale"
export const LEGACY_KEY = "gge.lang"
// v2: detections cached before the API saw the visitor's own IP (it saw a Cloudflare edge, so everyone got Dutch) are ignored.
export const DETECTED_KEY = "gge.locale.detected.v2"

export const isPreference = (value: unknown): value is Preference => value === "auto" || isLocale(value)

let state: LocaleState = { preference: "auto", locale: "en", detected: null, antdLocale: undefined }
const listeners = new Set<() => void>()
let latest = 0

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export const useLocale = () => useSyncExternalStore(subscribe, () => state)

export function readStorage(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
}

export function writeStorage(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* private mode */ }
}

/** Loads everything the locale needs, then swaps it in at once so the page never shows a half-translated frame. */
export async function applyLocale(next: Locale, patch: Partial<Pick<LocaleState, "preference" | "detected">> = {}) {
    const ticket = ++latest
    const [antd, day] = await Promise.all([ANTD_LOCALES[next](), DAYJS_LOCALES[next](), i18n.loadLanguages(next)])
    if (ticket !== latest) return
    // Registered by object on this dayjs: the locale file registers itself on whichever dayjs copy it resolved, which a bundler may duplicate.
    dayjs.locale(day?.default ?? "en")
    await i18n.changeLanguage(next)
    document.documentElement.lang = next
    document.documentElement.dir = LOCALES[next].dir
    state = { ...state, ...patch, locale: next, antdLocale: antd.default }
    listeners.forEach(listener => listener())
}

export async function setPreference(preference: Preference) {
    writeStorage(PREFERENCE_KEY, preference)
    await applyLocale(preference === "auto" ? state.detected ?? "en" : preference, { preference })
}
