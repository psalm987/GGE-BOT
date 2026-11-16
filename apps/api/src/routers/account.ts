import { ORPCError } from "@orpc/server"
import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { auditLog, disconnectUser, users } from "@gge/db"
import { claimToken, issueToken } from "../auth/email-tokens.ts"
import { verifyPassword } from "../auth/passwords.ts"
import { COOKIE_NAME, hashToken, revokeUserSessions, type SessionUser } from "../auth/sessions.ts"
import { isUniqueViolation, type Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import { clientLink, sendEmail } from "../services/email.ts"
import { DISPOSABLE_MESSAGE, isDisposable } from "../services/email-policy.ts"
import { BAD_LINK, mailVerification, sendVerification, storePassword, tooMany } from "./auth.ts"

const EMAIL_IN_USE = "That email is already in use"

export async function resendVerification(ctx: Ctx, user: SessionUser) {
    if (!user.email)
        throw new ORPCError("BAD_REQUEST", { message: "Add an email address first" })
    if (user.emailVerified)
        return
    if (!ctx.limits.email.hit(`verify:${user.id}`))
        throw tooMany()
    await sendVerification(ctx, user, user.email)
}

export async function addEmail(ctx: Ctx, user: SessionUser, input: { email: string }) {
    if (isDisposable(input.email))
        throw new ORPCError("BAD_REQUEST", { message: DISPOSABLE_MESSAGE })
    if (!ctx.limits.email.hit(`verify:${user.id}`))
        throw tooMany()
    // One transaction, so a failure to store the token can't leave an address nobody was sent a link for.
    const token = await ctx.db.transaction(async tx => {
        const [updated] = await tx.update(users)
            .set({ email: input.email, emailVerifiedAt: null, updatedAt: new Date() })
            // Only before the address is confirmed, so a typo at sign-up can be fixed; a confirmed one changes through changeEmail.
            .where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)))
            .returning({ id: users.id })
            .catch(error => {
                if (isUniqueViolation(error, "users_email_canonical"))
                    throw new ORPCError("CONFLICT", { message: EMAIL_IN_USE })
                throw error
            })
        if (!updated)
            throw new ORPCError("CONFLICT", { message: "Your email is already confirmed. Change it in Settings." })
        await audit(tx, { actorId: user.id, action: "account.email.add" })
        return issueToken(tx, { userId: user.id, purpose: "verify_email", email: input.email })
    })
    await mailVerification(ctx, user.id, input.email, token)
}

/**
 * The caller's row, once `password` proves to be theirs. Wrong guesses count per user and `purpose`,
 * apart from the sign-in caps, so failed sign-ins never block these and these never block sign-in.
 */
async function confirmPassword(ctx: Ctx, user: SessionUser, purpose: string, password: string) {
    const bucket = `${purpose}:${user.id}`
    if (!ctx.limits.user.hit(bucket))
        throw tooMany()
    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id))
    if (!row || !await verifyPassword(row, password))
        throw new ORPCError("BAD_REQUEST", { message: "Your current password is wrong" })
    ctx.limits.user.reset(bucket)
    return row
}

export async function changePassword(ctx: Ctx, user: SessionUser, input: { current: string; next: string }) {
    const row = await confirmPassword(ctx, user, "pwchange", input.current)
    const sessionId = hashToken(ctx.req.cookies[COOKIE_NAME.client]!)
    await ctx.db.transaction(async tx => {
        await storePassword(tx, user.id, input.next)
        await revokeUserSessions(tx, user.id, { except: sessionId })
    })
    await audit(ctx.db, { actorId: user.id, action: "auth.password.change" })
    if (row.email)
        await sendEmail(ctx, "password_changed", row.email, {}, user.id)
}

/** Starts replacing a verified email. The account keeps the old address until the new one opens its link. */
export async function changeEmail(ctx: Ctx, user: SessionUser, input: { email: string; password: string }) {
    const row = await confirmPassword(ctx, user, "emailchange", input.password)
    if (!row.email)
        throw new ORPCError("BAD_REQUEST", { message: "Add an email address first" })
    if (!row.emailVerifiedAt)
        throw new ORPCError("BAD_REQUEST", { message: "Verify your current email before you change it" })
    if (isDisposable(input.email))
        throw new ORPCError("BAD_REQUEST", { message: DISPOSABLE_MESSAGE })
    if (input.email === row.email.toLowerCase())
        throw new ORPCError("BAD_REQUEST", { message: "That is already your email" })
    const [taken] = await ctx.db.select({ id: users.id }).from(users)
        .where(and(eq(users.emailCanonical, sql`canonical_email(${input.email})`), ne(users.id, user.id)))
    if (taken)
        throw new ORPCError("CONFLICT", { message: EMAIL_IN_USE })
    if (!ctx.limits.email.hit(`change:${user.id}`))
        throw tooMany()

    const token = await ctx.db.transaction(async tx => {
        await audit(tx, { actorId: user.id, action: "account.email.change_requested" })
        return issueToken(tx, { userId: user.id, purpose: "change_email", email: input.email, currentEmail: row.email! })
    })
    await sendEmail(ctx, "change_email", input.email, { link: clientLink(ctx, "/confirm-email-change", { token }) }, user.id)
    await sendEmail(ctx, "email_change_requested", row.email, { newEmail: input.email }, user.id)
}

/** Applies a change the new address confirmed, and signs the user out everywhere: the email is a sign-in name. */
export async function confirmEmailChange(ctx: Ctx, input: { token: string }) {
    const change = await ctx.db.transaction(async tx => {
        const claimed = await claimToken(tx, "change_email", input.token)
        if (!claimed?.currentEmail)
            throw new ORPCError("BAD_REQUEST", { message: BAD_LINK })
        // Only while the account still has the address the link was issued against, so a link from before another change is dead.
        const [user] = await tx.update(users)
            .set({ email: claimed.email, emailVerifiedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(users.id, claimed.userId), eq(users.email, claimed.currentEmail)))
            .returning({ id: users.id })
            .catch(error => {
                if (isUniqueViolation(error, "users_email_canonical"))
                    throw new ORPCError("CONFLICT", { message: EMAIL_IN_USE })
                throw error
            })
        if (!user)
            throw new ORPCError("BAD_REQUEST", { message: BAD_LINK })
        await revokeUserSessions(tx, user.id)
        await audit(tx, { actorId: user.id, action: "account.email.changed" })
        return { userId: user.id, from: claimed.currentEmail, to: claimed.email }
    })
    ctx.reply.clearCookie(COOKIE_NAME.client, { path: "/" })
    await sendEmail(ctx, "email_changed", change.from, { newEmail: change.to }, change.userId)
}

export async function deleteMe(ctx: Ctx, user: SessionUser, input: { password: string; confirmUsername: string }) {
    const row = await confirmPassword(ctx, user, "delete", input.password)
    if (input.confirmUsername.toLowerCase() !== row.username.toLowerCase())
        throw new ORPCError("BAD_REQUEST", { message: "Type your username to confirm" })
    await ctx.db.transaction(async tx => {
        // Locked, so two admins deleting themselves at once can't both see the other as the one who stays.
        const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"))).for("update")
        if (admins.length === 1 && admins[0]!.id === row.id)
            throw new ORPCError("CONFLICT", { message: "You are the only admin. Make someone else an admin before you delete this account." })
        // The rows outlive the user with no actor. All of meta goes, not only the keys known to hold
        // personal data (signup's ip and emailCanonical), so a key added later is erased too.
        await tx.update(auditLog).set({ meta: null }).where(eq(auditLog.actorId, row.id))
        // Cascades to sessions, game accounts and everything under them; the runner stops the bots on the game_accounts notify.
        await tx.delete(users).where(eq(users.id, row.id))
        await disconnectUser(tx, row.id)
        await audit(tx, { actorId: null, action: "account.deleted", meta: { userId: row.id } })
    })
    ctx.reply.clearCookie(COOKIE_NAME.client, { path: "/" })
    if (row.email && row.emailVerifiedAt)
        await sendEmail(ctx, "account_deleted", row.email, { username: row.username }, null)
}
