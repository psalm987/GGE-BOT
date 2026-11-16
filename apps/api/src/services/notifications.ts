import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { notificationPrefs, userChannel, type NotificationPrefs, type UserEvent } from "@gge/contracts"
import { notifications, publish, toNotification, users, type Db } from "@gge/db"

export async function listNotifications(db: Db, userId: string, { before, limit }: { before?: number; limit: number }) {
    const rows = await db.select().from(notifications)
        .where(and(eq(notifications.userId, userId), before ? lt(notifications.id, before) : undefined))
        .orderBy(desc(notifications.id)).limit(limit)
    const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` }).from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))) as [{ unread: number }]
    return { items: rows.map(toNotification), unread }
}

/** Marks the caller's unread notifications read and tells their other tabs. Ids that aren't theirs, or are already read, change nothing. */
export async function markNotificationsRead(db: Db, userId: string, which: { ids: number[] } | { all: true }) {
    await db.transaction(async tx => {
        const changed = await tx.update(notifications).set({ readAt: new Date() })
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), "ids" in which ? inArray(notifications.id, which.ids) : undefined))
            .returning({ id: notifications.id })
        if (!changed.length)
            return
        const read = "ids" in which ? { ids: changed.map(row => row.id) } : { all: true as const }
        await publish(tx, userChannel(userId), { v: 1, kind: "notifications_read", ...read } satisfies UserEvent)
    })
}

export async function getNotificationPrefs(db: Db, userId: string) {
    const [user] = await db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId))
    return notificationPrefs(user?.prefs)
}

export async function setNotificationPrefs(db: Db, userId: string, prefs: NotificationPrefs) {
    await db.update(users).set({ notificationPrefs: prefs, updatedAt: new Date() }).where(eq(users.id, userId))
}
