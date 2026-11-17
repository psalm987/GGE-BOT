import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, ne, sql } from "drizzle-orm"
import { disconnectUser, sessions, users, type Db } from "@gge/db"
import type { PublicUser } from "@gge/contracts"

export type Audience = "client" | "admin"

export const SESSION_TTL_MS: Record<Audience, number> = {
    client: 30 * 24 * 3600_000,
    admin: 12 * 3600_000,
}
export const COOKIE_NAME: Record<Audience, string> = { client: "gge_session", admin: "gge_admin" }

const SLIDE_AFTER_MS = 5 * 60_000

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export async function createSession(db: Db, input: { userId: string; audience: Audience; ip?: string; userAgent?: string }) {
    const token = randomBytes(32).toString("base64url")
    await db.insert(sessions).values({
        id: hashToken(token),
        userId: input.userId,
        audience: input.audience,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS[input.audience]),
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300),
    })
    return token
}

export type SessionUser = PublicUser

/** The active user behind a token, sliding its expiry forward on use. */
export async function findSessionUser(db: Db, token: string, audience: Audience): Promise<SessionUser | null> {
    const id = hashToken(token)
    const [row] = await db
        .select({
            user: { id: users.id, username: users.username, role: users.role, email: users.email, emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`, maxBots: users.maxBots, locale: users.locale },
            lastSeenAt: sessions.lastSeenAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), eq(sessions.audience, audience), gt(sessions.expiresAt, sql`now()`), eq(users.status, "active")))
    if (!row)
        return null
    if (Date.now() - row.lastSeenAt.getTime() > SLIDE_AFTER_MS)
        await db.update(sessions)
            .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS[audience]) })
            .where(eq(sessions.id, id))
    return row.user
}

/** Ends one session and closes the user's live connections; a tab that is still signed in elsewhere reconnects. */
export const deleteSession = (db: Pick<Db, "transaction">, token: string) => db.transaction(async tx => {
    const [ended] = await tx.delete(sessions).where(eq(sessions.id, hashToken(token))).returning({ userId: sessions.userId })
    if (ended)
        await disconnectUser(tx, ended.userId)
})

/** Deletes the user's sessions, all but `except` (a session id) when given, and closes their live connections. */
export const revokeUserSessions = (db: Pick<Db, "transaction">, userId: string, { except }: { except?: string } = {}) => db.transaction(async tx => {
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), except ? ne(sessions.id, except) : undefined))
    await disconnectUser(tx, userId)
})
