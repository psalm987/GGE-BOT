import { expect, test } from "vitest"
import { formatMoney, majorToMinor, minorToMajor } from "../src/money.ts"

test("whole amounts drop the decimals, others keep two", () => {
    expect(formatMoney(500, "USD", "en-US")).toBe("$5")
    expect(formatMoney(4999, "USD", "en-US")).toBe("$49.99")
    expect(formatMoney(150000, "NGN", "en-NG")).toBe("₦1,500")
})

test("an amount typed in major units round-trips through the stored minor units", () => {
    expect(majorToMinor(49.99)).toBe(4999)
    expect(majorToMinor(0.1 + 0.2)).toBe(30)
    expect(minorToMajor(4999)).toBe(49.99)
})
