/** Crockford base32: no I, L, O or U, so a code read aloud or typed from a screenshot has no look-alikes. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const PREFIX = "GGE"
/** 12 characters of 5 bits each: 60 random bits. */
const BODY_LENGTH = 12

const grouped = (body: string) => `${PREFIX}-${body.match(/.{4}/g)!.join("-")}`

/** The code spelled by 12 random bytes, taking 5 bits of each: `GGE-XXXX-XXXX-XXXX`. */
export function codeFromBytes(bytes: Uint8Array) {
    if (bytes.length !== BODY_LENGTH)
        throw new Error(`A license code takes ${BODY_LENGTH} random bytes, got ${bytes.length}`)
    return grouped(Array.from(bytes, byte => ALPHABET[byte & 31]).join(""))
}

/**
 * A code as the player typed or pasted it, in the one form codes are stored in; null when it can't be a code.
 * Case, spaces and dashes don't matter, the GGE prefix may be left off, and O reads as 0 and I or L as 1.
 */
export function normalizeCode(input: string): string | null {
    const typed = input.toUpperCase().replace(/[\s-]/g, "")
    const body = (typed.length === PREFIX.length + BODY_LENGTH && typed.startsWith(PREFIX) ? typed.slice(PREFIX.length) : typed)
        .replace(/O/g, "0").replace(/[IL]/g, "1")
    if (body.length !== BODY_LENGTH || [...body].some(char => !ALPHABET.includes(char)))
        return null
    return grouped(body)
}

export const CODE_STATUSES = ["unused", "redeemed", "revoked"] as const
export type CodeStatus = typeof CODE_STATUSES[number]

/** A code that was redeemed stays redeemed, even if its purchase is refunded later. */
export const codeStatus = (code: { redeemedAt: Date | null; revokedAt: Date | null }): CodeStatus =>
    code.redeemedAt ? "redeemed" : code.revokedAt ? "revoked" : "unused"
