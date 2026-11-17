import type { Locale } from "./locales.ts"

const group = (locales: readonly Locale[], countries: string): [string, readonly Locale[]][] =>
    countries.split(" ").map((c) => [c, locales])

// Most-spoken language first.
export const COUNTRY_LOCALES: Readonly<Record<string, readonly Locale[]>> = Object.fromEntries([
    ...group(["bg"], "BG"),
    ...group(["cs"], "CZ"),
    ...group(["da"], "DK"),
    ...group(["de"], "DE AT LI"),
    ...group(["el"], "GR"),
    ...group(["et"], "EE"),
    ...group(["hr"], "HR"),
    ...group(["hu"], "HU"),
    ...group(["it"], "IT SM VA"),
    ...group(["lt"], "LT"),
    ...group(["lv"], "LV"),
    ...group(["nl"], "NL SR AW CW SX"),
    ...group(["pl"], "PL"),
    ...group(["pt"], "PT BR AO MZ CV GW ST TL"),
    ...group(["ro"], "RO MD"),
    ...group(["sk"], "SK"),
    ...group(["sl"], "SI"),
    ...group(["sv"], "SE AX"),
    ...group(["nb"], "NO SJ"),
    ...group(["tr"], "TR"),
    ...group(["uk"], "UA"),
    ...group(["fr"], "FR MC MF BL GF GP MQ RE YT PM NC PF WF HT SN CI ML BF NE TD CG CD GA GN BJ TG CM MG RW BI DJ KM VU"),
    ...group(["es"], "ES MX AR CO PE VE CL EC GT CU BO DO HN PY SV NI CR PA UY PR GQ"),
    ...group(["en"], "GB US AU NZ SG ZA NG GH KE UG TZ ZM ZW BW NA JM TT BB BS BZ GY FJ PG LR SL GM MW GI GG JE IM BM KY VG AI MS FK SH LC VC GD AG DM KN"),
    ...group(["ar"], "DZ BH EG IQ JO KW LB LY MA MR OM PS QA SA SD SO SY TN AE YE"),
    ...group(["en", "fr"], "CA"),
    ...group(["nl", "fr", "de"], "BE"),
    ...group(["de", "fr", "it"], "CH"),
    ...group(["fr", "de"], "LU"),
    ...group(["fi", "sv"], "FI"),
    ...group(["mt", "en"], "MT"),
    ...group(["en", "ga"], "IE"),
    ...group(["el", "tr"], "CY"),
    ...group(["en"], "PH"),
    ...group(["en", "ar"], "ER"),
    ...group(["en", "fr"], "SC MU"),
])
