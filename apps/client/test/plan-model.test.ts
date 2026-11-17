import { describe, expect, test } from "vitest"
import type { LicenseCode } from "@gge/contracts"
import { codeComplete, codesCsv, maskCode, pointsStanding, returnState } from "../src/plan-model.ts"

describe("the code field", () => {
    test.each([
        ["", ""],
        ["g", "G"],
        ["gge", "GGE"],
        ["GGE-", "GGE"],
        ["gge-ab", "GGE-AB"],
        ["abcd2345", "GGE-ABCD-2345"],
        [" gge abcd 2345 wxyz ", "GGE-ABCD-2345-WXYZ"],
        ["GGE-ABCD-2345-WXYZ-EXTRA", "GGE-ABCD-2345-WXYZ"],
        ["abcd-2345-wxyz", "GGE-ABCD-2345-WXYZ"],
    ])("%j shows as %j", (typed, shown) => {
        expect(maskCode(typed)).toBe(shown)
    })

    test("only a whole code is complete", () => {
        expect(codeComplete("GGE-ABCD-2345-WXYZ")).toBe(true)
        expect(codeComplete("GGE-ABCD-2345-WXY")).toBe(false)
    })
})

describe("points against the redeem cost", () => {
    test("short of the cost says how many more", () => {
        expect(pointsStanding(6, 8)).toEqual({ canRedeem: false, toward: 6, why: "short", needed: 2 })
    })

    test("at or over the cost can redeem", () => {
        expect(pointsStanding(9, 8)).toEqual({ canRedeem: true, toward: 8 })
    })

    test("below zero after a refund says so and fills nothing", () => {
        expect(pointsStanding(-3, 8)).toEqual({ canRedeem: false, toward: 0, why: "negative", needed: 11 })
    })
})

test("codes download as CSV with every field quoted", () => {
    const code = (over: Partial<LicenseCode>): LicenseCode => ({
        id: "c", purchaseId: "p", planId: "team", days: 28, code: "GGE-AAAA-BBBB-CCCC", status: "unused",
        redeemedBy: null, redeemedAt: null, createdAt: new Date("2026-11-01T10:00:00Z"), ...over,
    })
    const csv = codesCsv([code({}), code({ code: "GGE-DDDD-EEEE-FFFF", status: "redeemed", redeemedBy: "a,\"b\"", redeemedAt: new Date("2026-11-02T10:00:00Z") })], ["Code", "Status", "Redeemed by", "Redeemed at", "Bought"])
    expect(csv.split("\r\n")).toEqual([
        "\"Code\",\"Status\",\"Redeemed by\",\"Redeemed at\",\"Bought\"",
        "\"GGE-AAAA-BBBB-CCCC\",\"unused\",\"\",\"\",\"2026-11-01T10:00:00.000Z\"",
        "\"GGE-DDDD-EEEE-FFFF\",\"redeemed\",\"a,\"\"b\"\"\",\"2026-11-02T10:00:00.000Z\",\"2026-11-01T10:00:00.000Z\"",
        "",
    ])
})

describe("what the return page says", () => {
    test.each([
        [{ status: "paid", delivered: { period: null, codes: 5, points: 5 } }, "delivered"],
        [{ status: "paid", delivered: null }, "waiting"],
        [{ status: "pending", delivered: null }, "waiting"],
        [{ status: "failed", delivered: null }, "failed"],
        [{ status: "refunded", delivered: null }, "refunded"],
    ] as const)("%j reads %s", (outcome, state) => {
        expect(returnState(outcome)).toBe(state)
    })
})
