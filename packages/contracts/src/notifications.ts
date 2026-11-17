import * as z from "zod"

/** A date that may have travelled as JSON, where it is an ISO string. */
export const WireDate = z.union([z.date(), z.iso.datetime().pipe(z.coerce.date())])

/** Why a bot stopped in a way only its owner can undo, or news about the owner's plan. */
export const NotificationKind = z.enum(["banned", "auth_failed", "crash_loop", "shutoff", "trial_started", "plan_expiring", "plan_expired", "purchase_completed"])
export type NotificationKind = z.infer<typeof NotificationKind>
export const NOTIFICATION_KINDS = NotificationKind.options

/** Copied from the account when it stopped, so the notification still reads right once the account is renamed or removed. */
const snapshot = z.object({ accountName: z.string(), serverLabel: z.string() })

/** About one account, so it carries that account's snapshot. */
const aboutAccount = <K extends NotificationKind, D extends z.ZodRawShape>(kind: K, data: D) =>
    z.object({ kind: z.literal(kind), data: snapshot.extend(data) })
/** About the player's plan. No account is part of it, so the snapshot is optional. */
const aboutPlan = <K extends NotificationKind, D extends z.ZodRawShape>(kind: K, data: D) =>
    z.object({ kind: z.literal(kind), data: snapshot.partial().extend(data) })

/** Each time is an ISO string. */
const contents = [
    /** `bannedUntil` is null when the game didn't say. */
    aboutAccount("banned", { bannedUntil: z.iso.datetime().nullable() }),
    aboutAccount("auth_failed", { lastError: z.string().nullable() }),
    aboutAccount("crash_loop", { failures: z.number().int(), lastError: z.string() }),
    aboutAccount("shutoff", {}),
    aboutPlan("trial_started", { endsAt: z.iso.datetime() }),
    /** `endsAt` is when the player's cover runs out. */
    aboutPlan("plan_expiring", { endsAt: z.iso.datetime(), daysLeft: z.number().int() }),
    aboutPlan("plan_expired", { endedAt: z.iso.datetime() }),
    /** `codes` is how many single-use codes it gave: `seats` for a Team package, 0 for Basic. */
    aboutPlan("purchase_completed", { packageId: z.string(), seats: z.number().int(), points: z.number().int(), codes: z.number().int() }),
] as const

/** What happened, as stored in notifications.kind and notifications.data. */
export const NotificationContent = z.discriminatedUnion("kind", contents)
export type NotificationContent = z.infer<typeof NotificationContent>

const delivery = {
    id: z.number().int(),
    /** null for a plan notification, and once the account has been removed; `data` still says which one it was. */
    accountId: z.uuid().nullable(),
    createdAt: WireDate,
    readAt: WireDate.nullable(),
}
const [banned, authFailed, crashLoop, shutoff, trialStarted, planExpiring, planExpired, purchaseCompleted] = contents
export const Notification = z.discriminatedUnion("kind", [
    banned.extend(delivery), authFailed.extend(delivery), crashLoop.extend(delivery), shutoff.extend(delivery),
    trialStarted.extend(delivery), planExpiring.extend(delivery), planExpired.extend(delivery), purchaseCompleted.extend(delivery),
])
export type Notification = z.infer<typeof Notification>

export const EmailState = z.enum(["pending", "sent", "skipped", "failed"])
export type EmailState = z.infer<typeof EmailState>

/** Which kinds are also emailed. */
export const NotificationPrefs = z.object({
    banned: z.boolean(), auth_failed: z.boolean(), crash_loop: z.boolean(), shutoff: z.boolean(),
    trial_started: z.boolean(), plan_expiring: z.boolean(), plan_expired: z.boolean(), purchase_completed: z.boolean(),
})
export type NotificationPrefs = z.infer<typeof NotificationPrefs>
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
    banned: true, auth_failed: true, crash_loop: true, shutoff: false,
    trial_started: true, plan_expiring: true, plan_expired: true, purchase_completed: true,
}

/** The stored preferences with the default for every kind the player never chose. */
export const notificationPrefs = (stored: unknown): NotificationPrefs =>
    ({ ...DEFAULT_NOTIFICATION_PREFS, ...NotificationPrefs.partial().catch({}).parse(stored) })

const minute = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

/** One notification in words, for the bell and the email. */
export function describeNotification({ kind, data }: NotificationContent): { title: string; body: string } {
    switch (kind) {
        case "banned": return {
            title: `${data.accountName} was banned`,
            body: data.bannedUntil
                ? `The game banned this account until ${minute(data.bannedUntil)}. Its bot is stopped.`
                : "The game banned this account. Its bot is stopped.",
        }
        case "auth_failed": return {
            title: `${data.accountName} couldn't sign in`,
            body: "The game rejected the saved password. Update it, then start the bot again.",
        }
        case "crash_loop": return {
            title: `${data.accountName} stopped after repeated crashes`,
            body: `It failed ${data.failures} times in a row and won't restart on its own. Last error: ${data.lastError}`,
        }
        case "shutoff": return {
            title: `${data.accountName} was stopped by its shutoff timer`,
            body: "Start it again when you're ready.",
        }
        case "trial_started": return {
            title: "Your free trial has started",
            body: `Your bots can run on the Basic plan until ${minute(data.endsAt)}.`,
        }
        case "plan_expiring": return {
            title: `Your plan ends in ${count(data.daysLeft, "day")}`,
            body: `It ends at ${minute(data.endsAt)}. Renew before then to keep your bots running.`,
        }
        case "plan_expired": return {
            title: "Your plan has ended",
            body: `It ended at ${minute(data.endedAt)}, so your bots are stopped. They start again on their own when you renew.`,
        }
        case "purchase_completed": return {
            title: "Thanks for your purchase",
            body: [
                data.codes ? `${count(data.codes, "single-use code")} ${data.codes === 1 ? "is" : "are"} ready to share.` : "The time is added to your plan.",
                data.points ? `You earned ${count(data.points, "point")}.` : "",
            ].filter(Boolean).join(" "),
        }
    }
}
