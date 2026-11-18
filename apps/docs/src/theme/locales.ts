import { LOCALES, type Locale } from "@gge/i18n/locales"

type StarlightLocale = { label: string; lang: string; dir: "ltr" | "rtl" }

/** English sits at the root; every other locale gets its code as a prefix. */
export const starlightLocales: Record<string, StarlightLocale> = Object.fromEntries(
    (Object.keys(LOCALES) as Locale[]).map(code => {
        const { nativeName, dir } = LOCALES[code]
        return [code === "en" ? "root" : code, { label: nativeName, lang: code, dir }]
    }),
)
