import { oc, type ContractRouterClient } from "@orpc/contract"
import * as z from "zod"
import { DataExport } from "./data-export.ts"
import { AttackPluginCap, PluginCatalogEntry } from "./plugins.ts"
import { Notification, NotificationPrefs } from "./notifications.ts"
import { AdminProxy, CreateProxy, UpdateProxy } from "./proxies.ts"
import { NotificationsRead, RealtimeToken } from "./realtime.ts"
import {
    ActualState, AdminAccount, AdminLoginStep, AdminUser, AdminUserDetail, AuditEntry, CreateAccount, Credentials, DesiredState, Email, Id, Ids, LocaleCode, LoginPassword, NewPassword, LogLine,
    LogsInput, Overview, Page, PublicAccount, PublicUser, Role, Run, RunsInput, SecondFactor, Search, Server, Signup, TotpCode, UpdateAccount, UserStatus,
} from "./schemas.ts"

export * from "./data-export.ts"
export * from "./entitlement.ts"
export * from "./notifications.ts"
export * from "./plugins.ts"
export * from "./proxies.ts"
export * from "./realtime.ts"
export * from "./schedule.ts"
export * from "./schemas.ts"

/** Public. The language to start in: from the caller's IP, else their Accept-Language header. */
const detectLocale = oc.output(z.object({
    locale: LocaleCode,
    country: z.string().nullable(),
    source: z.enum(["ip", "header", "default"]),
}))

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
    i18n: { detect: detectLocale },
    account: {
        /** The language the user picked, kept across devices; null is Automatic. */
        setLocale: oc.input(z.object({ locale: LocaleCode.nullable() })).output(z.void()),
        resendVerification: oc.output(z.void()),
        /** Sets the email while it isn't confirmed yet: a first address, or a fix for a mistyped one. */
        addEmail: oc.input(z.object({ email: Email })).output(z.void()),
        changePassword: oc.input(z.object({ current: z.string().min(1).max(200), next: NewPassword })).output(z.void()),
        /** Which kinds of notification are also emailed. */
        notificationPrefs: oc.output(NotificationPrefs),
        setNotificationPrefs: oc.input(NotificationPrefs).output(z.void()),
        /** Only for a verified email. Emails a confirm link to the new address; nothing changes until it is opened. */
        changeEmail: oc.input(z.object({ email: Email, password: LoginPassword })).output(z.void()),
        /** Public: the emailed link may open in a browser that isn't signed in. Ends every session the user has. */
        confirmEmailChange: oc.input(z.object({ token: z.string().min(1).max(200) })).output(z.void()),
        /** Once every 10 minutes per player. */
        exportData: oc.output(DataExport),
        /** Deletes the caller and everything they own. `confirmUsername` is their username, typed out. */
        deleteMe: oc.input(z.object({ password: LoginPassword, confirmUsername: z.string().trim().max(64) })).output(z.void()),
    },
    /** The caller's own notifications, newest first. An unverified player can read them too. */
    notifications: {
        /** `unread` counts every unread notification, not only the ones on this page. */
        list: oc.input(z.object({ before: z.number().int().optional(), limit: z.number().int().min(1).max(50).default(20) }))
            .output(z.object({ items: z.array(Notification), unread: z.number().int() })),
        markRead: oc.input(NotificationsRead).output(z.void()),
    },
    accounts: {
        list: oc.output(z.array(PublicAccount)),
        create: oc.input(CreateAccount).output(PublicAccount),
        update: oc.input(UpdateAccount).output(PublicAccount),
        remove: oc.input(Ids).output(z.void()),
        setDesiredState: oc.input(Ids.extend({ state: DesiredState })).output(z.void()),
        logs: oc.input(LogsInput).output(z.array(LogLine)),
        runs: oc.input(RunsInput).output(z.array(Run)),
    },
    /** Tokens for the Centrifugo websocket at /connection/websocket. Both answer NOT_IMPLEMENTED on a deployment without Centrifugo. */
    realtime: {
        /** Opens the socket as the caller, which also lets it subscribe to its own userChannel. */
        connectionToken: oc.output(RealtimeToken),
        /** Lets the caller's socket subscribe to one of their accounts' botChannel. */
        subscriptionToken: oc.input(z.object({ accountId: z.uuid() })).output(RealtimeToken),
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
    i18n: { detect: detectLocale },
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
        /** `search` matches a username, case-insensitively, anywhere in it. Newest first. */
        list: oc.input(Page.extend({ search: Search, role: Role.optional(), status: UserStatus.optional() }))
            .output(z.object({ items: z.array(AdminUser), total: z.number().int() })),
        get: oc.input(Id).output(AdminUserDetail),
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
        /** `search` matches an account name or its owner's username. `state` is the actual state. Newest first. */
        list: oc.input(Page.extend({ search: Search, ownerId: z.uuid().optional(), state: ActualState.optional() }))
            .output(z.object({ items: z.array(AdminAccount), total: z.number().int() })),
        forceStop: oc.input(Id).output(z.void()),
        /**
         * Pins the account to a proxy, even one already at its `maxAccounts`; null unpins it, and the runner picks one
         * the next time the account starts. Refused for an event twin and for a proxy that is off.
         */
        setProxy: oc.input(Id.extend({ proxyId: z.uuid().nullable() })).output(z.void()),
        /** Any account's log and runs, paged like the owner's. */
        logs: oc.input(LogsInput).output(z.array(LogLine)),
        runs: oc.input(RunsInput).output(z.array(Run)),
    },
    /** The pool of proxies bots connect to the game through. No output ever carries a proxy's URL or credentials. */
    proxies: {
        list: oc.output(z.array(AdminProxy)),
        create: oc.input(CreateProxy).output(AdminProxy),
        update: oc.input(UpdateProxy).output(AdminProxy),
        /** Its accounts are left without a proxy, and the runner assigns them another when they next start. */
        remove: oc.input(Id).output(z.void()),
    },
    audit: {
        /** `actorId` and `targetId` together match entries by or about that user. */
        list: oc.input(z.object({ limit: z.number().int().min(1).max(500).default(100), before: z.number().int().optional(), actorId: z.uuid().optional(), targetId: z.uuid().optional() }))
            .output(z.array(AuditEntry)),
    },
}

export type ClientContract = typeof clientContract
export type AdminContract = typeof adminContract
export type ClientApi = ContractRouterClient<ClientContract>
export type AdminApi = ContractRouterClient<AdminContract>
