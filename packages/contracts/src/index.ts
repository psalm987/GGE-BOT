import { eventIterator, oc, type ContractRouterClient } from "@orpc/contract"
import * as z from "zod"
import { AttackPluginCap, PluginCatalogEntry } from "./plugins.ts"
import {
    AdminAccount, AdminLoginStep, AdminUser, AuditEntry, BotEvent, CreateAccount, Credentials, DesiredState, Email, Id, Ids, NewPassword, LogLine,
    Overview, PublicAccount, PublicUser, Role, Run, SecondFactor, Server, Signup, TotpCode, UpdateAccount, UserStatus,
} from "./schemas.ts"

export * from "./entitlement.ts"
export * from "./plugins.ts"
export * from "./schemas.ts"

const session = {
    logout: oc.output(z.void()),
    me: oc.output(PublicUser.nullable()),
}

/** What the player app (app.<domain>) calls, mounted at /rpc. */
export const clientContract = {
    auth: {
        ...session,
        login: oc.input(Credentials).output(PublicUser),
        signup: oc.input(Signup).output(PublicUser),
        /** Always succeeds, so the answer never says whether the address has an account. */
        requestPasswordReset: oc.input(z.object({ email: Email })).output(z.object({ ok: z.literal(true) })),
        resetPassword: oc.input(z.object({ token: z.string().min(1).max(200), password: NewPassword })).output(z.void()),
        /** Public: the emailed link may open in a browser that isn't signed in. */
        verifyEmail: oc.input(z.object({ token: z.string().min(1).max(200) })).output(z.void()),
    },
    account: {
        resendVerification: oc.output(z.void()),
        /** Only while the account has no email yet. */
        addEmail: oc.input(z.object({ email: Email })).output(z.void()),
        changePassword: oc.input(z.object({ current: z.string().min(1).max(200), next: NewPassword })).output(z.void()),
    },
    accounts: {
        list: oc.output(z.array(PublicAccount)),
        create: oc.input(CreateAccount).output(PublicAccount),
        update: oc.input(UpdateAccount).output(PublicAccount),
        remove: oc.input(Ids).output(z.void()),
        setDesiredState: oc.input(Ids.extend({ state: DesiredState })).output(z.void()),
        logs: oc.input(Id.extend({ before: z.number().int().optional(), limit: z.number().int().min(1).max(500).default(100) }))
            .output(z.array(LogLine)),
        runs: oc.input(Id.extend({ limit: z.number().int().min(1).max(100).default(10) })).output(z.array(Run)),
        /** Live status changes and log lines for the caller's accounts. */
        events: oc.output(eventIterator(BotEvent)),
    },
    plugins: {
        catalog: oc.output(z.array(PluginCatalogEntry)),
        /** How many attack plugins the caller may turn on per account; null for no limit. */
        attackLimit: oc.output(z.number().int().nullable()),
    },
    servers: { list: oc.output(z.array(Server)) },
}

/** What the admin app (admin.<domain>) calls, mounted at /admin/rpc. */
export const adminContract = {
    auth: {
        ...session,
        /** The password alone never starts an admin session: it sets a short-lived challenge cookie and says which step is next. */
        login: oc.input(Credentials).output(AdminLoginStep),
        verifyTotp: oc.input(SecondFactor).output(PublicUser),
        /** First sign-in only: a new secret to add to an authenticator app. */
        enrollStart: oc.output(z.object({ otpauthUri: z.string(), secret: z.string() })),
        /** The recovery codes are shown this once and can't be read again. */
        enrollConfirm: oc.input(z.object({ code: TotpCode })).output(z.object({ user: PublicUser, recoveryCodes: z.array(z.string()) })),
    },
    security: {
        /** Replaces the caller's recovery codes; the old ones stop working. */
        regenerateRecoveryCodes: oc.input(z.object({ code: TotpCode })).output(z.array(z.string())),
    },
    overview: oc.output(Overview),
    users: {
        list: oc.input(z.object({ search: z.string().trim().max(64).optional() })).output(z.array(AdminUser)),
        setStatus: oc.input(Id.extend({ status: UserStatus })).output(z.void()),
        setRole: oc.input(Id.extend({ role: Role })).output(z.void()),
        setMaxBots: oc.input(Id.extend({ maxBots: z.number().int().min(0).max(50) })).output(z.void()),
        /** null clears the override, so the user follows the global default. */
        setAttackPluginCap: oc.input(Id.extend({ cap: AttackPluginCap.nullable() })).output(z.void()),
        revokeSessions: oc.input(Id).output(z.void()),
        /** Forgets another user's authenticator and recovery codes, so their next admin sign-in sets up a new one. */
        resetTotp: oc.input(Id).output(z.void()),
    },
    settings: {
        get: oc.output(z.object({ attackPluginCap: AttackPluginCap })),
        setAttackPluginCap: oc.input(z.object({ cap: AttackPluginCap })).output(z.void()),
    },
    accounts: {
        list: oc.output(z.array(AdminAccount)),
        forceStop: oc.input(Id).output(z.void()),
    },
    audit: {
        list: oc.input(z.object({ limit: z.number().int().min(1).max(500).default(100), before: z.number().int().optional() }))
            .output(z.array(AuditEntry)),
    },
}

export type ClientContract = typeof clientContract
export type AdminContract = typeof adminContract
export type ClientApi = ContractRouterClient<ClientContract>
export type AdminApi = ContractRouterClient<AdminContract>
