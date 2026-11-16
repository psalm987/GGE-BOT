import { centrifugoOutbox } from "./schema.ts"
import type { Db } from "./index.ts"

export type OutboxMessage = { channel: string; data: unknown }

/**
 * Queues messages for Centrifugo to deliver to a channel's subscribers once the transaction commits.
 * Pass the transaction that changed the data, so a message is sent exactly when its change is saved.
 */
export async function publishMany(tx: Pick<Db, "insert">, messages: OutboxMessage[]) {
    if (messages.length)
        await tx.insert(centrifugoOutbox).values(messages.map(payload => ({ method: "publish", payload })))
}

export const publish = (tx: Pick<Db, "insert">, channel: string, data: unknown) => publishMany(tx, [{ channel, data }])

/**
 * Closes every live connection the user has open. 3014 makes each client drop its token and
 * reconnect with a new one, which only a session that is still signed in can get.
 */
export const disconnectUser = (tx: Pick<Db, "insert">, userId: string) =>
    tx.insert(centrifugoOutbox).values({ method: "disconnect", payload: { user: userId, disconnect: { code: 3014, reason: "session ended" } } })
