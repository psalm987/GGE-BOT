import { implement, ORPCError } from "@orpc/server"
import { asc } from "drizzle-orm"
import { gameAccounts, servers } from "@gge/db"
import { clientContract } from "@gge/contracts"
import type { Ctx } from "../context.ts"
import { alertsFor, dismissAlert } from "../services/alerts.ts"
import { audit } from "../services/audit.ts"
import { requireBillingLive } from "../services/billing.ts"
import { myCodes, redeemCode } from "../services/codes.ts"
import { billingConfig, checkout, confirmPayment } from "../services/payments.ts"
import { myPurchases } from "../services/purchases.ts"
import { pointsSummary, redeemPoints } from "../services/points.ts"
import {
    accountRuns, createAccount, getOwnedAccount, listOwnedAccounts, attackLimitFor, loadCatalog, ownedBy, removeAccounts, setDesiredState, startAccounts, updateAccount,
} from "../services/accounts.ts"
import { getNotificationPrefs, listNotifications, markNotificationsRead, setNotificationPrefs } from "../services/notifications.ts"
import { logFacets, logFeed } from "../services/logs.ts"
import { connectionToken, subscriptionToken, subscriptionTokens } from "../services/realtime.ts"
import { exportData } from "../services/data-export.ts"
import { detectLocale, setLocale } from "../services/i18n.ts"
import { addEmail, changeEmail, changePassword, confirmEmailChange, deleteMe, resendVerification } from "./account.ts"
import { currentUser, login, logout, requestPasswordReset, resetPassword, signup, tooMany, verifyEmail } from "./auth.ts"

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

const billing = verified.concat(async ({ context, next }) => {
    await requireBillingLive(context.db, context.user.role)
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
    i18n: {
        detect: os.i18n.detect.handler(async ({ context }) => detectLocale(context, (await currentUser(context, "client"))?.id)),
    },
    account: {
        setLocale: os.account.setLocale.use(authed).handler(({ context, input }) => setLocale(context, context.user.id, input.locale)),
        resendVerification: os.account.resendVerification.use(authed).handler(({ context }) => resendVerification(context, context.user)),
        addEmail: os.account.addEmail.use(authed).handler(({ context, input }) => addEmail(context, context.user, input)),
        changePassword: os.account.changePassword.use(authed).handler(({ context, input }) => changePassword(context, context.user, input)),
        notificationPrefs: os.account.notificationPrefs.use(authed).handler(({ context }) => getNotificationPrefs(context.db, context.user.id)),
        setNotificationPrefs: os.account.setNotificationPrefs.use(authed).handler(({ context, input }) => setNotificationPrefs(context.db, context.user.id, input)),
        changeEmail: os.account.changeEmail.use(authed).handler(({ context, input }) => changeEmail(context, context.user, input)),
        confirmEmailChange: os.account.confirmEmailChange.handler(({ context, input }) => confirmEmailChange(context, input)),
        exportData: os.account.exportData.use(authed).handler(({ context }) => exportData(context, context.user.id)),
        deleteMe: os.account.deleteMe.use(authed).handler(({ context, input }) => deleteMe(context, context.user, input)),
    },
    // Not `verified`: a player whose email isn't confirmed yet can still have notifications to read.
    notifications: {
        list: os.notifications.list.use(authed).handler(({ context, input }) => listNotifications(context.db, context.user.id, input)),
        markRead: os.notifications.markRead.use(authed).handler(({ context, input }) => markNotificationsRead(context.db, context.user.id, input)),
    },
    alerts: {
        list: os.alerts.list.use(verified).handler(({ context: { db, user } }) => alertsFor(db, user.id)),
        dismiss: os.alerts.dismiss.use(verified).handler(({ context: { db, user }, input }) => dismissAlert(db, user.id, input.id)),
    },
    logs: {
        feed: os.logs.feed.use(verified).handler(({ context: { db, user }, input }) => logFeed(db, user.id, input)),
        facets: os.logs.facets.use(verified).handler(({ context: { db, user } }) => logFacets(db, user.id)),
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
        runs: os.accounts.runs.use(verified).handler(async ({ context: { db, user }, input }) => {
            await getOwnedAccount(db, user.id, input.id)
            return accountRuns(db, input.id, input.limit)
        }),
    },
    realtime: {
        connectionToken: os.realtime.connectionToken.use(verified).handler(({ context: { env, user } }) =>
            connectionToken(env.CENTRIFUGO_TOKEN_SECRET, user.id)),
        subscriptionToken: os.realtime.subscriptionToken.use(verified).handler(async ({ context: { db, env, user }, input }) => {
            await getOwnedAccount(db, user.id, input.accountId)
            return subscriptionToken(env.CENTRIFUGO_TOKEN_SECRET, user.id, input.accountId)
        }),
        subscriptionTokens: os.realtime.subscriptionTokens.use(verified).handler(async ({ context: { db, env, user }, input }) => {
            const ids = [...new Set(input.accountIds)]
            const owned = await db.select({ id: gameAccounts.id }).from(gameAccounts).where(ownedBy(user.id, ids))
            if (owned.length !== ids.length)
                throw new ORPCError("NOT_FOUND", { message: "No such account" })
            return subscriptionTokens(env.CENTRIFUGO_TOKEN_SECRET, user.id, ids)
        }),
    },
    billing: {
        config: os.billing.config.use(verified).handler(({ context }) => billingConfig(context, context.user.role)),
        checkout: os.billing.checkout.use(verified).handler(({ context, input }) => checkout(context, context.user, input.packageId)),
        confirm: os.billing.confirm.use(verified).handler(({ context, input }) => confirmPayment(context, context.user.id, input.reference)),
        points: os.billing.points.use(billing).handler(({ context: { db, user }, input }) => pointsSummary(db, user.id, input)),
        redeemPoints: os.billing.redeemPoints.use(billing).handler(async ({ context: { db, user }, input }) => {
            const redemption = await redeemPoints(db, user.id, input.idempotencyKey)
            await audit(db, { actorId: user.id, action: "billing.points.redeem", targetType: "period", targetId: redemption.period.id })
            return redemption
        }),
        redeemCode: os.billing.redeemCode.use(billing).handler(async ({ context: { db, limits, req, user }, input }) => {
            const guesses = [`user:${user.id}`, `ip:${req.ip}`]
            if (guesses.map(key => limits.redeemCode.hit(key)).includes(false))
                throw tooMany()
            const redeemed = await redeemCode(db, user.id, input.code)
            // Only wrong codes count, so a player working through a list of good ones is never stopped.
            for (const key of guesses)
                limits.redeemCode.refund(key)
            return redeemed
        }),
        myCodes: os.billing.myCodes.use(billing).handler(({ context: { db, user } }) => myCodes(db, user.id)),
        myPurchases: os.billing.myPurchases.use(billing).handler(({ context: { db, user } }) => myPurchases(db, user.id)),
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
