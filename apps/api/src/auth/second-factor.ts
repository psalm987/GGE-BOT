import { randomBytes, randomInt } from "node:crypto"
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { decryptWithKey, encryptWithKey } from "@gge/crypto"
import { loginChallenges, recoveryCodes, sessions, userTotp, users, type Db } from "@gge/db"
import { hashToken } from "./sessions.ts"
import { generateTotpSecret, matchingStep } from "./totp.ts"

export const CHALLENGE_COOKIE = "gge_admin_mfa"
export const CHALLENGE_TTL_MS = 5 * 60_000
export const MAX_CHALLENGE_ATTEMPTS = 5
const RECOVERY_CODE_COUNT = 10
/** No 0/o, 1/i/l: a code read off paper can't be mistyped into another valid-looking one. */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

const aad = (userId: string) => `totp:${userId}`

/** Starts the second step for a user whose password just checked out; their older challenges stop working. */
export async function createChallenge(db: Pick<Db, "transaction">, input: { userId: string; ip?: string }) {
    const token = randomBytes(32).toString("base64url")
    await db.transaction(async tx => {
        await tx.delete(loginChallenges).where(or(eq(loginChallenges.userId, input.userId), lt(loginChallenges.expiresAt, sql`now()`)))
        await tx.insert(loginChallenges).values({ id: hashToken(token), userId: input.userId, ip: input.ip, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
    })
    return token
}

/** The unexpired challenge behind a cookie token and its user, while that user is still an active admin. */
export async function findChallenge(db: Db, token: string) {
    const [row] = await db.select({ id: loginChallenges.id, user: users })
        .from(loginChallenges)
        .innerJoin(users, eq(users.id, loginChallenges.userId))
        .where(and(eq(loginChallenges.id, hashToken(token)), sql`${loginChallenges.expiresAt} > now()`, eq(users.status, "active"), eq(users.role, "admin")))
    return row
}

/** Counts one guess against the challenge before it is checked, so parallel guesses can't share an allowance. Undefined once none are left. */
export async function countAttempt(db: Db, challengeId: string) {
    const [row] = await db.update(loginChallenges)
        .set({ attempts: sql`${loginChallenges.attempts} + 1` })
        .where(and(eq(loginChallenges.id, challengeId), lt(loginChallenges.attempts, MAX_CHALLENGE_ATTEMPTS)))
        .returning({ attempts: loginChallenges.attempts })
    return row?.attempts
}

export const deleteChallenge = (db: Pick<Db, "delete">, challengeId: string) => db.delete(loginChallenges).where(eq(loginChallenges.id, challengeId))

export async function hasConfirmedTotp(db: Pick<Db, "select">, userId: string) {
    const [row] = await db.select({ userId: userTotp.userId }).from(userTotp).where(and(eq(userTotp.userId, userId), isNotNull(userTotp.confirmedAt)))
    return row !== undefined
}

/** Stores a fresh unconfirmed secret and returns it. Undefined when the user already has a confirmed one, which is never replaced here. */
export async function startEnrollment(db: Db, key: string, userId: string) {
    const secret = generateTotpSecret()
    const secretEnc = encryptWithKey(key, secret, aad(userId))
    const [row] = await db.insert(userTotp).values({ userId, secretEnc })
        .onConflictDoUpdate({ target: userTotp.userId, set: { secretEnc, lastStep: 0, createdAt: new Date() }, setWhere: isNull(userTotp.confirmedAt) })
        .returning({ userId: userTotp.userId })
    return row ? secret : undefined
}

/** Gives a user a known, already confirmed secret. For the dev seed and tests; real admins enroll through sign-in. */
export async function storeConfirmedSecret(db: Pick<Db, "insert">, key: string, userId: string, secret: Uint8Array) {
    await db.insert(userTotp).values({ userId, secretEnc: encryptWithKey(key, secret, aad(userId)), confirmedAt: new Date() })
}

/** Confirms a pending enrollment with its first code and issues the recovery codes. Undefined when the code is wrong or nothing is pending. */
export async function confirmEnrollment(db: Db, key: string, userId: string, code: string) {
    const [pending] = await db.select().from(userTotp).where(and(eq(userTotp.userId, userId), isNull(userTotp.confirmedAt)))
    if (!pending)
        return undefined
    const step = matchingStep(decryptWithKey(key, pending.secretEnc, aad(userId)), code)
    if (step === undefined)
        return undefined
    return db.transaction(async tx => {
        // Matching the secret too: a second enrollStart may have replaced the one this code proves.
        const [confirmed] = await tx.update(userTotp)
            .set({ confirmedAt: new Date(), lastStep: step })
            .where(and(eq(userTotp.userId, userId), isNull(userTotp.confirmedAt), eq(userTotp.secretEnc, pending.secretEnc)))
            .returning({ userId: userTotp.userId })
        return confirmed ? issueRecoveryCodes(tx, userId) : undefined
    })
}

/**
 * True when `code` is right for the user's confirmed secret and newer than the last one accepted.
 * The step is claimed in one statement, so the same code can't pass twice even in parallel.
 */
export async function acceptTotpCode(db: Db, key: string, userId: string, code: string) {
    const [row] = await db.select().from(userTotp).where(and(eq(userTotp.userId, userId), isNotNull(userTotp.confirmedAt)))
    if (!row)
        return false
    const step = matchingStep(decryptWithKey(key, row.secretEnc, aad(userId)), code)
    if (step === undefined)
        return false
    const claimed = await db.update(userTotp).set({ lastStep: step })
        .where(and(eq(userTotp.userId, userId), lt(userTotp.lastStep, step)))
        .returning({ userId: userTotp.userId })
    return claimed.length > 0
}

const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, "")

function newRecoveryCode() {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("")
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
}

/** Replaces the user's recovery codes and returns the new ones, the only time they exist in the clear. */
export async function issueRecoveryCodes(tx: Pick<Db, "delete" | "insert">, userId: string) {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
    await tx.insert(recoveryCodes).values(codes.map(code => ({ userId, codeHash: hashToken(normalizeRecoveryCode(code)) })))
    return codes
}

/** Spends a recovery code; each works once. Returns how many the user has left, or undefined when the code is wrong or used. */
export async function claimRecoveryCode(db: Db, userId: string, code: string) {
    const claimed = await db.update(recoveryCodes).set({ usedAt: new Date() })
        .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hashToken(normalizeRecoveryCode(code))), isNull(recoveryCodes.usedAt)))
        .returning({ id: recoveryCodes.id })
    if (!claimed.length)
        return undefined
    return db.$count(recoveryCodes, and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
}

/** Forgets a user's authenticator and recovery codes and ends their admin sessions, so their next admin sign-in enrolls again. */
export async function resetSecondFactor(db: Pick<Db, "transaction">, userId: string) {
    await db.transaction(async tx => {
        await tx.delete(userTotp).where(eq(userTotp.userId, userId))
        await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
        await tx.delete(loginChallenges).where(eq(loginChallenges.userId, userId))
        await tx.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.audience, "admin")))
    })
}
