import { describe, expect, test } from "vitest"
import { generateSealKeyPair, openSealed, sealFor } from "../src/index.ts"

const keys = generateSealKeyPair()

describe("sealed boxes", () => {
    test("the private key opens what the public key sealed", () => {
        const sealed = sealFor(keys.publicKey, "hunter2")
        expect(openSealed(keys.privateKey, sealed)).toBe("hunter2")
    })

    test("sealing the same text twice gives different bytes", () => {
        expect(sealFor(keys.publicKey, "x").equals(sealFor(keys.publicKey, "x"))).toBe(false)
    })

    test("a different private key cannot open it", () => {
        const other = generateSealKeyPair()
        expect(() => openSealed(other.privateKey, sealFor(keys.publicKey, "secret"))).toThrow()
    })

    test("any flipped byte is rejected", () => {
        const sealed = sealFor(keys.publicKey, "secret")
        for (const index of [0, 5, 40, sealed.length - 1]) {
            const tampered = Buffer.from(sealed)
            tampered[index] = tampered[index]! ^ 0xff
            expect(() => openSealed(keys.privateKey, tampered)).toThrow()
        }
    })

    test("the public key alone is not a private key", () => {
        expect(() => openSealed(keys.publicKey, sealFor(keys.publicKey, "secret"))).toThrow()
    })
})
