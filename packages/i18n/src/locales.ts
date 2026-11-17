export const LOCALE_CODES = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu", "it",
    "lt", "lv", "mt", "nl", "pl", "pt", "ro", "sk", "sl", "sv", "nb", "tr", "uk", "ar",
] as const

export type Locale = (typeof LOCALE_CODES)[number]

export type LocaleInfo = {
    code: Locale
    nativeName: string
    englishName: string
    dir: "ltr" | "rtl"
}

const entry = (
    code: Locale,
    nativeName: string,
    englishName: string,
    dir: "ltr" | "rtl" = "ltr",
): LocaleInfo => ({ code, nativeName, englishName, dir })

export const LOCALES: Record<Locale, LocaleInfo> = {
    bg: entry("bg", "Български", "Bulgarian"),
    cs: entry("cs", "Čeština", "Czech"),
    da: entry("da", "Dansk", "Danish"),
    de: entry("de", "Deutsch", "German"),
    el: entry("el", "Ελληνικά", "Greek"),
    en: entry("en", "English", "English"),
    es: entry("es", "Español", "Spanish"),
    et: entry("et", "Eesti", "Estonian"),
    fi: entry("fi", "Suomi", "Finnish"),
    fr: entry("fr", "Français", "French"),
    ga: entry("ga", "Gaeilge", "Irish"),
    hr: entry("hr", "Hrvatski", "Croatian"),
    hu: entry("hu", "Magyar", "Hungarian"),
    it: entry("it", "Italiano", "Italian"),
    lt: entry("lt", "Lietuvių", "Lithuanian"),
    lv: entry("lv", "Latviešu", "Latvian"),
    mt: entry("mt", "Malti", "Maltese"),
    nl: entry("nl", "Nederlands", "Dutch"),
    pl: entry("pl", "Polski", "Polish"),
    pt: entry("pt", "Português", "Portuguese"),
    ro: entry("ro", "Română", "Romanian"),
    sk: entry("sk", "Slovenčina", "Slovak"),
    sl: entry("sl", "Slovenščina", "Slovenian"),
    sv: entry("sv", "Svenska", "Swedish"),
    nb: entry("nb", "Norsk bokmål", "Norwegian Bokmål"),
    tr: entry("tr", "Türkçe", "Turkish"),
    uk: entry("uk", "Українська", "Ukrainian"),
    ar: entry("ar", "العربية", "Arabic", "rtl"),
}

const CODE_SET: ReadonlySet<string> = new Set(LOCALE_CODES)

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && CODE_SET.has(value)
}
