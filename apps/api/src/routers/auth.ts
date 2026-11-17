import type {} from "@fastify/cookie"
import { ORPCError } from "@orpc/server"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { users, type Db } from "@gge/db"
import type { PublicUser } from "@gge/contracts"
import { isLocale } from "@gge/i18n"
import { claimToken, issueToken } from "../auth/email-tokens.ts"
import { hashPassword, verifyNobody, verifyPassword } from "../auth/passwords.ts"
import { COOKIE_NAME, SESSION_TTL_MS, createSession, deleteSession, findSessionUser, revokeUserSessions, type Audience } from "../auth/sessions.ts"
import { isUniqueViolation, type Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import { billingLiveForTrial } from "../services/billing.ts"
import { clientLink, sendEmail } from "../services/email.ts"
import { DISPOSABLE_MESSAGE, isDisposable } from "../services/email-policy.ts"
import { grantTrial } from "../services/plans.ts"
import { verifyTurnstile } from "../services/turnstile.ts"

const WRONG_CREDENTIALS = "Wrong username or password"

function setSessionCookie(ctx: Ctx, audience: Audience, token: string) {
    ctx.reply.setCookie(COOKIE_NAME[audience], token, {
        httpOnly: true,
        secure: ctx.env.COOKIE_SECURE,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_MS[audience] / 1000,
    })
}

export const publicUser = (user: typeof users.$inferSelect): PublicUser =>
    ({ id: user.id, username: user.username, role: user.role, email: user.email, emailVerified: user.emailVerifiedAt !== null, maxBots: user.maxBots, locale: user.locale })

export async function startSession(ctx: Ctx, audience: Audience, user: PublicUser) {
    const token = await createSession(ctx.db, { userId: user.id, audience, ip: ctx.req.ip, userAgent: ctx.req.headers["user-agent"] })
    setSessionCookie(ctx, audience, token)
    return user
}

export async function sendVerification(ctx: Ctx, user: { id: string }, email: string) {
    const token = await issueToken(ctx.db, { userId: user.id, purpose: "verify_email", email })
    await mailVerification(ctx, user.id, email, token)
}

export function mailVerification(ctx: Ctx, userId: string, email: string, token: string) {
    return sendEmail(ctx, "verify_email", email, { link: clientLink(ctx, "/verify-email", { token }) }, userId)
}

/** Stores a new password (always argon2id, so it also upgrades legacy hashes). */
export async function storePassword(tx: Pick<Db, "update">, userId: string, password: string) {
    await tx.update(users)
        .set({ passwordHash: await hashPassword(password), passwordAlgo: "argon2id", passwordSalt: null, updatedAt: new Date() })
        .where(eq(users.id, userId))
}

export async function currentUser(ctx: Ctx, audience: Audience) {
    const token = ctx.req.cookies[COOKIE_NAME[audience]]
    return token ? findSessionUser(ctx.db, token, audience) : null
}

export const tooMany = () => new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a few minutes." })

/** The user behind a correct username and password who may use this app. Starts no session. */
export async function verifyCredentials(ctx: Ctx, audience: Audience, input: { login: string; password: string }) {
    if (!ctx.limits.ip.hit(ctx.req.ip))
        throw tooMany()
    const name = input.login.toLowerCase()
    const [user] = await ctx.db.select().from(users).where(name.includes("@")
        ? eq(users.emailCanonical, sql`canonical_email(${name})`)
        : eq(sql`lower(${users.username})`, name))

    // Keyed by the account, so every spelling of its email shares one allowance. Attempts are
    // counted up front, so concurrent guesses can't all slip past the check, and handed back once
    // the password proves right. The strict cap is per IP too, so a stranger's guesses can't lock
    // the owner out; the looser total still caps guesses spread over many IPs.
    const target = user?.id ?? name
    const strictKey = `${target}|${ctx.req.ip}`
    if (!ctx.limits.user.hit(strictKey) || !ctx.limits.userTotal.hit(target))
        throw tooMany()
    if (!user || !await verifyPassword(user, input.password)) {
        if (!user)
            await verifyNobody(input.password)
        throw new ORPCError("UNAUTHORIZED", { message: WRONG_CREDENTIALS })
    }
    ctx.limits.user.reset(strictKey)
    ctx.limits.userTotal.refund(target)
    if (user.status !== "active")
        throw new ORPCError("FORBIDDEN", { message: "This account is disabled" })
    if (audience === "admin" && user.role !== "admin")
        throw new ORPCError("FORBIDDEN", { message: "This account is not an admin" })

    if (user.passwordAlgo === "pbkdf2-legacy")
        await storePassword(ctx.db, user.id, input.password)
    return user
}

export async function login(ctx: Ctx, input: { login: string; password: string }) {
    const user = await verifyCredentials(ctx, "client", input)
    await audit(ctx.db, { actorId: user.id, action: "auth.login.client" })
    return startSession(ctx, "client", publicUser(user))
}

export async function logout(ctx: Ctx, audience: Audience) {
    const token = ctx.req.cookies[COOKIE_NAME[audience]]
    if (token)
        await deleteSession(ctx.db, token)
    ctx.reply.clearCookie(COOKIE_NAME[audience], { path: "/" })
}

/** The language the browser says it is showing, so the first emails can match it. Anything that isn't one of ours is dropped. */
function headerLocale(ctx: Ctx) {
    const value = ctx.req.headers["x-gge-locale"]
    return typeof value === "string" && isLocale(value) ? value : null
}

export async function signup(ctx: Ctx, input: { username: string; email: string; password: string; turnstileToken?: string }) {
    if (!ctx.limits.ip.hit(ctx.req.ip) || !ctx.limits.signup.hit(ctx.req.ip))
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a few minutes." })
    if (!await verifyTurnstile(ctx.env.TURNSTILE_SECRET_KEY, input.turnstileToken, ctx.req.ip))
        throw new ORPCError("BAD_REQUEST", { message: "Captcha failed, please retry" })

    if (isDisposable(input.email))
        throw new ORPCError("BAD_REQUEST", { message: DISPOSABLE_MESSAGE })

    const passwordHash = await hashPassword(input.password)
    // One transaction, so a failure after the insert can't leave an account nobody can sign in
    // to whose username then reads as taken.
    const { user, token } = await ctx.db.transaction(async tx => {
        const user = await tx.insert(users)
            .values({ username: input.username, email: input.email, passwordHash, detectedLocale: headerLocale(ctx) })
            .returning()
            .then(([created]) => created!, error => {
                if (isUniqueViolation(error, "users_username_lower"))
                    throw new ORPCError("CONFLICT", { message: "That username is taken" })
                if (isUniqueViolation(error, "users_email_canonical"))
                    throw new ORPCError("CONFLICT", { message: "That email is already in use" })
                throw error
            })
        await audit(tx, { actorId: user.id, action: "auth.signup", meta: { ip: ctx.req.ip, emailCanonical: user.emailCanonical } })
        const token = await issueToken(tx, { userId: user.id, purpose: "verify_email", email: input.email })
        return { user, token }
    })
    await mailVerification(ctx, user.id, input.email, token)
    return startSession(ctx, "client", publicUser(user))
}

export const BAD_LINK = "This link is invalid or has expired"

export async function requestPasswordReset(ctx: Ctx, input: { email: string }) {
    if (!ctx.limits.ip.hit(ctx.req.ip) || !ctx.limits.email.hit(`reset:${input.email}`))
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a few minutes." })
    const [user] = await ctx.db.select().from(users)
        .where(and(eq(users.emailCanonical, sql`canonical_email(${input.email})`), eq(users.status, "active"), isNotNull(users.emailVerifiedAt)))
    // Detached so a verified address answers as fast as an unknown one. A lookalike address
    // (a+x@ for a@) matches the account, but the link only ever goes to the stored address.
    // The per-account cap stops variants each spending their own per-address allowance on
    // one inbox; going over it skips the send silently so the reply never reveals the account.
    if (user?.email && ctx.limits.email.hit(`reset-account:${user.id}`))
        void sendResetLink(ctx, user.id, user.email).catch(error => ctx.req.log.error({ err: error }, "password reset request failed"))
    return { ok: true as const }
}

async function sendResetLink(ctx: Ctx, userId: string, email: string) {
    const token = await issueToken(ctx.db, { userId, purpose: "reset_password", email })
    await sendEmail(ctx, "reset_password", email, { link: clientLink(ctx, "/reset-password", { token }) }, userId)
    await audit(ctx.db, { actorId: userId, action: "auth.password.reset_requested" })
}

export async function resetPassword(ctx: Ctx, input: { token: string; password: string }) {
    const user = await ctx.db.transaction(async tx => {
        const claimed = await claimToken(tx, "reset_password", input.token)
        if (!claimed)
            throw new ORPCError("BAD_REQUEST", { message: BAD_LINK })
        const [user] = await tx.select().from(users).where(and(eq(users.id, claimed.userId), eq(users.status, "active")))
        if (user?.email?.toLowerCase() !== claimed.email.toLowerCase())
            throw new ORPCError("BAD_REQUEST", { message: BAD_LINK })
        await storePassword(tx, user.id, input.password)
        await revokeUserSessions(tx, user.id)
        return user
    })
    await audit(ctx.db, { actorId: user.id, action: "auth.password.reset" })
    await sendEmail(ctx, "password_changed", user.email!, {}, user.id)
}

export async function verifyEmail(ctx: Ctx, input: { token: string }) {
    const userId = await ctx.db.transaction(async tx => {
        const claimed = await claimToken(tx, "verify_email", input.token)
        if (!claimed)
            throw new ORPCError("BAD_REQUEST", { message: BAD_LINK })
        const [user] = await tx.update(users)
            .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(users.id, claimed.userId), eq(sql`lower(${users.email})`, claimed.email)))
            .returning({ id: users.id, role: users.role })
        if (!user)
            throw new ORPCError("BAD_REQUEST", { message: BAD_LINK })
        if (user.role === "user" && await billingLiveForTrial(tx))
            await grantTrial(tx, user.id)
        return user.id
    })
    await audit(ctx.db, { actorId: userId, action: "auth.email.verified" })
}
