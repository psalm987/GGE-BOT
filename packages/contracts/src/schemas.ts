import * as z from "zod"
import { LOCALE_CODES } from "@gge/i18n"
import { PLAN_IDS } from "./plans.ts"
import { AccountCastle, PluginStates } from "./plugin-checks.ts"
import { AttackPluginCap, PluginSettings } from "./plugins.ts"
import { Schedule } from "./schedule.ts"

export const Role = z.enum(["user", "admin"])
export const UserStatus = z.enum(["active", "disabled"])
export const DesiredState = z.enum(["running", "stopped"])
export const ActualState = z.enum(["starting", "running", "stopped", "auth_failed", "banned", "error", "crash_loop"])

export const Username = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/, "letters, digits, _ . - only")
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254))
export const NewPassword = z.string().min(10, "at least 10 characters").max(200)
export const LoginPassword = z.string().min(1).max(200)

/** `login` is a username or an email; usernames can't contain "@", so the two never collide. */
export const Credentials = z.object({ login: z.string().trim().min(1).max(254), password: LoginPassword })
export const Signup = z.object({ username: Username, email: Email, password: NewPassword, turnstileToken: z.string().max(2048).optional() })

/** Authenticator codes are often typed or pasted as "123 456". */
export const TotpCode = z.string().max(32).transform(s => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code"))
/** Either a current authenticator code or one of the one-time recovery codes. */
export const SecondFactor = z.union([z.object({ code: TotpCode }), z.object({ recoveryCode: z.string().trim().min(1).max(64) })])
/** What an admin owes after the password: a code, or first setting up an authenticator. */
export const AdminLoginStep = z.object({ step: z.enum(["totp", "enroll"]) })

export const LocaleCode = z.enum(LOCALE_CODES)

/** `locale` is the language the user picked; null is Automatic. */
/** `accountLimit` is how many accounts the user may run now, from accountLimit(): users.max_bots while billing is off, the plan once it is live. */
export const PublicUser = z.object({ id: z.uuid(), username: z.string(), role: Role, email: z.string().nullable(), emailVerified: z.boolean(), accountLimit: z.number().int(), locale: LocaleCode.nullable() })
export type PublicUser = z.infer<typeof PublicUser>

/**
 * What the bot last read from the game for the account. A figure is null while the game hasn't reported it:
 * the worker leaves out a figure that is 0, so null can mean zero as well as unknown.
 * Food, mead and aquamarine are the Storm Islands castle's.
 */
export const AccountResources = z.object({
    food: z.number().nullable(),
    mead: z.number().nullable(),
    cash: z.number().nullable(),
    gold: z.number().nullable(),
    aquamarine: z.number().nullable(),
    /** Attacks sent today, the game's own daily counter. */
    attackDailyCount: z.number().nullable(),
    /** When the runner stored this report; null for one stored before the runner stamped them. */
    reportedAt: z.date().nullable(),
})
export type AccountResources = z.infer<typeof AccountResources>

export const BotStatus = z.object({
    actualState: ActualState,
    heartbeatAt: z.date().nullable(),
    lastError: z.string().nullable(),
    bannedUntil: z.date().nullable(),
    /** What each plugin last said it is doing during the current run. Missing from a runner older than this field. */
    pluginStates: PluginStates.default({}),
    /** The castles the bot last found on the account; empty until it has run. */
    castles: z.array(AccountCastle).default([]),
    /** How many commanders the bot last counted on the account; null until it has run. */
    commanders: z.number().int().min(0).nullable().default(null),
    /** The figures in the worker's last report; null until it has made one. */
    resources: AccountResources.nullable().default(null),
})

export const PublicAccount = z.object({
    id: z.uuid(),
    name: z.string(),
    serverId: z.number().int(),
    desiredState: DesiredState,
    externalEvent: z.boolean(),
    plugins: PluginSettings,
    status: BotStatus.nullable(),
    createdAt: z.date(),
    /** An event account paired with a main of the same name and server: it doesn't count toward maxBots. */
    isTwin: z.boolean(),
    /** False when the owner's plan doesn't cover this account, so it can't run. */
    entitled: z.boolean(),
    /** When the account may run; null for whenever it is wanted. */
    schedule: Schedule.nullable(),
    /** Set while the account is wanted but outside its schedule: when it next starts. */
    sleepingUntil: z.date().nullable(),
})
export type PublicAccount = z.infer<typeof PublicAccount>

const AccountName = z.string().trim().min(1).max(64)
const GamePassword = z.string().min(1).max(200)

export const CreateAccount = z.object({
    name: AccountName,
    serverId: z.number().int(),
    password: GamePassword,
    externalEvent: z.boolean().default(false),
    plugins: PluginSettings.default({}),
    schedule: Schedule.nullable().default(null),
})

/** password is write-only: omit it to keep the stored one. Omit schedule to keep it; null removes it. */
export const UpdateAccount = z.object({
    id: z.uuid(),
    name: AccountName.optional(),
    serverId: z.number().int().optional(),
    password: GamePassword.optional(),
    externalEvent: z.boolean().optional(),
    plugins: PluginSettings.optional(),
    schedule: Schedule.nullable().optional(),
})

export const Ids = z.object({ ids: z.array(z.uuid()).min(1).max(200) })
export const Id = z.object({ id: z.uuid() })

export const Server = z.object({ id: z.number().int(), label: z.string() })

/** One page of a server-side list. */
export const Page = z.object({ limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) })
export const Search = z.string().trim().max(64).optional()

export const AdminUser = PublicUser.omit({ locale: true, accountLimit: true }).extend({
    /** users.max_bots, the limit while billing is off. */
    maxBots: z.number().int(),
    status: UserStatus,
    /** Replaces the plan's account limit while billing is live; null follows the plan. */
    maxBotsOverride: z.number().int().nullable(),
    /** The plan covering now and when the user's cover runs out; null when none covers now. */
    plan: z.object({ planId: z.enum(PLAN_IDS), isTrial: z.boolean(), endsAt: z.date() }).nullable(),
    /** null: the user follows the global default. */
    attackPluginCap: AttackPluginCap.nullable(),
    createdAt: z.date(),
    accountCount: z.number().int(),
    /** True once the user has set up an authenticator for admin sign-in. */
    totpEnabled: z.boolean(),
})

export const AdminUserDetail = AdminUser.extend({
    /** The latest `auth.login.*` audit entry by this user. */
    lastLoginAt: z.date().nullable(),
    /** Unexpired sessions, per app. */
    sessions: z.object({ client: z.number().int(), admin: z.number().int() }),
})

export const AdminAccount = PublicAccount.omit({ plugins: true }).extend({
    ownerId: z.uuid(),
    owner: z.string(),
    /** The proxy this account is assigned to; null for none. An event twin has none of its own and uses its main's. */
    proxyId: z.uuid().nullable(),
    proxyLabel: z.string().nullable(),
})

export const AuditEntry = z.object({
    id: z.number().int(),
    actor: z.string().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    meta: z.unknown(),
    ts: z.date(),
})

export const LogLine = z.object({
    id: z.number().int(),
    ts: z.date(),
    level: z.number().int(),
    message: z.string(),
    /** Raw translation keys and values, for rendering in the viewer's language. */
    parts: z.array(z.union([z.string(), z.number()])).nullable(),
    /** The plugin key or core script name that wrote the line, when its parts say. Defaults to null so lines from a runner older than this field still parse. */
    plugin: z.string().nullable().default(null),
})

/** A line in the global feed, which mixes accounts. */
export const FeedLine = LogLine.extend({ accountId: z.uuid() })
export type FeedLine = z.infer<typeof FeedLine>

/** 0 info, 1 warning, 2 error, 3 the game said "not now": a refusal that is only the state of the game and passes by itself. */
export const LogLevel = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

export const FeedInput = z.object({
    accountIds: z.array(z.uuid()).max(50).optional(),
    levels: z.array(LogLevel).optional(),
    plugins: z.array(z.string()).max(64).optional(),
    before: z.number().int().optional(),
    limit: z.number().int().min(1).max(500).default(200),
})

/** What the owner's retained lines hold, so a filter bar offers only choices that match something. */
export const FeedFacets = z.object({
    total: z.number().int(),
    accounts: z.array(z.object({ id: z.uuid(), name: z.string(), serverLabel: z.string(), count: z.number().int() })),
    plugins: z.array(z.object({ key: z.string(), count: z.number().int() })),
    levels: z.array(z.object({ level: z.number().int(), count: z.number().int() })),
})

/** How long the runner keeps an account's log lines: the newest `perAccount`, and none older than `days`. */
export const LOG_RETENTION = { perAccount: 500, days: 7 } as const

/** The windows `LogActivity` counts over. The error window is the whole retention, so a window can only fall short by the line cap. */
export const ACTIVITY_WINDOW = { attackHours: 24, errorDays: LOG_RETENTION.days } as const

/**
 * What each of the caller's accounts did lately, counted from the log lines the runner kept: attacks the bot logged as
 * hitting a target, and error lines (level 2, not the "not now" refusals). An account with no lines is left out.
 * `complete` is false when the cap on kept lines may have dropped some inside the window, so the count is a floor.
 */
export const LogActivity = z.object({
    accounts: z.array(z.object({
        accountId: z.uuid(),
        attacks: z.number().int(),
        attacksComplete: z.boolean(),
        errors: z.number().int(),
        errorsComplete: z.boolean(),
    })),
})
export type LogActivity = z.infer<typeof LogActivity>

export const Run = z.object({
    id: z.number().int(),
    startedAt: z.date(),
    endedAt: z.date().nullable(),
    endReason: z.string().nullable(),
    error: z.string().nullable(),
})

export const RunsInput = Id.extend({ limit: z.number().int().min(1).max(100).default(10) })

export const Overview = z.object({
    users: z.number().int(),
    accounts: z.number().int(),
    bots: z.record(ActualState, z.number().int()),
    runner: z.object({ beatAt: z.date(), startedAt: z.date(), version: z.string(), running: z.number().int() }).nullable(),
    last24h: z.object({ runs: z.number().int(), crashes: z.number().int() }),
})
