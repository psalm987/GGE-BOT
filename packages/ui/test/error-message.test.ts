import i18next from "i18next"
import { describe, expect, test } from "vitest"
import { messageOf } from "../src/i18n/message.ts"

const instance = i18next.createInstance()
await instance.init({
    lng: "it",
    fallbackLng: "en",
    ns: ["common", "errors"],
    defaultNS: "common",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: {
        en: {
            common: { "error.generic": "Something went wrong" },
            errors: {
                CODE_USED: "This code has already been used.",
                NOT_ENOUGH_POINTS_one: "You need {{count}} more point to redeem.",
                NOT_ENOUGH_POINTS_other: "You need {{count}} more points to redeem.",
                PLAN_LIMIT_add_one: "Your plan allows {{count}} bot.",
                PLAN_LIMIT_add_other: "Your plan allows {{count}} bots.",
                "zod.too_small": "This is too short or too small.",
            },
        },
        it: {
            common: { "error.generic": "Qualcosa è andato storto" },
            errors: {
                CODE_USED: "Questo codice è già stato usato.",
                NOT_ENOUGH_POINTS_one: "Ti serve ancora {{count}} punto.",
                NOT_ENOUGH_POINTS_other: "Ti servono ancora {{count}} punti.",
                PLAN_LIMIT_add_one: "Il tuo piano consente {{count}} bot.",
                PLAN_LIMIT_add_other: "Il tuo piano consente {{count}} bot.",
                "zod.too_small": "Troppo corto o troppo piccolo.",
            },
        },
    },
})
const said = (error: unknown) => messageOf(error, instance)

describe("messageOf", () => {
    test("says a coded refusal in the active language", () => {
        expect(said({ message: "This code has already been used.", data: { code: "CODE_USED", params: {} } })).toBe("Questo codice è già stato usato.")
    })

    test("fills params, and picks the plural and the variant", () => {
        expect(said({ data: { code: "NOT_ENOUGH_POINTS", params: { count: 1 } } })).toBe("Ti serve ancora 1 punto.")
        expect(said({ data: { code: "NOT_ENOUGH_POINTS", params: { count: 4 } } })).toBe("Ti servono ancora 4 punti.")
        expect(said({ data: { code: "PLAN_LIMIT", params: { context: "add", count: 2 } } })).toBe("Il tuo piano consente 2 bot.")
    })

    test("uses English where the active language lacks the text", async () => {
        const fr = instance.cloneInstance({ lng: "fr" })
        expect(messageOf({ data: { code: "CODE_USED", params: {} } }, fr)).toBe("This code has already been used.")
    })

    test("keeps the server's English message for a code the catalog doesn't know", () => {
        expect(said({ message: "Brand new refusal", data: { code: "FROM_THE_FUTURE", params: {} } })).toBe("Brand new refusal")
    })

    test("keeps the English message when the error has no code", () => {
        expect(said(new Error("Network down"))).toBe("Network down")
    })

    test("falls back to the generic text when there is nothing to say", () => {
        expect(said({})).toBe("Qualcosa è andato storto")
        expect(said(undefined)).toBe("Qualcosa è andato storto")
    })

    test("maps an input validation error by its first issue", () => {
        const error = { message: "Input validation failed", data: { issues: [{ code: "too_small", path: ["password"], message: "Too small: expected string to have >=12 characters" }] } }
        expect(said(error)).toBe("Troppo corto o troppo piccolo.")
    })

    test("keeps the message for a validation issue it has no text for", () => {
        expect(said({ message: "Input validation failed", data: { issues: [{ code: "something_new" }] } })).toBe("Input validation failed")
    })
})
