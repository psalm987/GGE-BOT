import type {} from "@fastify/cookie"
import { ORPCError } from "@orpc/server"
import {
    CHALLENGE_COOKIE, CHALLENGE_TTL_MS, MAX_CHALLENGE_ATTEMPTS, acceptTotpCode, claimRecoveryCode, confirmEnrollment, countAttempt,
    createChallenge, deleteChallenge, findChallenge, hasConfirmedTotp, issueRecoveryCodes, startEnrollment,
} from "../auth/second-factor.ts"
import { base32Encode, otpauthUri } from "../auth/totp.ts"
import type { Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import { sendEmail } from "../services/email.ts"
import { publicUser, startSession, tooMany, verifyCredentials } from "./auth.ts"

// Scoped to the admin API, so the browser sends it nowhere else.
const COOKIE_PATH = "/admin/rpc"
const WRONG_CODE = "That code isn't right. Check your authenticator app and try again."
const WRONG_RECOVERY_CODE = "That recovery code isn't right, or it was already used."

const signInAgain = (message: string) => new ORPCError("UNAUTHORIZED", { message })

/** Password step. It never starts a session: it leaves a challenge cookie that the second step must present. */
export async function adminLogin(ctx: Ctx, input: { login: string; password: string }) {
    const user = await verifyCredentials(ctx, "admin", input)
    const token = await createChallenge(ctx.db, { userId: user.id, ip: ctx.req.ip })
    ctx.reply.setCookie(CHALLENGE_COOKIE, token, {
        httpOnly: true,
        secure: ctx.env.COOKIE_SECURE,
        sameSite: "strict",
        path: COOKIE_PATH,
        maxAge: CHALLENGE_TTL_MS / 1000,
    })
    return { step: await hasConfirmedTotp(ctx.db, user.id) ? "totp" as const : "enroll" as const }
}

type Challenge = NonNullable<Awaited<ReturnType<typeof findChallenge>>>

async function liveChallenge(ctx: Ctx) {
    const token = ctx.req.cookies[CHALLENGE_COOKIE]
    const challenge = token ? await findChallenge(ctx.db, token) : undefined
    if (!challenge)
        throw signInAgain("Your sign-in timed out. Sign in again.")
    return challenge
}

async function endChallenge(ctx: Ctx, challenge: Challenge) {
    await deleteChallenge(ctx.db, challenge.id)
    ctx.reply.clearCookie(CHALLENGE_COOKIE, { path: COOKIE_PATH })
}

// Wrong codes are capped twice: per challenge, and per admin across challenges, since each
// correct password buys a new challenge.
const guessKey = (userId: string) => `2fa:${userId}`

/** Runs one guess under the caps. `check` answers undefined for a wrong code. */
async function guess<T>(ctx: Ctx, challenge: Challenge, wrong: string, check: () => Promise<T | undefined>) {
    if (!ctx.limits.user.hit(guessKey(challenge.user.id)))
        throw tooMany()
    const attempts = await countAttempt(ctx.db, challenge.id)
    const result = attempts === undefined ? undefined : await check()
    if (result !== undefined) {
        ctx.limits.user.reset(guessKey(challenge.user.id))
        return result
    }
    if (attempts === undefined || attempts >= MAX_CHALLENGE_ATTEMPTS) {
        await endChallenge(ctx, challenge)
        throw signInAgain("Too many wrong codes. Sign in again.")
    }
    throw new ORPCError("BAD_REQUEST", { message: wrong })
}

async function finishSignIn(ctx: Ctx, challenge: Challenge) {
    await endChallenge(ctx, challenge)
    await audit(ctx.db, { actorId: challenge.user.id, action: "auth.login.admin" })
    return startSession(ctx, "admin", publicUser(challenge.user))
}

export async function verifyTotp(ctx: Ctx, input: { code: string } | { recoveryCode: string }) {
    const challenge = await liveChallenge(ctx)
    const { user } = challenge
    if (!await hasConfirmedTotp(ctx.db, user.id))
        throw new ORPCError("FORBIDDEN", { message: "Set up two-factor sign-in first" })

    if ("code" in input) {
        await guess(ctx, challenge, WRONG_CODE, async () => await acceptTotpCode(ctx.db, ctx.env.TOTP_ENCRYPTION_KEY, user.id, input.code) || undefined)
        return finishSignIn(ctx, challenge)
    }
    const remaining = await guess(ctx, challenge, WRONG_RECOVERY_CODE, () => claimRecoveryCode(ctx.db, user.id, input.recoveryCode))
    await audit(ctx.db, { actorId: user.id, action: "auth.recovery_code.used", meta: { remaining, ip: ctx.req.ip } })
    if (user.email)
        await sendEmail(ctx, "recovery_code_used", user.email, { remaining }, user.id)
    return finishSignIn(ctx, challenge)
}

const ALREADY_ENROLLED = "Two-factor sign-in is already set up"

export async function enrollStart(ctx: Ctx) {
    const { user } = await liveChallenge(ctx)
    const secret = await startEnrollment(ctx.db, ctx.env.TOTP_ENCRYPTION_KEY, user.id)
    if (!secret)
        throw new ORPCError("FORBIDDEN", { message: ALREADY_ENROLLED })
    return { otpauthUri: otpauthUri(user.username, secret), secret: base32Encode(secret) }
}

export async function enrollConfirm(ctx: Ctx, input: { code: string }) {
    const challenge = await liveChallenge(ctx)
    const { user } = challenge
    if (await hasConfirmedTotp(ctx.db, user.id))
        throw new ORPCError("FORBIDDEN", { message: ALREADY_ENROLLED })
    const recoveryCodes = await guess(ctx, challenge, WRONG_CODE, () => confirmEnrollment(ctx.db, ctx.env.TOTP_ENCRYPTION_KEY, user.id, input.code))
    await audit(ctx.db, { actorId: user.id, action: "auth.totp.enrolled" })
    return { user: await finishSignIn(ctx, challenge), recoveryCodes }
}

export async function regenerateRecoveryCodes(ctx: Ctx, user: { id: string }, input: { code: string }) {
    if (!ctx.limits.user.hit(guessKey(user.id)))
        throw tooMany()
    if (!await acceptTotpCode(ctx.db, ctx.env.TOTP_ENCRYPTION_KEY, user.id, input.code))
        throw new ORPCError("BAD_REQUEST", { message: WRONG_CODE })
    ctx.limits.user.reset(guessKey(user.id))
    const codes = await ctx.db.transaction(tx => issueRecoveryCodes(tx, user.id))
    await audit(ctx.db, { actorId: user.id, action: "auth.recovery_codes.regenerated" })
    return codes
}
