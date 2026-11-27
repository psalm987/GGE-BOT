import { oc, type ContractRouterClient } from "@orpc/contract"
import * as z from "zod"
import { AdminAnnouncement, Alerts, CreateAnnouncement, POINTS_NUDGE, UpdateAnnouncement } from "./alerts.ts"
import {
    AdminPeriod, AdminPurchase, BillingConfig, BillingSettings, BillingStatus, Checkout, GrantDays, LicenseCode, MyPlan, Package, PaymentOutcome, Period, PlanRow, PointsRedemption,
    PointsSummary, Purchase, PurchaseStatus, RecordPurchase, UpdatePackage, UserPlan,
} from "./billing.ts"
import { CreateVirtualPreset, UpdateVirtualPreset, VirtualPreset } from "./army.ts"
import { DataExport } from "./data-export.ts"
import { GameItem, GameItemKind } from "./game-items.ts"
import { AttackPluginCap, PluginCatalogEntry } from "./plugins.ts"
import { Notification, NotificationPrefs } from "./notifications.ts"
import { AdminProxy, CreateProxy, UpdateProxy } from "./proxies.ts"
import { NotificationsRead, RealtimeToken } from "./realtime.ts"
import {
    ActualState, AdminAccount, FeedFacets, FeedInput, FeedLine, LogActivity, AdminLoginStep, AdminUser, AdminUserDetail, AuditEntry, CreateAccount, Credentials, DesiredState, Email, Id, Ids, LocaleCode, LoginPassword, NewPassword,
    AccountProblem, Overview, Page, PublicAccount, PublicUser, Role, Run, RunsInput, SecondFactor, Search, Server, Signup, TotpCode, UpdateAccount, UserStatus,
} from "./schemas.ts"

export * from "./alerts.ts"
export * from "./army.ts"
export * from "./billing.ts"
export * from "./blade-coast.ts"
export * from "./codes.ts"
export * from "./data-export.ts"
export * from "./entitlement.ts"
export * from "./game-items.ts"
export * from "./modules.ts"
export * from "./notifications.ts"
export * from "./plans.ts"
export * from "./plugin-checks.ts"
export * from "./worker-messages.ts"
export * from "./plugins.ts"
export * from "./proxies.ts"
export * from "./read-back.ts"
export * from "./realtime.ts"
export * from "./schedule.ts"
export * from "./schemas.ts"

/** Public. The language to start in: from the caller's IP, else their Accept-Language header. */
const detectLocale = oc.output(z.object({
    locale: LocaleCode,
    country: z.string().nullable(),
    source: z.enum(["ip", "header", "default"]),
}))

/** The game's items, read from its items file when the runner starts. */
const gameItems = oc.input(z.object({ kind: GameItemKind })).output(z.array(GameItem))

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
    /** The banners above every page. Refetch on focus, every few minutes, and on the `alerts` live event. */
    alerts: {
        list: oc.output(Alerts),
        /** Closes a dismissible announcement, or the points banner (POINTS_NUDGE), for the caller on every device. Others are refused. */
        dismiss: oc.input(z.object({ id: z.union([z.uuid(), z.literal(POINTS_NUDGE)]) })).output(z.void()),
    },
    /** Every retained line of the caller's accounts together, newest first. */
    logs: {
        feed: oc.input(FeedInput).output(z.array(FeedLine)),
        facets: oc.output(FeedFacets),
        /** Attacks in the last 24 hours and errors in the last 7 days per account, from the kept lines, for the dashboard. */
        activity: oc.output(LogActivity),
    },
    accounts: {
        list: oc.output(z.array(PublicAccount)),
        create: oc.input(CreateAccount).output(PublicAccount),
        update: oc.input(UpdateAccount).output(PublicAccount),
        remove: oc.input(Ids).output(z.void()),
        setDesiredState: oc.input(Ids.extend({ state: DesiredState })).output(z.void()),
        runs: oc.input(RunsInput).output(z.array(Run)),
        /** The game's refusals of the account's requests, the latest first, at most PROBLEMS_KEPT of them. */
        problems: oc.input(Id).output(z.array(AccountProblem)),
    },
    /**
     * Named wave plans an account's attack plugins can pick. Every call is scoped to the caller's accounts: another player's
     * account answers ACCOUNT_NOT_FOUND and their preset VIRTUAL_PRESET_NOT_FOUND, as if it did not exist.
     */
    virtualPresets: {
        list: oc.input(z.object({ accountId: z.uuid() })).output(z.array(VirtualPreset)),
        /** Refused with VIRTUAL_PRESET_LIMIT past MAX_VIRTUAL_PRESETS, and VIRTUAL_PRESET_DUPLICATE for a name the account already has (any case). */
        create: oc.input(CreateVirtualPreset).output(VirtualPreset),
        update: oc.input(UpdateVirtualPreset).output(VirtualPreset),
        /** Refused with VIRTUAL_PRESET_IN_USE while a plugin of the account stores it as its waves. */
        remove: oc.input(Id).output(z.void()),
    },
    /** Tokens for the Centrifugo websocket at /connection/websocket. Both answer NOT_IMPLEMENTED on a deployment without Centrifugo. */
    realtime: {
        /** Opens the socket as the caller, which also lets it subscribe to its own userChannel. */
        connectionToken: oc.output(RealtimeToken),
        /** Lets the caller's socket subscribe to one of their accounts' botChannel. */
        subscriptionToken: oc.input(z.object({ accountId: z.uuid() })).output(RealtimeToken),
        /** One token per account, all or nothing: any id that isn't the caller's refuses the whole call. */
        subscriptionTokens: oc.input(z.object({ accountIds: z.array(z.uuid()).min(1).max(50) })).output(z.record(z.uuid(), z.string())),
    },
    /**
     * Refused with data.code BILLING_NOT_LIVE while billing is off, except for an admin trying it out. config, checkout and
     * confirm are not, and say how they answer instead.
     */
    billing: {
        /** Answers while billing is off too, with onlinePayments false for a player. */
        config: oc.output(BillingConfig),
        /**
         * Starts paying for a package with Paystack: send the browser to authorizationUrl. Refused with data.code PAYMENTS_DISABLED
         * without a Paystack key on the API, or for a player while billing is off. Five a player per 10 minutes, then TOO_MANY_REQUESTS.
         */
        checkout: oc.input(z.object({ packageId: z.string().min(1).max(64) })).output(Checkout),
        /**
         * Asks Paystack how the caller's payment went and delivers it if it was paid in full. For the return page, with the
         * reference Paystack adds to its URL. Repeating it delivers nothing more. Works while billing is off, for a payment started before.
         */
        confirm: oc.input(z.object({ reference: z.string().trim().min(1).max(100) })).output(PaymentOutcome),
        /** `before` is the id of the oldest history entry already shown. */
        points: oc.input(z.object({ before: z.number().int().optional(), limit: z.number().int().min(1).max(50).default(20) })).output(PointsSummary),
        /**
         * Spends the redeem cost on a period queued behind the caller's last. Refused with data.code NOT_ENOUGH_POINTS and
         * `data.params.count` (the points still missing). A repeat with the same key spends nothing and answers as the first call did.
         */
        redeemPoints: oc.input(z.object({ idempotencyKey: z.uuid() })).output(PointsRedemption),
        /**
         * Spends a Team code on a period queued behind the caller's last. However the code is typed, see normalizeCode.
         * Refused with data.code CODE_INVALID, CODE_USED or CODE_REVOKED, and wrong codes are rate limited.
         */
        redeemCode: oc.input(z.object({ code: z.string().trim().min(1).max(64) })).output(z.object({ period: Period })),
        /** The codes of the Team packages the caller bought, newest purchase first. */
        myCodes: oc.output(z.array(LicenseCode)),
        myPurchases: oc.output(z.array(Purchase)),
        /** The caller's plan now, what is queued behind it, and how many accounts it runs. */
        myPlan: oc.output(MyPlan),
    },
    plugins: {
        catalog: oc.output(z.array(PluginCatalogEntry)),
        /** How many attack plugins the caller may turn on per account; null for no limit. */
        attackLimit: oc.output(z.number().int().nullable()),
    },
    servers: { list: oc.output(z.array(Server)) },
    catalog: { gameItems },
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
        /** `plan`: on a trial now, cover running out within 7 days, or no plan covering now. */
        list: oc.input(Page.extend({ search: Search, role: Role.optional(), status: UserStatus.optional(), plan: z.enum(["trial", "expiring", "none"]).optional() }))
            .output(z.object({ items: z.array(AdminUser), total: z.number().int() })),
        get: oc.input(Id).output(AdminUserDetail),
        setStatus: oc.input(Id.extend({ status: UserStatus })).output(z.void()),
        setRole: oc.input(Id.extend({ role: Role })).output(z.void()),
        setMaxBots: oc.input(Id.extend({ maxBots: z.number().int().min(0).max(50) })).output(z.void()),
        /** Replaces the plan's account limit for this user while billing is live; null follows the plan again. */
        setLimitOverride: oc.input(Id.extend({ maxBotsOverride: z.number().int().min(0).max(50).nullable() })).output(z.void()),
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
    /** Plans, trials and payments. All of it works while billing is off, so it can be tried before players see any of it. */
    billing: {
        status: oc.output(BillingStatus),
        /**
         * Turning on is refused with data.code PAYSTACK_NOT_CONFIGURED until the API has a Paystack key, and gives every
         * active, verified player who has had no trial theirs. Turning off puts every player back on users.max_bots and changes no data.
         */
        setLive: oc.input(z.object({ live: z.boolean() })).output(BillingStatus),
        settings: oc.output(BillingSettings),
        updateSettings: oc.input(BillingSettings.partial()).output(BillingSettings),
        /** Adds to or takes from a player's points. Answers with the new balance, which may be negative. */
        adjustPoints: oc.input(z.object({
            userId: z.uuid(),
            delta: z.number().int().min(-10_000).max(10_000).refine(n => n !== 0, "can't be zero"),
            note: z.string().trim().min(3).max(500),
        })).output(z.object({ balance: z.number().int() })),
        packages: oc.output(z.array(Package)),
        /** A price and its currency are set or cleared together. */
        updatePackage: oc.input(UpdatePackage).output(Package),
        /** A sale made outside the app. It is paid at once, so the buyer gets the time or the codes, and the points. */
        recordPurchase: oc.input(RecordPurchase).output(AdminPurchase),
        /** Newest first. `before` is the `createdAt` of the oldest purchase already shown. */
        purchases: oc.input(z.object({ userId: z.uuid().optional(), status: PurchaseStatus.optional(), before: z.date().optional(), limit: z.number().int().min(1).max(100).default(50) }))
            .output(z.array(AdminPurchase)),
        /** Cancels the purchase's unredeemed codes and takes back the points it earned. Time already given stays. */
        markRefunded: oc.input(z.object({ purchaseId: z.uuid() })).output(AdminPurchase),
        /** Refused with data.code CODE_USED for a code someone has redeemed. */
        revokeCode: oc.input(z.object({ codeId: z.uuid() })).output(z.void()),
        /** The plans and how many accounts each runs. */
        plans: oc.output(z.array(PlanRow)),
        updatePlan: oc.input(z.object({ id: PlanRow.shape.id, maxAccounts: z.number().int().min(0).max(50) })).output(PlanRow),
        userPlan: oc.input(z.object({ userId: z.uuid() })).output(UserPlan),
        /** Queues days on a plan behind the user's last period. The note says why and goes in the audit log. */
        grantDays: oc.input(GrantDays).output(AdminPeriod),
        /** Ends the period covering now and moves the queued ones up, so nothing is left with a gap. `ended` is false when none covered now. */
        endPeriod: oc.input(z.object({ userId: z.uuid() })).output(z.object({ ended: z.boolean() })),
    },
    /** Banners shown to every player. Each change is audited. */
    announcements: {
        /** Newest start first, ended ones included. */
        list: oc.output(z.array(AdminAnnouncement)),
        create: oc.input(CreateAnnouncement).output(AdminAnnouncement),
        update: oc.input(UpdateAnnouncement).output(AdminAnnouncement),
        /** Takes it down now. Ending one already ended changes nothing. */
        end: oc.input(z.object({ id: z.uuid() })).output(AdminAnnouncement),
    },
    /** One player's lines together, as they see them. */
    logs: {
        feed: oc.input(FeedInput.extend({ ownerId: z.uuid() })).output(z.array(FeedLine)),
        facets: oc.input(z.object({ ownerId: z.uuid() })).output(FeedFacets),
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
        /** Any account's runs. Its log is `logs.feed` with the owner's id. */
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
    catalog: { gameItems },
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
