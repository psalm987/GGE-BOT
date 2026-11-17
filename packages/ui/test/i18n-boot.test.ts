import { expect, test } from "vitest"
import { pickInitialLocale } from "../src/i18n/boot.ts"

const NOW = Date.UTC(2026, 10, 17)
const DAY = 24 * 60 * 60 * 1000
const base = { stored: null, legacy: null, cached: null, navigatorLanguages: ["de-DE", "en"], now: NOW }

test.each([
    ["a stored code wins over a fresh detection", { stored: "pl", cached: { locale: "fr", at: NOW - DAY } }, { preference: "pl", locale: "pl", needsDetect: false }],
    ["stored auto uses a fresh detection", { stored: "auto", cached: { locale: "fr", at: NOW - DAY } }, { preference: "auto", locale: "fr", needsDetect: false }],
    ["a stale detection asks again and shows the browser's language meanwhile", { stored: "auto", cached: { locale: "fr", at: NOW - 8 * DAY } }, { preference: "auto", locale: "de", needsDetect: true }],
    ["nothing stored behaves as auto", {}, { preference: "auto", locale: "de", needsDetect: true }],
    ["the legacy key is adopted when nothing else is stored", { legacy: "tr" }, { preference: "tr", locale: "tr", needsDetect: false }],
    ["the new key beats the legacy one", { stored: "auto", legacy: "tr" }, { preference: "auto", locale: "de", needsDetect: true }],
    ["garbage in every slot is ignored", { stored: "klingon", legacy: "xx", cached: { locale: "zz", at: "yesterday" } }, { preference: "auto", locale: "de", needsDetect: true }],
    ["a detection from the future is not trusted", { cached: { locale: "fr", at: NOW + DAY } }, { preference: "auto", locale: "de", needsDetect: true }],
    ["no browser languages falls back to English", { navigatorLanguages: [] }, { preference: "auto", locale: "en", needsDetect: true }],
])("%s", (_name, input, expected) => {
    expect(pickInitialLocale({ ...base, ...input })).toMatchObject(expected)
})

test("the detected locale is reported for the Automatic row even under a manual choice", () => {
    expect(pickInitialLocale({ ...base, stored: "pl", cached: { locale: "fr", at: NOW } }).detected).toBe("fr")
    expect(pickInitialLocale({ ...base, stored: "pl" }).detected).toBe("de")
})
