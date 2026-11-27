import * as z from "zod"
import type { Translate } from "@gge/i18n"
import { PluginFinishReason } from "./worker-messages.ts"

export type { Translate }

/** A date that may have travelled as JSON, where it is an ISO string. */
export const WireDate = z.union([z.date(), z.iso.datetime().pipe(z.coerce.date())])

/** Why a bot stopped in a way only its owner can undo, news about the owner's plan, or what Auto Station saw and did. */
export const NotificationKind = z.enum([
    "banned", "auth_failed", "crash_loop", "shutoff", "trial_started", "plan_expiring", "plan_expired", "purchase_completed", "incoming_attack", "station_result",
    "plugin_finished",
])
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

/** A name from the game, such as a castle's or a player's. */
const gameName = z.string().max(100)
/** What Auto Station did about an attack: moved the troops to an alliance castle, opened the gates, or neither. */
export const StationOutcome = z.enum(["stationed", "gates_opened", "unprotected"])

/** The details of each kind a running bot raises itself. The runner adds the account snapshot. */
const botNoticeData = {
    /** A player is attacking one of the account's castles; `arrival` is when it lands. */
    incoming_attack: { attacker: gameName, castle: gameName, arrival: z.iso.datetime() },
    /** `destination` is where the troops went, `rubies` what opening the gates cost. Rows from before either existed read without them. */
    station_result: { castle: gameName, outcome: StationOutcome, destination: gameName.nullish(), rubies: z.number().int().nullish() },
}

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
    aboutAccount("incoming_attack", botNoticeData.incoming_attack),
    aboutAccount("station_result", botNoticeData.station_result),
    /** An event plugin switched itself off in the account's settings; `plugin` is its key. */
    aboutAccount("plugin_finished", { plugin: z.string().max(64), reason: PluginFinishReason }),
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
const [banned, authFailed, crashLoop, shutoff, trialStarted, planExpiring, planExpired, purchaseCompleted, incomingAttack, stationResult, pluginFinished] = contents
export const Notification = z.discriminatedUnion("kind", [
    banned.extend(delivery), authFailed.extend(delivery), crashLoop.extend(delivery), shutoff.extend(delivery),
    trialStarted.extend(delivery), planExpiring.extend(delivery), planExpired.extend(delivery), purchaseCompleted.extend(delivery),
    incomingAttack.extend(delivery), stationResult.extend(delivery), pluginFinished.extend(delivery),
])
export type Notification = z.infer<typeof Notification>

/**
 * A notification a running bot asks for through its Notify action. `key` names the one event it is about, so the
 * runner records each event once.
 */
export const BotNotice = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("incoming_attack"), key: z.string().min(1).max(100), data: z.object(botNoticeData.incoming_attack) }),
    z.object({ kind: z.literal("station_result"), key: z.string().min(1).max(100), data: z.object(botNoticeData.station_result) }),
])
export type BotNotice = z.infer<typeof BotNotice>

export const EmailState = z.enum(["pending", "sent", "skipped", "failed"])
export type EmailState = z.infer<typeof EmailState>

/** Which kinds are also emailed. */
export const NotificationPrefs = z.object({
    banned: z.boolean(), auth_failed: z.boolean(), crash_loop: z.boolean(), shutoff: z.boolean(),
    trial_started: z.boolean(), plan_expiring: z.boolean(), plan_expired: z.boolean(), purchase_completed: z.boolean(),
    incoming_attack: z.boolean(), station_result: z.boolean(), plugin_finished: z.boolean(),
})
export type NotificationPrefs = z.infer<typeof NotificationPrefs>
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
    banned: true, auth_failed: true, crash_loop: true, shutoff: false,
    trial_started: true, plan_expiring: true, plan_expired: true, purchase_completed: true,
    // Attacks can come many times a day, so these stay under the bell unless the player asks.
    incoming_attack: false, station_result: false,
    plugin_finished: false,
}

/** The stored preferences with the default for every kind the player never chose. */
export const notificationPrefs = (stored: unknown): NotificationPrefs =>
    ({ ...DEFAULT_NOTIFICATION_PREFS, ...NotificationPrefs.partial().catch({}).parse(stored) })

/** One notification in words, for the bell and the email. `t` is any translator, so the caller picks the language; texts live in the `notifications` namespace. */
export function notificationText(translate: Translate, { kind, data }: NotificationContent): { title: string; body: string } {
    const t = (key: string, options?: Record<string, unknown>) => translate(key, { ns: "notifications", ...options })
    switch (kind) {
        case "banned": return {
            title: t("banned.title", { accountName: data.accountName }),
            body: data.bannedUntil ? t("banned.body", { until: data.bannedUntil }) : t("banned.bodyUnknownEnd"),
        }
        case "auth_failed": return { title: t("auth_failed.title", { accountName: data.accountName }), body: t("auth_failed.body") }
        case "crash_loop": return {
            title: t("crash_loop.title", { accountName: data.accountName }),
            body: t("crash_loop.body", { count: data.failures, lastError: data.lastError }),
        }
        case "shutoff": return { title: t("shutoff.title", { accountName: data.accountName }), body: t("shutoff.body") }
        case "trial_started": return { title: t("trial_started.title"), body: t("trial_started.body", { endsAt: data.endsAt }) }
        case "plan_expiring": return {
            title: t("plan_expiring.title", { count: data.daysLeft }),
            body: t("plan_expiring.body", { endsAt: data.endsAt }),
        }
        case "plan_expired": return { title: t("plan_expired.title"), body: t("plan_expired.body", { endedAt: data.endedAt }) }
        case "purchase_completed": return {
            title: t("purchase_completed.title"),
            body: [
                data.codes ? t("purchase_completed.codes", { count: data.codes }) : t("purchase_completed.time"),
                data.points ? t("purchase_completed.points", { count: data.points }) : "",
            ].filter(Boolean).join(" "),
        }
        case "incoming_attack": return {
            title: t("incoming_attack.title", { attacker: data.attacker, castle: data.castle, accountName: data.accountName }),
            body: t("incoming_attack.body", { arrival: data.arrival }),
        }
        case "plugin_finished": return {
            title: t("plugin_finished.title", { plugin: translate(data.plugin, { ns: "bot", defaultValue: data.plugin }), accountName: data.accountName }),
            body: t(`plugin_finished.body.${data.reason}`),
        }
        case "station_result": {
            const where = { castle: data.castle, accountName: data.accountName }
            switch (data.outcome) {
                case "stationed": return {
                    title: t("station_result.stationed.title", where),
                    body: data.destination ? t("station_result.stationed.body", { destination: data.destination }) : t("station_result.stationed.bodyNoDestination"),
                }
                case "gates_opened": return { title: t("station_result.gates_opened.title", where), body: t("station_result.gates_opened.body", { rubies: data.rubies ?? "?" }) }
                case "unprotected": return { title: t("station_result.unprotected.title", where), body: t("station_result.unprotected.body") }
            }
        }
    }
}
