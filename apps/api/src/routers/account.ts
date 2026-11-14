import { ORPCError } from "@orpc/server"
import { and, eq, isNull } from "drizzle-orm"
import { users } from "@gge/db"
import { verifyPassword } from "../auth/passwords.ts"
import { COOKIE_NAME, hashToken, revokeUserSessions, type SessionUser } from "../auth/sessions.ts"
import { isUniqueViolation, type Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import { sendEmail } from "../services/email.ts"
import { DISPOSABLE_MESSAGE, isDisposable } from "../services/email-policy.ts"
import { sendVerification, storePassword } from "./auth.ts"

const tooMany = () => new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a few minutes." })

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
    const [updated] = await ctx.db.update(users)
        .set({ email: input.email, emailVerifiedAt: null, updatedAt: new Date() })
        .where(and(eq(users.id, user.id), isNull(users.email)))
        .returning({ id: users.id })
        .catch(error => {
            if (isUniqueViolation(error, "users_email_canonical"))
                throw new ORPCError("CONFLICT", { message: "That email is already in use" })
            throw error
        })
    if (!updated)
        throw new ORPCError("CONFLICT", { message: "This account already has an email" })
    await audit(ctx.db, { actorId: user.id, action: "account.email.add" })
    await sendVerification(ctx, user, input.email)
}

export async function changePassword(ctx: Ctx, user: SessionUser, input: { current: string; next: string }) {
    const bucket = `pwchange:${user.id}`
    if (!ctx.limits.user.hit(bucket))
        throw tooMany()
    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id))
    if (!row || !await verifyPassword(row, input.current))
        throw new ORPCError("BAD_REQUEST", { message: "Your current password is wrong" })
    ctx.limits.user.reset(bucket)

    const sessionId = hashToken(ctx.req.cookies[COOKIE_NAME.client]!)
    await ctx.db.transaction(async tx => {
        await storePassword(tx, user.id, input.next)
        await revokeUserSessions(tx, user.id, { except: sessionId })
    })
    await audit(ctx.db, { actorId: user.id, action: "auth.password.change" })
    if (row.email)
        await sendEmail(ctx, "password_changed", row.email, {}, user.id)
}
