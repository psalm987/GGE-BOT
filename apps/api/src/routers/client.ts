import { on } from "node:events"
import { implement, ORPCError } from "@orpc/server"
import { and, asc, desc, eq, lt } from "drizzle-orm"
import { botLogs, botRuns, botStatus, gameAccounts, servers } from "@gge/db"
import type { BotEvent } from "@gge/contracts"
import { clientContract } from "@gge/contracts"
import type { Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import {
    createAccount, getOwnedAccount, listOwnedAccounts, loadCatalog, ownedBy, removeAccounts, setDesiredState, updateAccount,
} from "../services/accounts.ts"
import type { RawBotEvent } from "../services/bot-events.ts"
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
        login: os.auth.login.handler(({ context, input }) => login(context, "client", input)),
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
    },
    accounts: {
        list: os.accounts.list.use(verified).handler(({ context }) => listOwnedAccounts(context.db, context.user.id)),
        create: os.accounts.create.use(verified).handler(async ({ context, input }) => {
            const account = await createAccount(context.db, context.env.SEAL_PUBLIC_KEY, context.user, input)
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
            const changed = await setDesiredState(context.db, ownedBy(context.user.id, input.ids), input.state)
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
        events: os.accounts.events.use(verified).handler(async function* ({ context: { db, user, botEvents }, signal }) {
            // Ownership is checked per account and remembered, so accounts created mid-stream still show up.
            const owned = new Map<string, boolean>()
            const isOwned = async (accountId: string) => {
                if (!owned.has(accountId)) {
                    const [row] = await db.select({ id: gameAccounts.id }).from(gameAccounts).where(ownedBy(user.id, [accountId]))
                    owned.set(accountId, Boolean(row))
                }
                return owned.get(accountId)!
            }
            try {
                for await (const [event] of on(botEvents, "event", { signal }) as AsyncIterable<[RawBotEvent]>) {
                    if (!await isOwned(event.accountId))
                        continue
                    if (event.kind === "log") {
                        yield { kind: "log", accountId: event.accountId, line: { id: event.id, ts: new Date(event.ts), level: event.level, message: event.message } } satisfies BotEvent
                        continue
                    }
                    const [status] = await db.select().from(botStatus).where(eq(botStatus.accountId, event.accountId))
                    if (status)
                        yield {
                            kind: "status", accountId: event.accountId,
                            status: { actualState: status.actualState, heartbeatAt: status.heartbeatAt, lastError: status.lastError, bannedUntil: status.bannedUntil },
                        } satisfies BotEvent
                }
            } catch (error) {
                if ((error as Error).name !== "AbortError")
                    throw error
            }
        }),
    },
    plugins: {
        catalog: os.plugins.catalog.use(verified).handler(async ({ context }) =>
            (await loadCatalog(context.db)).filter(entry => !entry.hidden)),
    },
    servers: {
        list: os.servers.list.use(verified).handler(({ context }) =>
            context.db.select({ id: servers.id, label: servers.label }).from(servers).orderBy(asc(servers.label))),
    },
})
