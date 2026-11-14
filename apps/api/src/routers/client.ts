import { implement, ORPCError } from "@orpc/server"
import { asc } from "drizzle-orm"
import { servers } from "@gge/db"
import { clientContract } from "@gge/contracts"
import type { Ctx } from "../context.ts"
import { audit } from "../services/audit.ts"
import {
    createAccount, listOwnedAccounts, loadCatalog, ownedBy, removeAccounts, setDesiredState, updateAccount,
} from "../services/accounts.ts"
import { currentUser, login, logout, signup } from "./auth.ts"

const os = implement(clientContract).$context<Ctx>()

const authed = os.middleware(async ({ context, next }) => {
    const user = await currentUser(context, "client")
    if (!user)
        throw new ORPCError("UNAUTHORIZED", { message: "Please sign in" })
    return next({ context: { user } })
})

export const clientRouter = os.router({
    auth: {
        signup: os.auth.signup.handler(({ context, input }) => signup(context, input)),
        login: os.auth.login.handler(({ context, input }) => login(context, "client", input)),
        logout: os.auth.logout.handler(({ context }) => logout(context, "client")),
        me: os.auth.me.handler(async ({ context }) => await currentUser(context, "client")),
    },
    accounts: {
        list: os.accounts.list.use(authed).handler(({ context }) => listOwnedAccounts(context.db, context.user.id)),
        create: os.accounts.create.use(authed).handler(async ({ context, input }) => {
            const account = await createAccount(context.db, context.env.SEAL_PUBLIC_KEY, context.user.id, input)
            await audit(context.db, { actorId: context.user.id, action: "account.create", targetType: "account", targetId: account.id })
            return account
        }),
        update: os.accounts.update.use(authed).handler(async ({ context, input }) => {
            const account = await updateAccount(context.db, context.env.SEAL_PUBLIC_KEY, context.user.id, input)
            await audit(context.db, {
                actorId: context.user.id, action: "account.update", targetType: "account", targetId: account.id,
                meta: { fields: Object.keys(input).filter(k => k !== "id") },
            })
            return account
        }),
        remove: os.accounts.remove.use(authed).handler(async ({ context, input }) => {
            const removed = await removeAccounts(context.db, context.user.id, input.ids)
            for (const { id } of removed)
                await audit(context.db, { actorId: context.user.id, action: "account.remove", targetType: "account", targetId: id })
        }),
        setDesiredState: os.accounts.setDesiredState.use(authed).handler(async ({ context, input }) => {
            const changed = await setDesiredState(context.db, ownedBy(context.user.id, input.ids), input.state)
            for (const { id } of changed)
                await audit(context.db, { actorId: context.user.id, action: `account.${input.state === "running" ? "start" : "stop"}`, targetType: "account", targetId: id })
        }),
    },
    plugins: {
        catalog: os.plugins.catalog.use(authed).handler(async ({ context }) =>
            (await loadCatalog(context.db)).filter(entry => !entry.hidden)),
    },
    servers: {
        list: os.servers.list.use(authed).handler(({ context }) =>
            context.db.select({ id: servers.id, label: servers.label }).from(servers).orderBy(asc(servers.label))),
    },
})
