import * as z from "zod"
import { PluginSettings } from "./plugins.ts"

export const Role = z.enum(["user", "admin"])
export const UserStatus = z.enum(["active", "disabled"])
export const DesiredState = z.enum(["running", "stopped"])
export const ActualState = z.enum(["starting", "running", "stopped", "auth_failed", "banned", "error"])

export const Username = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/, "letters, digits, _ . - only")
export const NewPassword = z.string().min(10, "at least 10 characters").max(200)
const LoginPassword = z.string().min(1).max(200)

export const Credentials = z.object({ username: z.string().trim().min(1).max(64), password: LoginPassword })
export const Signup = z.object({ inviteCode: z.string().trim().min(1).max(200), username: Username, password: NewPassword })

export const PublicUser = z.object({ id: z.uuid(), username: z.string(), role: Role })
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
    createdAt: z.date(),
    accountCount: z.number().int(),
})

export const Invite = z.object({
    id: z.uuid(),
    role: Role,
    createdAt: z.date(),
    expiresAt: z.date(),
    usedAt: z.date().nullable(),
    usedBy: z.string().nullable(),
    revokedAt: z.date().nullable(),
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

export const Overview = z.object({
    users: z.number().int(),
    accounts: z.number().int(),
    bots: z.record(ActualState, z.number().int()),
    runnerHeartbeatAt: z.date().nullable(),
})
