import { COUNTRY_LOCALES } from "./countries.ts"
import { isLocale, type Locale } from "./locales.ts"

const ALIASES: Readonly<Record<string, Locale>> = { no: "nb", nn: "nb" }

export function parseAcceptLanguage(header: string | null | undefined): string[] {
    if (!header) return []
    const entries: { tag: string; q: number; index: number }[] = []
    header.split(",").forEach((part, index) => {
        const [rawTag = "", ...params] = part.trim().split(";")
        const tag = rawTag.trim()
        if (!/^(\*|[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*)$/.test(tag)) return
        let q = 1
        for (const param of params) {
            const m = /^\s*q\s*=\s*(\d(?:\.\d{0,3})?)\s*$/i.exec(param)
            if (m) q = Number(m[1])
        }
        if (q > 0 && q <= 1) entries.push({ tag, q, index })
    })
    return entries.sort((a, b) => b.q - a.q || a.index - b.index).map((e) => e.tag)
}

export function matchLocale(tag: string): Locale | undefined {
    const primary = tag.split("-")[0]?.toLowerCase() ?? ""
    if (isLocale(primary)) return primary
    return ALIASES[primary]
}

export type LocaleSource = "preference" | "ip" | "header" | "default"

export function resolveLocale(input: {
    preference?: string | null
    country?: string | null
    acceptLanguage?: string | null
}): { locale: Locale; source: LocaleSource } {
    if (isLocale(input.preference)) return { locale: input.preference, source: "preference" }

    const preferred: Locale[] = []
    for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
        const locale = matchLocale(tag)
        if (locale) preferred.push(locale)
    }

    const countryLocales = input.country ? COUNTRY_LOCALES[input.country.toUpperCase()] : undefined
    const first = countryLocales?.[0]
    if (countryLocales && first) {
        const inCountry = preferred.find((l) => countryLocales.includes(l))
        return { locale: inCountry ?? first, source: "ip" }
    }

    const fromHeader = preferred[0]
    if (fromHeader) return { locale: fromHeader, source: "header" }
    return { locale: "en", source: "default" }
}
