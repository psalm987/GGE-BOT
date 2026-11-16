import { Notification, userChannel, type NotificationContent, type UserEvent } from "@gge/contracts"
import { publish } from "./outbox.ts"
import { notifications } from "./schema.ts"
import type { Db } from "./index.ts"

export type NewNotification = NotificationContent & {
    userId: string
    accountId: string
    /** Names the one event this is about. A second insert with the same key for the same user does nothing. */
    dedupKey: string
}

/** A stored row as the player sees it. */
export const toNotification = (row: typeof notifications.$inferSelect): Notification =>
    Notification.parse({ id: row.id, kind: row.kind, data: row.data, accountId: row.accountId, createdAt: row.createdAt, readAt: row.readAt })

/**
 * Records a notification and tells the owner's open tabs, both when the transaction commits.
 * Returns undefined, and tells nobody, when this event was already recorded.
 */
export async function insertNotification(tx: Pick<Db, "insert">, { userId, accountId, dedupKey, kind, data }: NewNotification) {
    const [row] = await tx.insert(notifications).values({ userId, accountId, dedupKey, kind, data })
        .onConflictDoNothing({ target: [notifications.userId, notifications.dedupKey] }).returning()
    if (!row)
        return undefined
    const notification = toNotification(row)
    await publish(tx, userChannel(userId), { v: 1, kind: "notification", notification } satisfies UserEvent)
    return notification
}
