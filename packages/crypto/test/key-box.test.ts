import { randomBytes } from "node:crypto"
import { describe, expect, test } from "vitest"
import { decryptWithKey, encryptWithKey, generateEncryptionKey } from "../src/index.ts"

const key = generateEncryptionKey()
const secret = randomBytes(20)

describe("boxes under a symmetric key", () => {
    test("the key and owner that encrypted it get the same bytes back", () => {
        expect(decryptWithKey(key, encryptWithKey(key, secret, "totp:alice"), "totp:alice").equals(secret)).toBe(true)
    })

    test("encrypting the same bytes twice gives different boxes", () => {
        expect(encryptWithKey(key, secret, "totp:alice").equals(encryptWithKey(key, secret, "totp:alice"))).toBe(false)
    })

    test("a box moved to another owner doesn't open", () => {
        expect(() => decryptWithKey(key, encryptWithKey(key, secret, "totp:alice"), "totp:bob")).toThrow()
    })

    test("another key doesn't open it", () => {
        expect(() => decryptWithKey(generateEncryptionKey(), encryptWithKey(key, secret, "totp:alice"), "totp:alice")).toThrow()
    })

    test("any flipped byte is rejected", () => {
        const box = encryptWithKey(key, secret, "totp:alice")
        for (const index of [0, 1, 13, box.length - 1]) {
            const tampered = Buffer.from(box)
            tampered[index] = tampered[index]! ^ 0xff
            expect(() => decryptWithKey(key, tampered, "totp:alice")).toThrow()
        }
    })

    test("a key that isn't 32 bytes is refused", () => {
        for (const bad of ["", "c2hvcnQ=", randomBytes(31).toString("base64"), randomBytes(33).toString("base64")]) {
            expect(() => encryptWithKey(bad, secret, "totp:alice"), bad).toThrow("32 bytes")
            expect(() => decryptWithKey(bad, encryptWithKey(key, secret, "totp:alice"), "totp:alice"), bad).toThrow("32 bytes")
        }
    })
})
