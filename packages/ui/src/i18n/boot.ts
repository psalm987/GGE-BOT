import i18n from "i18next"
import resourcesToBackend from "i18next-resources-to-backend"
import { initReactI18next } from "react-i18next"
import { isLocale, resolveLocale, type Locale } from "@gge/i18n"
import { loadCatalog } from "./catalogs.ts"
import { DETECTED_KEY, LEGACY_KEY, PREFERENCE_KEY, applyLocale, isPreference, readStorage, writeStorage, type Preference } from "./store.ts"

export const DETECTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DETECT_TIMEOUT_MS = 800

export type InitialLocale = {
    preference: Preference
    locale: Locale
    detected: Locale
    needsDetect: boolean
}

function freshDetection(cached: unknown, now: number): Locale | null {
    if (typeof cached !== "object" || cached === null) return null
    const { locale, at } = cached as Record<string, unknown>
    if (!isLocale(locale) || typeof at !== "number") return null
    return now - at >= 0 && now - at < DETECTION_MAX_AGE_MS ? locale : null
}

/** What to render first: the stored choice, else a recent detection, else the browser's languages while detection runs. */
export function pickInitialLocale(input: {
    stored: string | null
    legacy: string | null
    cached: unknown
    navigatorLanguages: readonly string[]
    now: number
}): InitialLocale {
    const interim = resolveLocale({ acceptLanguage: input.navigatorLanguages.join(",") }).locale
    const cached = freshDetection(input.cached, input.now)
    const detected = cached ?? interim
    const stored = isPreference(input.stored) ? input.stored : isLocale(input.legacy) ? input.legacy : "auto"
    if (stored !== "auto") return { preference: stored, locale: stored, detected, needsDetect: false }
    return { preference: "auto", locale: detected, detected, needsDetect: cached === null }
}

function parseJson(raw: string | null): unknown {
    try { return raw === null ? null : JSON.parse(raw) } catch { return null }
}

/** Resolves before first render, with the page's language, direction and every catalog it needs already in place. */
export async function initI18n({ detect }: { detect?: () => Promise<Locale | null> } = {}) {
    const initial = pickInitialLocale({
        stored: readStorage(PREFERENCE_KEY),
        legacy: readStorage(LEGACY_KEY),
        cached: parseJson(readStorage(DETECTED_KEY)),
        navigatorLanguages: navigator.languages,
        now: Date.now(),
    })
    writeStorage(PREFERENCE_KEY, initial.preference)

    await i18n.use(initReactI18next).use(resourcesToBackend(loadCatalog)).init({
        lng: "en",
        fallbackLng: "en",
        keySeparator: false,
        nsSeparator: false,
        defaultNS: "common",
        ns: ["common", "bot"],
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
    })

    let { locale, detected } = initial
    if (initial.needsDetect && detect) {
        const result = await Promise.race([
            detect().catch(() => null),
            new Promise<null>(resolve => setTimeout(resolve, DETECT_TIMEOUT_MS, null)),
        ])
        if (result) {
            writeStorage(DETECTED_KEY, JSON.stringify({ locale: result, at: Date.now() }))
            locale = detected = result
        }
    }
    await applyLocale(locale, { preference: initial.preference, detected })
}

/** Bot log parts as text: strings are catalog keys in the bot's namespace, numbers print as they are. */
export function renderParts(
    t: (key: string, options: { ns: string; defaultValue: string }) => string,
    parts: readonly (string | number)[],
) {
    return parts.map(part => typeof part === "string" ? t(part, { ns: "bot", defaultValue: part }) : String(part)).join("")
}
