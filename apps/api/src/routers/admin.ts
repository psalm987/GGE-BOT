import { implement, ORPCError } from "@orpc/server"
import { and, count, desc, eq, gt, ilike, inArray, lt, sql } from "drizzle-orm"
import { auditLog, botRuns, botStatus, gameAccounts, runnerHeartbeat, users } from "@gge/db"
import { adminContract } from "@gge/contracts"
import { revokeUserSessions } from "../auth/sessions.ts"
import type { Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import { listAccounts, setDesiredState } from "../services/accounts.ts"
import { currentUser, login, logout } from "./auth.ts"

const os = implement(adminContract).$context<Ctx>()

const admin = os.middleware(async ({ context, next }) => {
    const user = await currentUser(context, "admin")
    if (!user)
        throw new ORPCError("UNAUTHORIZED", { message: "Please sign in" })
    if (user.role !== "admin")
        throw new ORPCError("FORBIDDEN", { message: "Admins only" })
    return next({ context: { user } })
})

function notSelf(actorId: string, targetId: string, message: string) {
    if (actorId === targetId)
        throw new ORPCError("BAD_REQUEST", { message })
}

export const adminRouter = os.router({
    auth: {
        login: os.auth.login.handler(({ context, input }) => login(context, "admin", input)),
        logout: os.auth.logout.handler(({ context }) => logout(context, "admin")),
        me: os.auth.me.handler(async ({ context }) => {
            const user = await currentUser(context, "admin")
            return user?.role === "admin" ? user : null
        }),
    },
    overview: os.overview.use(admin).handler(async ({ context: { db } }) => {
        const dayAgo = sql`now() - interval '24 hours'`
        const [[userCount], [accountCount], states, [runner], [runs], [crashes]] = await Promise.all([
            db.select({ n: count() }).from(users),
            db.select({ n: count() }).from(gameAccounts),
            db.select({ state: botStatus.actualState, n: count() }).from(botStatus).groupBy(botStatus.actualState),
            db.select().from(runnerHeartbeat),
            db.select({ n: count() }).from(botRuns).where(gt(botRuns.startedAt, dayAgo)),
            db.select({ n: count() }).from(botRuns).where(and(gt(botRuns.startedAt, dayAgo), inArray(botRuns.endReason, ["crash", "error"]))),
        ])
        const bots = { starting: 0, running: 0, stopped: 0, auth_failed: 0, banned: 0, error: 0 }
        for (const { state, n } of states)
            bots[state] = n
        return {
            users: userCount!.n,
            accounts: accountCount!.n,
            bots,
            runner: runner ? { beatAt: runner.beatAt, startedAt: runner.startedAt, version: runner.version, running: runner.running } : null,
            last24h: { runs: runs!.n, crashes: crashes!.n },
        }
    }),
    users: {
        list: os.users.list.use(admin).handler(({ context: { db }, input }) =>
            db.select({
                id: users.id, username: users.username, role: users.role, email: users.email,
                emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`, status: users.status, createdAt: users.createdAt,
                accountCount: count(gameAccounts.id),
            }).from(users)
                .leftJoin(gameAccounts, eq(gameAccounts.ownerId, users.id))
                .where(input.search ? ilike(users.username, `%${input.search.replace(/[%_\\]/g, "\\$&")}%`) : undefined)
                .groupBy(users.id)
                .orderBy(users.createdAt)),
        setStatus: os.users.setStatus.use(admin).handler(async ({ context: { db, user }, input }) => {
            notSelf(user.id, input.id, "You can't disable yourself")
            const [changed] = await db.update(users).set({ status: input.status, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
            if (!changed)
                throw new ORPCError("NOT_FOUND", { message: "No such user" })
            if (input.status === "disabled") {
                await revokeUserSessions(db, input.id)
                await setDesiredState(db, eq(gameAccounts.ownerId, input.id), "stopped")
            }
            await audit(db, { actorId: user.id, action: `user.${input.status === "disabled" ? "disable" : "enable"}`, targetType: "user", targetId: input.id })
        }),
        setRole: os.users.setRole.use(admin).handler(async ({ context: { db, user }, input }) => {
            notSelf(user.id, input.id, "You can't change your own role")
            const [changed] = await db.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
            if (!changed)
                throw new ORPCError("NOT_FOUND", { message: "No such user" })
            await revokeUserSessions(db, input.id)
            await audit(db, { actorId: user.id, action: "user.set_role", targetType: "user", targetId: input.id, meta: { role: input.role } })
        }),
        revokeSessions: os.users.revokeSessions.use(admin).handler(async ({ context: { db, user }, input }) => {
            await revokeUserSessions(db, input.id)
            await audit(db, { actorId: user.id, action: "user.revoke_sessions", targetType: "user", targetId: input.id })
        }),
    },
    accounts: {
        list: os.accounts.list.use(admin).handler(async ({ context: { db } }) => {
            const owners = new Map((await db.select({ id: users.id, username: users.username }).from(users)).map(u => [u.id, u.username]))
            return (await listAccounts(db, undefined)).map(({ plugins: _, ownerId, ...account }) => ({ ...account, owner: owners.get(ownerId) ?? "?" }))
        }),
        forceStop: os.accounts.forceStop.use(admin).handler(async ({ context: { db, user }, input }) => {
            const changed = await setDesiredState(db, eq(gameAccounts.id, input.id), "stopped")
            if (!changed.length)
                throw new ORPCError("NOT_FOUND", { message: "No such account" })
            await audit(db, { actorId: user.id, action: "account.force_stop", targetType: "account", targetId: input.id })
        }),
    },
    audit: {
        list: os.audit.list.use(admin).handler(({ context: { db }, input }) =>
            db.select({
                id: auditLog.id, actor: users.username, action: auditLog.action, targetType: auditLog.targetType,
                targetId: auditLog.targetId, meta: auditLog.meta, ts: auditLog.ts,
            }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
                .where(input.before ? lt(auditLog.id, input.before) : undefined)
                .orderBy(desc(auditLog.id)).limit(input.limit)),
    },
})
