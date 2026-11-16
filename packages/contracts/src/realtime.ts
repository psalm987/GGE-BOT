import * as z from "zod"
import { BotStatus, DesiredState, LogLine } from "./schemas.ts"

/** Everything about one player's accounts. Centrifugo lets only the user named after "#" subscribe. */
export const userChannel = (userId: string) => `personal:user#${userId}`
/** One account's log lines. Subscribing needs a token from realtime.subscriptionToken. */
export const botChannel = (accountId: string) => `bot:${accountId}`

export const RealtimeToken = z.object({ token: z.string() })

/** Events travel as JSON, so a date arrives as an ISO string. */
const WireDate = z.union([z.date(), z.iso.datetime().pipe(z.coerce.date())])
const WireStatus = BotStatus.extend({ heartbeatAt: WireDate.nullable(), bannedUntil: WireDate.nullable() })

/** Published on userChannel. `status` carries the same fields as PublicAccount.status, so a client can replace it without refetching. */
export const UserEvent = z.discriminatedUnion("kind", [
    z.object({ v: z.literal(1), kind: z.literal("status"), accountId: z.uuid(), status: WireStatus }),
    z.object({ v: z.literal(1), kind: z.literal("account"), accountId: z.uuid(), desiredState: DesiredState }),
])
export type UserEvent = z.infer<typeof UserEvent>

/** Published on botChannel. */
export const BotChannelEvent = z.object({
    v: z.literal(1),
    kind: z.literal("log"),
    accountId: z.uuid(),
    line: LogLine.extend({ ts: WireDate }),
})
export type BotChannelEvent = z.infer<typeof BotChannelEvent>
