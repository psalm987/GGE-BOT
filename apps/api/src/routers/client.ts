import { implement, ORPCError } from "@orpc/server"
import { and, asc, desc, eq, lt } from "drizzle-orm"
import { botLogs, botRuns, servers } from "@gge/db"
import { clientContract } from "@gge/contracts"
import type { Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import {
    createAccount, getOwnedAccount, listOwnedAccounts, attackLimitFor, loadCatalog, ownedBy, removeAccounts, setDesiredState, startAccounts, updateAccount,
} from "../services/accounts.ts"
import { getNotificationPrefs, listNotifications, markNotificationsRead, setNotificationPrefs } from "../services/notifications.ts"
import { connectionToken, subscriptionToken } from "../services/realtime.ts"
import { addEmail, changePassword, resendVerification } from "./account.ts"
import { currentUser, login, logout, requestPasswordReset, resetPassword, signup, verifyEmail } from "./auth.ts"

const os = implement(clientContract).$context<Ctx>()

const authed = os.middleware(async ({ context, next }) => {
    const user = await currentUser(context, "client")
    if (!user)
        throw new ORPCError("UNAUTHORIZED", { message: "Please sign in" })
    return next({ context: { user } })
})

/** Running bots needs a confirmed email; sign-in, resend and account settings don't. */
const verified = authed.concat(async ({ context, next }) => {
    if (!context.user.emailVerified)
        throw new ORPCError("FORBIDDEN", { message: "Verify your email to continue" })
    return next()
})

export const clientRouter = os.router({
    auth: {
        signup: os.auth.signup.handler(({ context, input }) => signup(context, input)),
        login: os.auth.login.handler(({ context, input }) => login(context, input)),
        logout: os.auth.logout.handler(({ context }) => logout(context, "client")),
        me: os.auth.me.handler(async ({ context }) => await currentUser(context, "client")),
        requestPasswordReset: os.auth.requestPasswordReset.handler(({ context, input }) => requestPasswordReset(context, input)),
        resetPassword: os.auth.resetPassword.handler(({ context, input }) => resetPassword(context, input)),
        verifyEmail: os.auth.verifyEmail.handler(({ context, input }) => verifyEmail(context, input)),
    },
    account: {
        resendVerification: os.account.resendVerification.use(authed).handler(({ context }) => resendVerification(context, context.user)),
        addEmail: os.account.addEmail.use(authed).handler(({ context, input }) => addEmail(context, context.user, input)),
        changePassword: os.account.changePassword.use(authed).handler(({ context, input }) => changePassword(context, context.user, input)),
        notificationPrefs: os.account.notificationPrefs.use(authed).handler(({ context }) => getNotificationPrefs(context.db, context.user.id)),
        setNotificationPrefs: os.account.setNotificationPrefs.use(authed).handler(({ context, input }) => setNotificationPrefs(context.db, context.user.id, input)),
    },
    // Not `verified`: a player whose email isn't confirmed yet can still have notifications to read.
    notifications: {
        list: os.notifications.list.use(authed).handler(({ context, input }) => listNotifications(context.db, context.user.id, input)),
        markRead: os.notifications.markRead.use(authed).handler(({ context, input }) => markNotificationsRead(context.db, context.user.id, input)),
    },
    accounts: {
        list: os.accounts.list.use(verified).handler(({ context }) => listOwnedAccounts(context.db, context.user.id)),
        create: os.accounts.create.use(verified).handler(async ({ context, input }) => {
            const account = await createAccount(context.db, context.env.SEAL_PUBLIC_KEY, context.user.id, input)
            await audit(context.db, { actorId: context.user.id, action: "account.create", targetType: "account", targetId: account.id })
            return account
        }),
        update: os.accounts.update.use(verified).handler(async ({ context, input }) => {
            const account = await updateAccount(context.db, context.env.SEAL_PUBLIC_KEY, context.user.id, input)
            await audit(context.db, {
                actorId: context.user.id, action: "account.update", targetType: "account", targetId: account.id,
                meta: { fields: Object.keys(input).filter(k => k !== "id") },
            })
            return account
        }),
        remove: os.accounts.remove.use(verified).handler(async ({ context, input }) => {
            const removed = await removeAccounts(context.db, context.user.id, input.ids)
            for (const { id } of removed)
                await audit(context.db, { actorId: context.user.id, action: "account.remove", targetType: "account", targetId: id })
        }),
        setDesiredState: os.accounts.setDesiredState.use(verified).handler(async ({ context, input }) => {
            const changed = input.state === "running"
                ? await startAccounts(context.db, context.user.id, input.ids)
                : await setDesiredState(context.db, ownedBy(context.user.id, input.ids), "stopped")
            for (const { id } of changed)
                await audit(context.db, { actorId: context.user.id, action: `account.${input.state === "running" ? "start" : "stop"}`, targetType: "account", targetId: id })
        }),
        logs: os.accounts.logs.use(verified).handler(async ({ context: { db, user }, input }) => {
            await getOwnedAccount(db, user.id, input.id)
            const rows = await db.select().from(botLogs)
                .where(and(eq(botLogs.accountId, input.id), input.before ? lt(botLogs.id, input.before) : undefined))
                .orderBy(desc(botLogs.id)).limit(input.limit)
            return rows.map(r => ({ id: r.id, ts: r.ts, level: r.level, message: r.message, parts: Array.isArray(r.parts) ? r.parts : null }))
        }),
        runs: os.accounts.runs.use(verified).handler(async ({ context: { db, user }, input }) => {
            await getOwnedAccount(db, user.id, input.id)
            return db.select({ id: botRuns.id, startedAt: botRuns.startedAt, endedAt: botRuns.endedAt, endReason: botRuns.endReason, error: botRuns.error })
                .from(botRuns).where(eq(botRuns.accountId, input.id)).orderBy(desc(botRuns.id)).limit(input.limit)
        }),
    },
    realtime: {
        connectionToken: os.realtime.connectionToken.use(verified).handler(({ context: { env, user } }) =>
            connectionToken(env.CENTRIFUGO_TOKEN_SECRET, user.id)),
        subscriptionToken: os.realtime.subscriptionToken.use(verified).handler(async ({ context: { db, env, user }, input }) => {
            await getOwnedAccount(db, user.id, input.accountId)
            return subscriptionToken(env.CENTRIFUGO_TOKEN_SECRET, user.id, input.accountId)
        }),
    },
    plugins: {
        catalog: os.plugins.catalog.use(verified).handler(async ({ context }) =>
            (await loadCatalog(context.db)).filter(entry => !entry.hidden)),
        attackLimit: os.plugins.attackLimit.use(verified).handler(({ context }) => attackLimitFor(context.db, context.user.id)),
    },
    servers: {
        list: os.servers.list.use(verified).handler(({ context }) =>
            context.db.select({ id: servers.id, label: servers.label }).from(servers).orderBy(asc(servers.label))),
    },
})
