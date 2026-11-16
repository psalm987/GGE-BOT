import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// RFC 6238 with the settings every authenticator app supports: HMAC-SHA-1, 30-second steps, 6 digits.
const STEP_MS = 30_000
const DIGITS = 6
/** Steps either side of now that still count, for clock drift between the phone and the server. */
const DRIFT_STEPS = 1
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const ISSUER = "GGE Bot Admin"

export const generateTotpSecret = () => randomBytes(20)

export const stepAt = (ms: number) => Math.floor(ms / STEP_MS)

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array) {
    let bits = ""
    for (const byte of bytes)
        bits += byte.toString(2).padStart(8, "0")
    let out = ""
    for (let i = 0; i < bits.length; i += 5)
        out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]
    return out
}

export function base32Decode(text: string) {
    let bits = ""
    for (const char of text.toUpperCase().replace(/[\s=-]/g, "")) {
        const value = BASE32.indexOf(char)
        if (value < 0)
            throw new Error("not base32")
        bits += value.toString(2).padStart(5, "0")
    }
    const bytes = Buffer.alloc(Math.floor(bits.length / 8))
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
    return bytes
}

export function totpCode(secret: Uint8Array, step: number) {
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(step))
    const mac = createHmac("sha1", secret).update(counter).digest()
    const offset = mac[mac.length - 1]! & 0x0f
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, "0")
}

/** The step `code` is valid for, among the ones near `now`; undefined when it matches none. */
export function matchingStep(secret: Uint8Array, code: string, now = Date.now()) {
    const given = Buffer.from(code)
    let matched: number | undefined
    for (let step = stepAt(now) - DRIFT_STEPS; step <= stepAt(now) + DRIFT_STEPS; step++) {
        const expected = Buffer.from(totpCode(secret, step))
        if (expected.length === given.length && timingSafeEqual(expected, given))
            matched = step
    }
    return matched
}

/** What the QR code holds; authenticator apps read the account label and the secret from it. */
export function otpauthUri(username: string, secret: Uint8Array) {
    const issuer = encodeURIComponent(ISSUER)
    return `otpauth://totp/${issuer}:${encodeURIComponent(username)}?secret=${base32Encode(secret)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}
