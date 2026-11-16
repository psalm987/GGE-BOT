import { describe, expect, test } from "vitest"
import { base32Decode, base32Encode, matchingStep, otpauthUri, stepAt, totpCode } from "../src/auth/totp.ts"

// RFC 6238 appendix B, SHA-1 rows: the 8-digit values there end in these 6 digits.
const rfcSecret = Buffer.from("12345678901234567890")
const rfcVectors: [seconds: number, code: string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
]

describe("TOTP codes", () => {
    test("match the RFC 6238 SHA-1 test vectors", () => {
        for (const [seconds, code] of rfcVectors)
            expect(totpCode(rfcSecret, stepAt(seconds * 1000)), String(seconds)).toBe(code)
    })

    test("a code is accepted one step early or late and no further", () => {
        const now = 1111111111_000
        const step = stepAt(now)
        for (const offset of [-1, 0, 1])
            expect(matchingStep(rfcSecret, totpCode(rfcSecret, step + offset), now), String(offset)).toBe(step + offset)
        for (const offset of [-2, 2])
            expect(matchingStep(rfcSecret, totpCode(rfcSecret, step + offset), now), String(offset)).toBeUndefined()
        expect(matchingStep(rfcSecret, "12345", now)).toBeUndefined()
    })
})

describe("base32 secrets", () => {
    test("encode as RFC 4648 without padding and decode back", () => {
        expect(base32Encode(rfcSecret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
        expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB")
        expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6")
        for (const text of ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "gezd gnbv gy3t qojq gezd gnbv gy3t qojq"])
            expect(base32Decode(text).equals(rfcSecret), text).toBe(true)
        expect(base32Decode("MZXW6").toString()).toBe("foo")
        expect(() => base32Decode("not base32!")).toThrow()
    })

    test("the otpauth URI carries what an authenticator app needs", () => {
        const uri = new URL(otpauthUri("al ice", rfcSecret))
        expect(uri.protocol).toBe("otpauth:")
        expect(decodeURIComponent(uri.pathname)).toBe("/GGE Bot Admin:al ice")
        expect(Object.fromEntries(uri.searchParams)).toEqual({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", issuer: "GGE Bot Admin", algorithm: "SHA1", digits: "6", period: "30" })
    })
})
