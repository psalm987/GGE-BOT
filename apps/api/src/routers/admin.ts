import { implement } from "@orpc/server"
import { and, count, desc, eq, gt, ilike, inArray, like, lt, max, or, sql } from "drizzle-orm"
import { appSettings, auditLog, botRuns, botStatus, gameAccounts, planPeriods, runnerHeartbeat, sessions, userTotp, users, type Db } from "@gge/db"
import { adminContract, type PlanId } from "@gge/contracts"
import { resetSecondFactor } from "../auth/second-factor.ts"
import { revokeUserSessions } from "../auth/sessions.ts"
import type { Ctx } from "../context.ts"
import { logFacets, logFeed } from "../services/logs.ts"
import { createAnnouncement, endAnnouncement, listAnnouncements, updateAnnouncement } from "../services/alerts.ts"
import { audit } from "../services/audit.ts"
import { backToFree, billingStatus, goLive } from "../services/billing.ts"
import { revokeCode } from "../services/codes.ts"
import { listPackages, listPurchases, markRefunded, recordPurchase, updatePackage } from "../services/purchases.ts"
import { adjustPoints, billingSettings, updateBillingSettings } from "../services/points.ts"
import { detectLocale } from "../services/i18n.ts"
import { endPeriodNow, grantDays, listPlans, setLimitOverride, updatePlan, userPlan } from "../services/plan-admin.ts"
import { alertsChanged } from "../services/realtime.ts"
import { accountRuns, listAccounts, setDesiredState, stopUnentitled } from "../services/accounts.ts"
import { createProxy, listProxies, proxiesOfAccounts, removeProxy, setAccountProxy, updateProxy } from "../services/proxies.ts"
import { adminLogin, enrollConfirm, enrollStart, regenerateRecoveryCodes, verifyTotp } from "./admin-auth.ts"
import { currentUser, logout } from "./auth.ts"
import { fail } from "../errors.ts"

/** A LIKE pattern for "contains", with `%`, `_` and backslash in the text matched literally. */
const contains = (text: string) => `%${text.replace(/[%_\\]/g, "\\$&")}%`

/** The user's period covering now, and the end of their whole queue, which runs on from it without a gap. */
const currentSource = sql<string | null>`(select ${planPeriods.source} from ${planPeriods} where ${planPeriods.userId} = ${users.id} and ${planPeriods.startsAt} <= now() and ${planPeriods.endsAt} > now() limit 1)`
const currentPlanId = sql<PlanId | null>`(select ${planPeriods.planId} from ${planPeriods} where ${planPeriods.userId} = ${users.id} and ${planPeriods.startsAt} <= now() and ${planPeriods.endsAt} > now() limit 1)`
const coverEnd = sql`(select max(${planPeriods.endsAt}) from ${planPeriods} where ${planPeriods.userId} = ${users.id} and ${planPeriods.endsAt} > now())`

const PLAN_FILTERS = {
    trial: sql`${currentSource} = 'trial'`,
    expiring: sql`${coverEnd} <= now() + interval '7 days'`,
    none: sql`${currentSource} is null and ${users.role} = 'user'`,
}

/** Every `AdminUser` column, with the account count; filter, then group by user id, then map with withPlan. */
const adminUsers = (db: Db) => db.select({
    id: users.id, username: users.username, role: users.role, email: users.email,
    emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`, maxBots: users.maxBots, maxBotsOverride: users.maxBotsOverride, status: users.status, createdAt: users.createdAt,
    attackPluginCap: users.attackPluginCap,
    accountCount: count(gameAccounts.id),
    totpEnabled: sql<boolean>`exists (select 1 from ${userTotp} where ${userTotp.userId} = ${users.id} and ${userTotp.confirmedAt} is not null)`,
    planId: currentPlanId, planSource: currentSource, planEndsAt: sql<Date | null>`${coverEnd}`.mapWith(planPeriods.endsAt),
}).from(users).leftJoin(gameAccounts, eq(gameAccounts.ownerId, users.id))

const withPlan = <T extends { planId: PlanId | null; planSource: string | null; planEndsAt: Date | null }>({ planId, planSource, planEndsAt, ...user }: T) => ({
    ...user, plan: planId && planEndsAt ? { planId, isTrial: planSource === "trial", endsAt: planEndsAt } : null,
})

const os = implement(adminContract).$context<Ctx>()

const admin = os.middleware(async ({ context, next }) => {
    const user = await currentUser(context, "admin")
    if (!user)
        throw fail("UNAUTHORIZED", "SIGN_IN_REQUIRED")
    if (user.role !== "admin")
        throw fail("FORBIDDEN", "ADMINS_ONLY")
    return next({ context: { user } })
})

function notSelf(actorId: string, targetId: string, code: "CANNOT_DISABLE_SELF" | "CANNOT_CHANGE_OWN_ROLE" | "CANNOT_RESET_OWN_TWO_FACTOR") {
    if (actorId === targetId)
        throw fail("BAD_REQUEST", code)
}

export const adminRouter = os.router({
    i18n: {
        detect: os.i18n.detect.handler(({ context }) => detectLocale(context)),
    },
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
                input.plan ? PLAN_FILTERS[input.plan] : undefined,
            )
            const [items, [total]] = await Promise.all([
                adminUsers(db)
                    .where(where)
                    .groupBy(users.id)
                    .orderBy(desc(users.createdAt), users.id)
                    .limit(input.limit).offset(input.offset),
                db.select({ n: count() }).from(users).where(where),
            ])
            return { items: items.map(withPlan), total: total!.n }
        }),
        get: os.users.get.use(admin).handler(async ({ context: { db }, input }) => {
            const [user] = await adminUsers(db).where(eq(users.id, input.id)).groupBy(users.id)
            if (!user)
                throw fail("NOT_FOUND", "USER_NOT_FOUND")
            const [[login], live] = await Promise.all([
                db.select({ ts: max(auditLog.ts) }).from(auditLog).where(and(eq(auditLog.actorId, input.id), like(auditLog.action, "auth.login.%"))),
                db.select({ audience: sessions.audience, n: count() }).from(sessions)
                    .where(and(eq(sessions.userId, input.id), gt(sessions.expiresAt, sql`now()`))).groupBy(sessions.audience),
            ])
            const sessionsOf = (audience: "client" | "admin") => live.find(row => row.audience === audience)?.n ?? 0
            return { ...withPlan(user), lastLoginAt: login?.ts ?? null, sessions: { client: sessionsOf("client"), admin: sessionsOf("admin") } }
        }),
        setStatus: os.users.setStatus.use(admin).handler(async ({ context: { db, user }, input }) => {
            notSelf(user.id, input.id, "CANNOT_DISABLE_SELF")
            const [changed] = await db.update(users).set({ status: input.status, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
            if (!changed)
                throw fail("NOT_FOUND", "USER_NOT_FOUND")
            if (input.status === "disabled") {
                await revokeUserSessions(db, input.id)
                await setDesiredState(db, eq(gameAccounts.ownerId, input.id), "stopped")
            }
            await audit(db, { actorId: user.id, action: `user.${input.status === "disabled" ? "disable" : "enable"}`, targetType: "user", targetId: input.id })
        }),
        setRole: os.users.setRole.use(admin).handler(async ({ context: { db, user }, input }) => {
            notSelf(user.id, input.id, "CANNOT_CHANGE_OWN_ROLE")
            const stopped = await db.transaction(async tx => {
                const [changed] = await tx.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
                if (!changed)
                    throw fail("NOT_FOUND", "USER_NOT_FOUND")
                await alertsChanged(tx, input.id)
                return stopUnentitled(tx, input.id)
            })
            await revokeUserSessions(db, input.id)
            await audit(db, { actorId: user.id, action: "user.set_role", targetType: "user", targetId: input.id, meta: { role: input.role, stopped } })
        }),
        setMaxBots: os.users.setMaxBots.use(admin).handler(async ({ context: { db, user }, input }) => {
            const stopped = await db.transaction(async tx => {
                const [changed] = await tx.update(users).set({ maxBots: input.maxBots, updatedAt: new Date() }).where(eq(users.id, input.id)).returning({ id: users.id })
                if (!changed)
                    throw fail("NOT_FOUND", "USER_NOT_FOUND")
                await alertsChanged(tx, input.id)
                return stopUnentitled(tx, input.id)
            })
            await audit(db, { actorId: user.id, action: "admin.user.max_bots", targetType: "user", targetId: input.id, meta: { maxBots: input.maxBots, stopped } })
        }),
        setLimitOverride: os.users.setLimitOverride.use(admin).handler(({ context: { db, user }, input }) => setLimitOverride(db, user.id, input.id, input.maxBotsOverride)),
        setAttackPluginCap: os.users.setAttackPluginCap.use(admin).handler(async ({ context: { db, user }, input }) => {
            const [before] = await db.select({ cap: users.attackPluginCap }).from(users).where(eq(users.id, input.id))
            if (!before)
                throw fail("NOT_FOUND", "USER_NOT_FOUND")
            await db.update(users).set({ attackPluginCap: input.cap, updatedAt: new Date() }).where(eq(users.id, input.id))
            await audit(db, { actorId: user.id, action: "admin.user.attack_plugin_cap", targetType: "user", targetId: input.id, meta: { from: before.cap, to: input.cap } })
        }),
        revokeSessions: os.users.revokeSessions.use(admin).handler(async ({ context: { db, user }, input }) => {
            await revokeUserSessions(db, input.id)
            await audit(db, { actorId: user.id, action: "user.revoke_sessions", targetType: "user", targetId: input.id })
        }),
        resetTotp: os.users.resetTotp.use(admin).handler(async ({ context: { db, user }, input }) => {
            notSelf(user.id, input.id, "CANNOT_RESET_OWN_TWO_FACTOR")
            const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.id))
            if (!target)
                throw fail("NOT_FOUND", "USER_NOT_FOUND")
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
    billing: {
        status: os.billing.status.use(admin).handler(({ context: { db, env } }) => billingStatus(db, env)),
        setLive: os.billing.setLive.use(admin).handler(async ({ context: { db, env, user }, input }) => {
            await (input.live ? goLive(db, env, user.id) : backToFree(db, user.id))
            return billingStatus(db, env)
        }),
        settings: os.billing.settings.use(admin).handler(({ context: { db } }) => billingSettings(db)),
        updateSettings: os.billing.updateSettings.use(admin).handler(({ context: { db, user }, input }) => updateBillingSettings(db, user.id, input)),
        adjustPoints: os.billing.adjustPoints.use(admin).handler(({ context: { db, user }, input }) => adjustPoints(db, user.id, input)),
        packages: os.billing.packages.use(admin).handler(({ context: { db } }) => listPackages(db)),
        updatePackage: os.billing.updatePackage.use(admin).handler(({ context: { db, user }, input }) => updatePackage(db, user.id, input)),
        recordPurchase: os.billing.recordPurchase.use(admin).handler(({ context: { db, user }, input }) => recordPurchase(db, user.id, input)),
        purchases: os.billing.purchases.use(admin).handler(({ context: { db }, input }) => listPurchases(db, input)),
        markRefunded: os.billing.markRefunded.use(admin).handler(({ context: { db, user }, input }) => markRefunded(db, user.id, input.purchaseId)),
        revokeCode: os.billing.revokeCode.use(admin).handler(({ context: { db, user }, input }) => revokeCode(db, user.id, input.codeId)),
        plans: os.billing.plans.use(admin).handler(({ context: { db } }) => listPlans(db)),
        updatePlan: os.billing.updatePlan.use(admin).handler(({ context: { db, user }, input }) => updatePlan(db, user.id, input)),
        userPlan: os.billing.userPlan.use(admin).handler(({ context: { db }, input }) => userPlan(db, input.userId)),
        grantDays: os.billing.grantDays.use(admin).handler(({ context: { db, user }, input }) => grantDays(db, user.id, input)),
        endPeriod: os.billing.endPeriod.use(admin).handler(({ context: { db, user }, input }) => endPeriodNow(db, user.id, input.userId)),
    },
    announcements: {
        list: os.announcements.list.use(admin).handler(({ context: { db } }) => listAnnouncements(db)),
        create: os.announcements.create.use(admin).handler(({ context: { db, user }, input }) => createAnnouncement(db, user.id, input)),
        update: os.announcements.update.use(admin).handler(({ context: { db, user }, input }) => updateAnnouncement(db, user.id, input)),
        end: os.announcements.end.use(admin).handler(({ context: { db, user }, input }) => endAnnouncement(db, user.id, input.id)),
    },
    logs: {
        feed: os.logs.feed.use(admin).handler(({ context: { db }, input: { ownerId, ...input } }) => logFeed(db, ownerId, input)),
        facets: os.logs.facets.use(admin).handler(({ context: { db }, input }) => logFacets(db, input.ownerId)),
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
                throw fail("NOT_FOUND", "ACCOUNT_NOT_FOUND")
            await audit(db, { actorId: user.id, action: "account.force_stop", targetType: "account", targetId: input.id })
        }),
        setProxy: os.accounts.setProxy.use(admin).handler(async ({ context: { db, user }, input }) => {
            await setAccountProxy(db, input.id, input.proxyId)
            await audit(db, { actorId: user.id, action: "admin.account.set_proxy", targetType: "account", targetId: input.id, meta: { proxyId: input.proxyId } })
        }),
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
