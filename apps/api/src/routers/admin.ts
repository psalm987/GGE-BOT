import { implement, ORPCError } from "@orpc/server"
import { and, count, desc, eq, gt, ilike, inArray, like, lt, max, or, sql } from "drizzle-orm"
import { appSettings, auditLog, botRuns, botStatus, gameAccounts, runnerHeartbeat, sessions, userTotp, users, type Db } from "@gge/db"
import { adminContract } from "@gge/contracts"
import { resetSecondFactor } from "../auth/second-factor.ts"
import { revokeUserSessions } from "../auth/sessions.ts"
import type { Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import { accountLogs, accountRuns, listAccounts, setDesiredState, stopUnentitled } from "../services/accounts.ts"
import { createProxy, listProxies, proxiesOfAccounts, removeProxy, setAccountProxy, updateProxy } from "../services/proxies.ts"
import { adminLogin, enrollConfirm, enrollStart, regenerateRecoveryCodes, verifyTotp } from "./admin-auth.ts"
import { currentUser, logout } from "./auth.ts"

/** A LIKE pattern for "contains", with `%`, `_` and backslash in the text matched literally. */
const contains = (text: string) => `%${text.replace(/[%_\\]/g, "\\$&")}%`

/** Every `AdminUser` column, with the account count; filter, then group by user id. */
const adminUsers = (db: Db) => db.select({
    id: users.id, username: users.username, role: users.role, email: users.email,
    emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`, maxBots: users.maxBots, status: users.status, createdAt: users.createdAt,
    attackPluginCap: users.attackPluginCap,
    accountCount: count(gameAccounts.id),
    totpEnabled: sql<boolean>`exists (select 1 from ${userTotp} where ${userTotp.userId} = ${users.id} and ${userTotp.confirmedAt} is not null)`,
}).from(users).leftJoin(gameAccounts, eq(gameAccounts.ownerId, users.id))

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
        login: os.auth.login.handler(({ context, input }) => adminLogin(context, input)),
        verifyTotp: os.auth.verifyTotp.handler(({ context, input }) => verifyTotp(context, input)),
        enrollStart: os.auth.enrollStart.handler(({ context }) => enrollStart(context)),
        enrollConfirm: os.auth.enrollConfirm.handler(({ context, input }) => enrollConfirm(context, input)),
        logout: os.auth.logout.handler(({ context }) => logout(context, "admin")),
        me: os.auth.me.handler(async ({ context }) => {
            const user = await currentUser(context, "admin")
            return user?.role === "admin" ? user : null
        }),
    },
    security: {
        regenerateRecoveryCodes: os.security.regenerateRecoveryCodes.use(admin).handler(({ context, input }) => regenerateRecoveryCodes(context, context.user, input)),
    },
    overview: os.overview.use(admin).handler(async ({ context: { db } }) => {
        const dayAgo = sql`now() - interval '24 hours'`
        const [[userCount], [accountCount], states, [runner], [runs], [crashes]] = await Promise.all([
            db.select({ n: count() }).from(users),
            db.select({ n: count() }).from(gameAccounts),
            db.select({ state: botStatus.actualState, n: count() }).from(botStatus).groupBy(botStatus.actualState),
            db.select().from(runnerHeartbeat),
            db.select({ n: count() }).from(botRuns).where(gt(botRuns.startedAt, dayAgo)),
            db.select({ n: count() }).from(botRuns).where(and(gt(botRuns.startedAt, dayAgo), inArray(botRuns.endReason, ["crash", "error", "stale"]))),
        ])
        const bots = { starting: 0, running: 0, stopped: 0, auth_failed: 0, banned: 0, error: 0, crash_loop: 0 }
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
        list: os.users.list.use(admin).handler(async ({ context: { db }, input }) => {
            const where = and(
                input.search ? ilike(users.username, contains(input.search)) : undefined,
                input.role ? eq(users.role, input.role) : undefined,
                input.status ? eq(users.status, input.status) : undefined,
            )
            const [items, [total]] = await Promise.all([
                adminUsers(db)
                    .where(where)
                    .groupBy(users.id)
                    .orderBy(desc(users.createdAt), users.id)
                    .limit(input.limit).offset(input.offset),
                db.select({ n: count() }).from(users).where(where),
            ])
            return { items, total: total!.n }
        }),
        get: os.users.get.use(admin).handler(async ({ context: { db }, input }) => {
            const [user] = await adminUsers(db).where(eq(users.id, input.id)).groupBy(users.id)
            if (!user)
                throw new ORPCError("NOT_FOUND", { message: "No such user" })
            const [[login], live] = await Promise.all([
                db.select({ ts: max(auditLog.ts) }).from(auditLog).where(and(eq(auditLog.actorId, input.id), like(auditLog.action, "auth.login.%"))),
                db.select({ audience: sessions.audience, n: count() }).from(sessions)
                    .where(and(eq(sessions.userId, input.id), gt(sessions.expiresAt, sql`now()`))).groupBy(sessions.audience),
            ])
            const sessionsOf = (audience: "client" | "admin") => live.find(row => row.audience === audience)?.n ?? 0
            return { ...user, lastLoginAt: login?.ts ?? null, sessions: { client: sessionsOf("client"), admin: sessionsOf("admin") } }
        }),
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
            const stopped = await db.transaction(async tx => {
                const [changed] = await tx.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
                if (!changed)
                    throw new ORPCError("NOT_FOUND", { message: "No such user" })
                return stopUnentitled(tx, input.id)
            })
            await revokeUserSessions(db, input.id)
            await audit(db, { actorId: user.id, action: "user.set_role", targetType: "user", targetId: input.id, meta: { role: input.role, stopped } })
        }),
        setMaxBots: os.users.setMaxBots.use(admin).handler(async ({ context: { db, user }, input }) => {
            const stopped = await db.transaction(async tx => {
                const [changed] = await tx.update(users).set({ maxBots: input.maxBots, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
                if (!changed)
                    throw new ORPCError("NOT_FOUND", { message: "No such user" })
                return stopUnentitled(tx, input.id)
            })
            await audit(db, { actorId: user.id, action: "admin.user.max_bots", targetType: "user", targetId: input.id, meta: { maxBots: input.maxBots, stopped } })
        }),
        setAttackPluginCap: os.users.setAttackPluginCap.use(admin).handler(async ({ context: { db, user }, input }) => {
            const [before] = await db.select({ cap: users.attackPluginCap }).from(users).where(eq(users.id, input.id))
            if (!before)
                throw new ORPCError("NOT_FOUND", { message: "No such user" })
            await db.update(users).set({ attackPluginCap: input.cap, updatedAt: new Date() }).where(eq(users.id, input.id))
            await audit(db, { actorId: user.id, action: "admin.user.attack_plugin_cap", targetType: "user", targetId: input.id, meta: { from: before.cap, to: input.cap } })
        }),
        revokeSessions: os.users.revokeSessions.use(admin).handler(async ({ context: { db, user }, input }) => {
            await revokeUserSessions(db, input.id)
            await audit(db, { actorId: user.id, action: "user.revoke_sessions", targetType: "user", targetId: input.id })
        }),
        resetTotp: os.users.resetTotp.use(admin).handler(async ({ context: { db, user }, input }) => {
            notSelf(user.id, input.id, "You can't reset your own two-factor sign-in")
            const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.id))
            if (!target)
                throw new ORPCError("NOT_FOUND", { message: "No such user" })
            await resetSecondFactor(db, input.id)
            await audit(db, { actorId: user.id, action: "admin.user.totp_reset", targetType: "user", targetId: input.id })
        }),
    },
    settings: {
        get: os.settings.get.use(admin).handler(async ({ context: { db } }) => {
            const [row] = await db.select({ attackPluginCap: appSettings.attackPluginCap }).from(appSettings)
            return { attackPluginCap: row?.attackPluginCap ?? "4" }
        }),
        setAttackPluginCap: os.settings.setAttackPluginCap.use(admin).handler(async ({ context: { db, user }, input }) => {
            const [before] = await db.select({ cap: appSettings.attackPluginCap }).from(appSettings)
            await db.insert(appSettings).values({ id: 1, attackPluginCap: input.cap })
                .onConflictDoUpdate({ target: appSettings.id, set: { attackPluginCap: input.cap, updatedAt: new Date() } })
            await audit(db, { actorId: user.id, action: "admin.settings.attack_plugin_cap", meta: { from: before?.cap ?? "4", to: input.cap } })
        }),
    },
    accounts: {
        list: os.accounts.list.use(admin).handler(async ({ context: { db }, input }) => {
            const where = and(
                input.search ? or(
                    ilike(gameAccounts.name, contains(input.search)),
                    inArray(gameAccounts.ownerId, db.select({ id: users.id }).from(users).where(ilike(users.username, contains(input.search)))),
                ) : undefined,
                input.ownerId ? eq(gameAccounts.ownerId, input.ownerId) : undefined,
                input.state ? eq(botStatus.actualState, input.state) : undefined,
            )
            const [rows, [total]] = await Promise.all([
                listAccounts(db, where, input),
                db.select({ n: count() }).from(gameAccounts).leftJoin(botStatus, eq(botStatus.accountId, gameAccounts.id)).where(where),
            ])
            const [ownerRows, proxyOf] = await Promise.all([
                db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, [...new Set(rows.map(r => r.ownerId))])),
                proxiesOfAccounts(db, rows.map(r => r.id)),
            ])
            const owners = new Map(ownerRows.map(u => [u.id, u.username]))
            return {
                items: rows.map(({ plugins: _, ...account }) => ({
                    ...account, owner: owners.get(account.ownerId) ?? "?",
                    proxyId: proxyOf.get(account.id)?.proxyId ?? null, proxyLabel: proxyOf.get(account.id)?.proxyLabel ?? null,
                })),
                total: total!.n,
            }
        }),
        forceStop: os.accounts.forceStop.use(admin).handler(async ({ context: { db, user }, input }) => {
            const changed = await setDesiredState(db, eq(gameAccounts.id, input.id), "stopped")
            if (!changed.length)
                throw new ORPCError("NOT_FOUND", { message: "No such account" })
            await audit(db, { actorId: user.id, action: "account.force_stop", targetType: "account", targetId: input.id })
        }),
        setProxy: os.accounts.setProxy.use(admin).handler(async ({ context: { db, user }, input }) => {
            await setAccountProxy(db, input.id, input.proxyId)
            await audit(db, { actorId: user.id, action: "admin.account.set_proxy", targetType: "account", targetId: input.id, meta: { proxyId: input.proxyId } })
        }),
        logs: os.accounts.logs.use(admin).handler(({ context: { db }, input }) => accountLogs(db, input.id, input)),
        runs: os.accounts.runs.use(admin).handler(({ context: { db }, input }) => accountRuns(db, input.id, input.limit)),
    },
    proxies: {
        list: os.proxies.list.use(admin).handler(({ context: { db } }) => listProxies(db)),
        create: os.proxies.create.use(admin).handler(async ({ context: { db, env, user }, input }) => {
            const proxy = await createProxy(db, env.SEAL_PUBLIC_KEY, input)
            await audit(db, { actorId: user.id, action: "admin.proxy.create", targetType: "proxy", targetId: proxy.id, meta: { label: proxy.label, hostHint: proxy.hostHint, maxAccounts: proxy.maxAccounts } })
            return proxy
        }),
        update: os.proxies.update.use(admin).handler(async ({ context: { db, env, user }, input }) => {
            const proxy = await updateProxy(db, env.SEAL_PUBLIC_KEY, input)
            const { id, url, ...changed } = input
            // The audit entry names the new host, never the URL.
            await audit(db, { actorId: user.id, action: "admin.proxy.update", targetType: "proxy", targetId: id, meta: { ...changed, ...(url !== undefined && { hostHint: proxy.hostHint }) } })
            return proxy
        }),
        remove: os.proxies.remove.use(admin).handler(async ({ context: { db, user }, input }) => {
            const removed = await removeProxy(db, input.id)
            await audit(db, { actorId: user.id, action: "admin.proxy.remove", targetType: "proxy", targetId: input.id, meta: removed })
        }),
    },
    audit: {
        list: os.audit.list.use(admin).handler(({ context: { db }, input }) =>
            db.select({
                id: auditLog.id, actor: users.username, action: auditLog.action, targetType: auditLog.targetType,
                targetId: auditLog.targetId, meta: auditLog.meta, ts: auditLog.ts,
            }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
                .where(and(
                    input.before ? lt(auditLog.id, input.before) : undefined,
                    or(input.actorId ? eq(auditLog.actorId, input.actorId) : undefined, input.targetId ? eq(auditLog.targetId, input.targetId) : undefined),
                ))
                .orderBy(desc(auditLog.id)).limit(input.limit)),
    },
})
