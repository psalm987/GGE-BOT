import { expect, test } from "vitest"
import { LOCALE_CODES } from "@gge/i18n"
import { ANTD_LOCALES, DAYJS_LOCALES } from "../src/i18n/loaders.ts"

test.each([["dayjs", DAYJS_LOCALES], ["antd", ANTD_LOCALES]])("the %s table covers exactly the supported locales", (_name, table) => {
    expect(Object.keys(table).sort()).toEqual([...LOCALE_CODES].sort())
})

test("every locale module loads", async () => {
    for (const code of LOCALE_CODES) {
        await DAYJS_LOCALES[code]()
        expect((await ANTD_LOCALES[code]()).default).toBeTypeOf("object")
    }
})
