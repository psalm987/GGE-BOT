import * as z from "zod"
import { Notification, WireDate } from "./notifications.ts"
import { BotStatus, DesiredState, LogLine } from "./schemas.ts"

/** Everything about one player's accounts. Centrifugo lets only the user named after "#" subscribe. */
export const userChannel = (userId: string) => `personal:user#${userId}`
/** One account's log lines. Subscribing needs a token from realtime.subscriptionToken. */
export const botChannel = (accountId: string) => `bot:${accountId}`

export const RealtimeToken = z.object({ token: z.string() })

const WireStatus = BotStatus.extend({ heartbeatAt: WireDate.nullable(), bannedUntil: WireDate.nullable() })

const READ_IDS = { ids: z.array(z.number().int()).min(1).max(200) }
const READ_ALL = { all: z.literal(true) }
/** The notifications to mark read: some by id, or every one the player has. */
export const NotificationsRead = z.union([z.object(READ_IDS), z.object(READ_ALL)])

const notificationsRead = <S extends z.ZodRawShape>(which: S) =>
    z.object({ v: z.literal(1), kind: z.literal("notifications_read"), ...which })

/**
 * Published on userChannel. Events travel as JSON, so a date arrives as an ISO string.
 * `status` carries the same fields as PublicAccount.status, so a client can replace it without refetching.
 * `notifications_read` names only notifications that were unread until then.
 */
export const UserEvent = z.union([
    z.discriminatedUnion("kind", [
        z.object({ v: z.literal(1), kind: z.literal("status"), accountId: z.uuid(), status: WireStatus }),
        z.object({ v: z.literal(1), kind: z.literal("account"), accountId: z.uuid(), desiredState: DesiredState }),
        z.object({ v: z.literal(1), kind: z.literal("notification"), notification: Notification }),
        /** Something the banners show changed for this player, such as their plan or limit: refetch alerts.list. */
        z.object({ v: z.literal(1), kind: z.literal("alerts") }),
    ]),
    notificationsRead(READ_IDS),
    notificationsRead(READ_ALL),
])
export type UserEvent = z.infer<typeof UserEvent>
/** The events about one account's state. */
export type AccountEvent = Extract<UserEvent, { kind: "status" | "account" }>
/** The events about the player's notifications. */
export type NotificationEvent = Extract<UserEvent, { kind: "notification" | "notifications_read" }>

/** Published on botChannel. */
export const BotChannelEvent = z.object({
    v: z.literal(1),
    kind: z.literal("log"),
    accountId: z.uuid(),
    line: LogLine.extend({ ts: WireDate }),
})
export type BotChannelEvent = z.infer<typeof BotChannelEvent>
