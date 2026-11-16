import * as z from "zod"

/** A date that may have travelled as JSON, where it is an ISO string. */
export const WireDate = z.union([z.date(), z.iso.datetime().pipe(z.coerce.date())])

/** Why a bot stopped in a way only its owner can undo. */
export const NotificationKind = z.enum(["banned", "auth_failed", "crash_loop", "shutoff"])
export type NotificationKind = z.infer<typeof NotificationKind>
export const NOTIFICATION_KINDS = NotificationKind.options

/** Copied from the account when it stopped, so the notification still reads right once the account is renamed or removed. */
const snapshot = z.object({ accountName: z.string(), serverLabel: z.string() })

const content = <K extends NotificationKind, D extends z.ZodRawShape>(kind: K, data: D) =>
    z.object({ kind: z.literal(kind), data: snapshot.extend(data) })

const contents = [
    /** `bannedUntil` is an ISO time, or null when the game didn't say. */
    content("banned", { bannedUntil: z.iso.datetime().nullable() }),
    content("auth_failed", { lastError: z.string().nullable() }),
    content("crash_loop", { failures: z.number().int(), lastError: z.string() }),
    content("shutoff", {}),
] as const

/** What happened, as stored in notifications.kind and notifications.data. */
export const NotificationContent = z.discriminatedUnion("kind", contents)
export type NotificationContent = z.infer<typeof NotificationContent>

const delivery = {
    id: z.number().int(),
    /** null once the account has been removed; `data` still says which one it was. */
    accountId: z.uuid().nullable(),
    createdAt: WireDate,
    readAt: WireDate.nullable(),
}
const [banned, authFailed, crashLoop, shutoff] = contents
export const Notification = z.discriminatedUnion("kind", [
    banned.extend(delivery), authFailed.extend(delivery), crashLoop.extend(delivery), shutoff.extend(delivery),
])
export type Notification = z.infer<typeof Notification>

export const EmailState = z.enum(["pending", "sent", "skipped", "failed"])
export type EmailState = z.infer<typeof EmailState>

/** Which kinds are also emailed. */
export const NotificationPrefs = z.object({ banned: z.boolean(), auth_failed: z.boolean(), crash_loop: z.boolean(), shutoff: z.boolean() })
export type NotificationPrefs = z.infer<typeof NotificationPrefs>
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { banned: true, auth_failed: true, crash_loop: true, shutoff: false }

/** The stored preferences with the default for every kind the player never chose. */
export const notificationPrefs = (stored: unknown): NotificationPrefs =>
    ({ ...DEFAULT_NOTIFICATION_PREFS, ...NotificationPrefs.partial().catch({}).parse(stored) })

const minute = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`

/** One notification in words, for the bell and the email. */
export function describeNotification({ kind, data }: NotificationContent): { title: string; body: string } {
    const name = data.accountName
    switch (kind) {
        case "banned": return {
            title: `${name} was banned`,
            body: data.bannedUntil
                ? `The game banned this account until ${minute(data.bannedUntil)}. Its bot is stopped.`
                : "The game banned this account. Its bot is stopped.",
        }
        case "auth_failed": return {
            title: `${name} couldn't sign in`,
            body: "The game rejected the saved password. Update it, then start the bot again.",
        }
        case "crash_loop": return {
            title: `${name} stopped after repeated crashes`,
            body: `It failed ${data.failures} times in a row and won't restart on its own. Last error: ${data.lastError}`,
        }
        case "shutoff": return {
            title: `${name} was stopped by its shutoff timer`,
            body: "Start it again when you're ready.",
        }
    }
}
