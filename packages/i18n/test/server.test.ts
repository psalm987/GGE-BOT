import { describe, expect, it } from "vitest"
import { createServerI18n, serverT } from "../src/server.ts"

describe("serverT", () => {
    it("renders an errors text with its params in English", () => {
        expect(serverT("en")("NOT_ENOUGH_POINTS", { ns: "errors", count: 1 })).toBe("You need 1 more point to redeem.")
        expect(serverT("en")("NOT_ENOUGH_POINTS", { ns: "errors", count: 3 })).toBe("You need 3 more points to redeem.")
    })

    it("falls back to English strings for a locale with no catalog, and formats with that locale", () => {
        const t = serverT("de")
        expect(t("CODE_USED", { ns: "errors" })).toBe("This code has already been used.")
        expect(t("when", { ns: "common", defaultValue: "{{at, datetime(year: numeric; month: long; day: numeric; timeZone: UTC)}}", at: new Date("2026-12-08T01:00:00Z") })).toBe("8. Dezember 2026")
    })

    it("uses a translation where one exists", () => {
        const i18n = createServerI18n({ en: { errors: { CODE_USED: "Used." } }, it: { errors: { CODE_USED: "Già usato." } } })
        expect(i18n.getFixedT("it")("CODE_USED", { ns: "errors" })).toBe("Già usato.")
        expect(i18n.getFixedT("fr")("CODE_USED", { ns: "errors" })).toBe("Used.")
    })
})
