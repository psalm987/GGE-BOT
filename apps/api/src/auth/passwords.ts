import { pbkdf2, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { hash, verify } from "@node-rs/argon2"

const pbkdf2Async = promisify(pbkdf2)

export const hashPassword = (password: string) => hash(password)

type StoredPassword = {
    passwordHash: string
    passwordAlgo: "argon2id" | "pbkdf2-legacy"
    passwordSalt: Buffer | null
}

/** Legacy user.db hashes: PBKDF2-SHA256, 600k iterations, 64 bytes, stored as hex. */
async function verifyLegacy(stored: StoredPassword, password: string) {
    if (!stored.passwordSalt)
        return false
    const expected = Buffer.from(stored.passwordHash, "hex")
    const actual = await pbkdf2Async(password, stored.passwordSalt, 600_000, 64, "sha256")
    return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function verifyPassword(stored: StoredPassword, password: string) {
    if (stored.passwordAlgo === "pbkdf2-legacy")
        return verifyLegacy(stored, password)
    return verify(stored.passwordHash, password)
}

const dummy = hash("not-a-real-password-used-for-timing")

/** Spends the same time as a real check, so a missing user isn't faster than a wrong password. */
export async function verifyNobody(password: string) {
    await verify(await dummy, password)
    return false
}
