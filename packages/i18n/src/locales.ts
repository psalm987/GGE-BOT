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
    /** dayjs locale module name */
    dayjs: string
    /** antd locale file stem */
    antd: string
}

const entry = (
    code: Locale,
    nativeName: string,
    englishName: string,
    dayjs: string,
    antd: string,
    dir: "ltr" | "rtl" = "ltr",
): LocaleInfo => ({ code, nativeName, englishName, dir, dayjs, antd })

export const LOCALES: Record<Locale, LocaleInfo> = {
    bg: entry("bg", "Български", "Bulgarian", "bg", "bg_BG"),
    cs: entry("cs", "Čeština", "Czech", "cs", "cs_CZ"),
    da: entry("da", "Dansk", "Danish", "da", "da_DK"),
    de: entry("de", "Deutsch", "German", "de", "de_DE"),
    el: entry("el", "Ελληνικά", "Greek", "el", "el_GR"),
    en: entry("en", "English", "English", "en", "en_GB"),
    es: entry("es", "Español", "Spanish", "es", "es_ES"),
    et: entry("et", "Eesti", "Estonian", "et", "et_EE"),
    fi: entry("fi", "Suomi", "Finnish", "fi", "fi_FI"),
    fr: entry("fr", "Français", "French", "fr", "fr_FR"),
    ga: entry("ga", "Gaeilge", "Irish", "ga", "ga_IE"),
    hr: entry("hr", "Hrvatski", "Croatian", "hr", "hr_HR"),
    hu: entry("hu", "Magyar", "Hungarian", "hu", "hu_HU"),
    it: entry("it", "Italiano", "Italian", "it", "it_IT"),
    lt: entry("lt", "Lietuvių", "Lithuanian", "lt", "lt_LT"),
    lv: entry("lv", "Latviešu", "Latvian", "lv", "lv_LV"),
    mt: entry("mt", "Malti", "Maltese", "mt", "en_GB"),
    nl: entry("nl", "Nederlands", "Dutch", "nl", "nl_NL"),
    pl: entry("pl", "Polski", "Polish", "pl", "pl_PL"),
    pt: entry("pt", "Português", "Portuguese", "pt", "pt_PT"),
    ro: entry("ro", "Română", "Romanian", "ro", "ro_RO"),
    sk: entry("sk", "Slovenčina", "Slovak", "sk", "sk_SK"),
    sl: entry("sl", "Slovenščina", "Slovenian", "sl", "sl_SI"),
    sv: entry("sv", "Svenska", "Swedish", "sv", "sv_SE"),
    nb: entry("nb", "Norsk bokmål", "Norwegian Bokmål", "nb", "nb_NO"),
    tr: entry("tr", "Türkçe", "Turkish", "tr", "tr_TR"),
    uk: entry("uk", "Українська", "Ukrainian", "uk", "uk_UA"),
    ar: entry("ar", "العربية", "Arabic", "ar", "ar_EG", "rtl"),
}

const CODE_SET: ReadonlySet<string> = new Set(LOCALE_CODES)

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && CODE_SET.has(value)
}
