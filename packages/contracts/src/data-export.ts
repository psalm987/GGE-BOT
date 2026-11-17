import * as z from "zod"
import { LicenseCode, Period, PointsEntry, Purchase } from "./billing.ts"
import { Notification, NotificationPrefs } from "./notifications.ts"
import { PLAN_IDS } from "./plans.ts"
import { BotStatus, DesiredState, LocaleCode, Role, Run } from "./schemas.ts"

/**
 * Everything the app holds about one player, for them to download. Game passwords, the panel password hash,
 * admins' notes and payment provider references are not part of it; the schema strips any field it doesn't name.
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
        locale: LocaleCode.nullable(),
        detectedLocale: LocaleCode.nullable(),
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
    /** Every period of plan time, oldest first. */
    planPeriods: z.array(Period),
    purchases: z.array(Purchase),
    /** The codes of the Team packages the player bought, with who redeemed each. */
    codesBought: z.array(LicenseCode),
    codesRedeemed: z.array(z.object({ code: z.string(), planId: z.enum(PLAN_IDS), days: z.number().int(), redeemedAt: z.date() })),
    /** Every points change, oldest first. */
    points: z.array(PointsEntry),
})
export type DataExport = z.infer<typeof DataExport>
