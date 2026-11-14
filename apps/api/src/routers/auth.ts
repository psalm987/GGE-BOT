import { createHash } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { invites, users } from "@gge/db"
import type { PublicUser } from "@gge/contracts"
import { hashPassword, verifyNobody, verifyPassword } from "../auth/passwords.ts"
import { COOKIE_NAME, SESSION_TTL_MS, createSession, deleteSession, findSessionUser, type Audience, type SessionUser } from "../auth/sessions.ts"
import { isUniqueViolation, type Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"

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

async function startSession(ctx: Ctx, audience: Audience, user: SessionUser): Promise<PublicUser> {
    const token = await createSession(ctx.db, { userId: user.id, audience, ip: ctx.req.ip, userAgent: ctx.req.headers["user-agent"] })
    setSessionCookie(ctx, audience, token)
    return { id: user.id, username: user.username, role: user.role }
}

export async function currentUser(ctx: Ctx, audience: Audience) {
    const token = ctx.req.cookies[COOKIE_NAME[audience]]
    return token ? findSessionUser(ctx.db, token, audience) : null
}

export async function login(ctx: Ctx, audience: Audience, input: { username: string; password: string }) {
    const name = input.username.toLowerCase()
    if (!ctx.limits.ip.hit(ctx.req.ip) || !ctx.limits.user.hit(name))
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a few minutes." })

    const [user] = await ctx.db.select().from(users).where(eq(sql`lower(${users.username})`, name))
    if (!user || !await verifyPassword(user, input.password)) {
        if (!user)
            await verifyNobody(input.password)
        throw new ORPCError("UNAUTHORIZED", { message: WRONG_CREDENTIALS })
    }
    if (user.status !== "active")
        throw new ORPCError("FORBIDDEN", { message: "This account is disabled" })
    if (audience === "admin" && user.role !== "admin")
        throw new ORPCError("FORBIDDEN", { message: "This account is not an admin" })

    if (user.passwordAlgo === "pbkdf2-legacy")
        await ctx.db.update(users)
            .set({ passwordHash: await hashPassword(input.password), passwordAlgo: "argon2id", passwordSalt: null, updatedAt: new Date() })
            .where(eq(users.id, user.id))

    ctx.limits.user.reset(name)
    await audit(ctx.db, { actorId: user.id, action: `auth.login.${audience}` })
    return startSession(ctx, audience, user)
}

export async function logout(ctx: Ctx, audience: Audience) {
    const token = ctx.req.cookies[COOKIE_NAME[audience]]
    if (token)
        await deleteSession(ctx.db, token)
    ctx.reply.clearCookie(COOKIE_NAME[audience], { path: "/" })
}

export const hashInviteCode = (code: string) => createHash("sha256").update(code).digest("hex")

export async function signup(ctx: Ctx, input: { inviteCode: string; username: string; password: string }) {
    if (!ctx.limits.ip.hit(ctx.req.ip))
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in a few minutes." })

    const passwordHash = await hashPassword(input.password)
    const user = await ctx.db.transaction(async tx => {
        const [invite] = await tx.update(invites)
            .set({ usedAt: new Date() })
            .where(and(eq(invites.codeHash, hashInviteCode(input.inviteCode)), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`)))
            .returning()
        if (!invite)
            throw new ORPCError("BAD_REQUEST", { message: "This invite is invalid, used or expired" })
        const [created] = await tx.insert(users)
            .values({ username: input.username, passwordHash, role: invite.role })
            .returning({ id: users.id, username: users.username, role: users.role })
        await tx.update(invites).set({ usedBy: created!.id }).where(eq(invites.id, invite.id))
        return created!
    }).catch(error => {
        if (isUniqueViolation(error, "users_username_lower"))
            throw new ORPCError("CONFLICT", { message: "That username is taken" })
        throw error
    })
    await audit(ctx.db, { actorId: user.id, action: "auth.signup" })
    return startSession(ctx, "client", user)
}
