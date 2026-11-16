import type { Notification, NotificationEvent } from "@gge/contracts"

/** One fetched page. `unread` counts every unread notification the player has, loaded or not. */
export type NotificationPage = { items: Notification[]; unread: number }
/** The loaded pages, newest first. The first page's `unread` is the count the bell shows. */
export type NotificationPages = { pages: NotificationPage[]; pageParams: unknown[] }

export const unreadCount = (loaded: NotificationPages | undefined) => loaded?.pages[0]?.unread ?? 0

/**
 * The loaded notifications after one live event. Applying an event twice changes nothing the second time,
 * so a tab can apply its own change at once and again when the server announces it.
 */
export function applyNotificationEvent<T extends NotificationPages>(loaded: T | undefined, event: NotificationEvent, now = new Date()): T | undefined {
    const first = loaded?.pages[0]
    if (!loaded || !first)
        return loaded
    const items = loaded.pages.flatMap(page => page.items)
    const withUnread = (pages: NotificationPage[], unread: number): T => ({ ...loaded, pages: pages.map((page, i) => i === 0 ? { ...page, unread } : page) })
    const markRead = (isRead: (id: number) => boolean) =>
        loaded.pages.map(page => ({ ...page, items: page.items.map(n => n.readAt || !isRead(n.id) ? n : { ...n, readAt: now }) }))

    if (event.kind === "notification") {
        if (items.some(n => n.id === event.notification.id))
            return loaded
        const [, ...rest] = loaded.pages
        return withUnread([{ ...first, items: [event.notification, ...first.items] }, ...rest], first.unread + (event.notification.readAt ? 0 : 1))
    }
    if ("all" in event)
        return withUnread(markRead(() => true), 0)
    const ids = new Set(event.ids)
    // An id that isn't loaded was unread until this event, which is the only reason the server names it.
    const alreadyRead = items.filter(n => ids.has(n.id) && n.readAt).length
    return withUnread(markRead(id => ids.has(id)), Math.max(0, first.unread - (ids.size - alreadyRead)))
}
