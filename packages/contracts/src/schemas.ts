import * as z from "zod"
import { AttackPluginCap, PluginSettings } from "./plugins.ts"

export const Role = z.enum(["user", "admin"])
export const UserStatus = z.enum(["active", "disabled"])
export const DesiredState = z.enum(["running", "stopped"])
export const ActualState = z.enum(["starting", "running", "stopped", "auth_failed", "banned", "error", "crash_loop"])

export const Username = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/, "letters, digits, _ . - only")
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254))
export const NewPassword = z.string().min(10, "at least 10 characters").max(200)
const LoginPassword = z.string().min(1).max(200)

/** `login` is a username or an email; usernames can't contain "@", so the two never collide. */
export const Credentials = z.object({ login: z.string().trim().min(1).max(254), password: LoginPassword })
export const Signup = z.object({ username: Username, email: Email, password: NewPassword, turnstileToken: z.string().max(2048).optional() })

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
})

/** password is write-only: omit it to keep the stored one. */
export const UpdateAccount = z.object({
    id: z.uuid(),
    name: AccountName.optional(),
    serverId: z.number().int().optional(),
    password: GamePassword.optional(),
    externalEvent: z.boolean().optional(),
    plugins: PluginSettings.optional(),
})

export const Ids = z.object({ ids: z.array(z.uuid()).min(1).max(200) })
export const Id = z.object({ id: z.uuid() })

export const Server = z.object({ id: z.number().int(), label: z.string() })

export const AdminUser = PublicUser.extend({
    status: UserStatus,
    /** null: the user follows the global default. */
    attackPluginCap: AttackPluginCap.nullable(),
    createdAt: z.date(),
    accountCount: z.number().int(),
})

export const AdminAccount = PublicAccount.omit({ plugins: true }).extend({ owner: z.string() })

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

export const BotEvent = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("status"), accountId: z.uuid(), status: BotStatus }),
    z.object({ kind: z.literal("log"), accountId: z.uuid(), line: LogLine.omit({ parts: true }) }),
])
export type BotEvent = z.infer<typeof BotEvent>

export const Overview = z.object({
    users: z.number().int(),
    accounts: z.number().int(),
    bots: z.record(ActualState, z.number().int()),
    runner: z.object({ beatAt: z.date(), startedAt: z.date(), version: z.string(), running: z.number().int() }).nullable(),
    last24h: z.object({ runs: z.number().int(), crashes: z.number().int() }),
})
