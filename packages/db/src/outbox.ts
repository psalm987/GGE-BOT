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
