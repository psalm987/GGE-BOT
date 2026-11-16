import * as z from "zod"
import { Notification, NotificationPrefs } from "./notifications.ts"
import { BotStatus, DesiredState, Role, Run } from "./schemas.ts"

/**
 * Everything the app holds about one player, for them to download. Game passwords and the panel
 * password hash are not part of it; the schema strips any field it doesn't name.
 */
export const DataExport = z.object({
    exportedAt: z.date(),
    profile: z.object({
        username: z.string(),
        email: z.string().nullable(),
        emailVerified: z.boolean(),
        role: Role,
        maxBots: z.number().int(),
        createdAt: z.date(),
        notificationPrefs: NotificationPrefs,
    }),
    accounts: z.array(z.object({
        id: z.uuid(),
        name: z.string(),
        server: z.string(),
        externalEvent: z.boolean(),
        desiredState: DesiredState,
        schedule: z.unknown(),
        createdAt: z.date(),
        status: BotStatus.nullable(),
    })),
    /** These three name their account by `accountId`. */
    pluginSettings: z.array(z.object({ accountId: z.uuid(), pluginKey: z.string(), enabled: z.boolean(), options: z.unknown() })),
    runs: z.array(Run.extend({ accountId: z.uuid() })),
    /** Whatever the log retention still holds. */
    logs: z.array(z.object({ accountId: z.uuid(), ts: z.date(), level: z.number().int(), message: z.string() })),
    notifications: z.array(Notification),
    /** What the player did, as the audit log recorded it. */
    audit: z.array(z.object({ action: z.string(), targetType: z.string().nullable(), targetId: z.string().nullable(), meta: z.unknown(), ts: z.date() })),
})
export type DataExport = z.infer<typeof DataExport>
