import * as z from "zod"
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

export const PublicUser = z.object({ id: z.uuid(), username: z.string(), role: Role, email: z.string().nullable(), emailVerified: z.boolean(), maxBots: z.number().int() })
export type PublicUser = z.infer<typeof PublicUser>

export const BotStatus = z.object({
    actualState: ActualState,
    heartbeatAt: z.date().nullable(),
    lastError: z.string().nullable(),
    bannedUntil: z.date().nullable(),
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

export const AdminUser = PublicUser.extend({
    status: UserStatus,
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
})

export const Run = z.object({
    id: z.number().int(),
    startedAt: z.date(),
    endedAt: z.date().nullable(),
    endReason: z.string().nullable(),
    error: z.string().nullable(),
})

export const LogsInput = Id.extend({ before: z.number().int().optional(), limit: z.number().int().min(1).max(500).default(100) })
export const RunsInput = Id.extend({ limit: z.number().int().min(1).max(100).default(10) })

export const Overview = z.object({
    users: z.number().int(),
    accounts: z.number().int(),
    bots: z.record(ActualState, z.number().int()),
    runner: z.object({ beatAt: z.date(), startedAt: z.date(), version: z.string(), running: z.number().int() }).nullable(),
    last24h: z.object({ runs: z.number().int(), crashes: z.number().int() }),
})
