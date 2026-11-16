import { expect, test } from "vitest"
import { UserEvent, type Notification, type NotificationEvent } from "@gge/contracts"
import { applyNotificationEvent, unreadCount, type NotificationPages } from "../src/notification-events.ts"

const ACCOUNT = "11111111-1111-4111-8111-111111111111"
const NOW = new Date("2031-02-03T04:05:06.000Z")
const EARLIER = new Date("2031-02-01T00:00:00.000Z")

const note = (id: number, readAt: Date | null = null): Notification => ({
    id, kind: "banned", accountId: ACCOUNT, createdAt: EARLIER, readAt,
    data: { accountName: `Hero ${id}`, serverLabel: "India 1", bannedUntil: null },
})
/** Loaded pages, newest first, as the bell's query holds them. */
const loaded = (unread: number, ...pages: Notification[][]): NotificationPages =>
    ({ pages: pages.map(items => ({ items, unread })), pageParams: pages.map((_, i) => i || undefined) })
/** An event as it arrives off the socket: JSON, parsed the way the app parses it. */
const fromWire = (event: object) => UserEvent.parse(JSON.parse(JSON.stringify({ v: 1, ...event }))) as NotificationEvent
const ids = (pages: NotificationPages) => pages.pages.map(page => page.items.map(n => n.id))
const readIds = (pages: NotificationPages) => pages.pages.flatMap(page => page.items).filter(n => n.readAt).map(n => n.id)

test("a new notification goes on top and counts as unread", () => {
    const before = loaded(1, [note(5), note(4, EARLIER)], [note(3, EARLIER)])

    const after = applyNotificationEvent(before, fromWire({ kind: "notification", notification: note(6) }))!

    expect(ids(after)).toEqual([[6, 5, 4], [3]])
    expect(after.pages[0]!.items[0]).toEqual(note(6))
    expect(unreadCount(after)).toBe(2)
    expect(after.pages[1]).toBe(before.pages[1])
    expect(after.pageParams).toBe(before.pageParams)
})

test("a notification that is already loaded isn't added or counted again", () => {
    const before = loaded(1, [note(5)])
    expect(applyNotificationEvent(before, fromWire({ kind: "notification", notification: note(5) }))).toBe(before)
})

test("marking some read stamps them and lowers the count by that many", () => {
    const before = loaded(3, [note(5), note(4)], [note(3)])

    const after = applyNotificationEvent(before, fromWire({ kind: "notifications_read", ids: [5, 3] }), NOW)!

    expect(readIds(after)).toEqual([5, 3])
    expect(after.pages[0]!.items[0]!.readAt).toEqual(NOW)
    expect(unreadCount(after)).toBe(1)
})

test("a read notification that isn't loaded still lowers the count", () => {
    const before = loaded(4, [note(9), note(8)])
    expect(unreadCount(applyNotificationEvent(before, fromWire({ kind: "notifications_read", ids: [2] })))).toBe(3)
})

test("hearing twice that a notification was read counts it once and keeps the first time", () => {
    const event = fromWire({ kind: "notifications_read", ids: [5] })
    const once = applyNotificationEvent(loaded(2, [note(5), note(4)]), event, EARLIER)!

    const twice = applyNotificationEvent(once, event, NOW)!

    expect(unreadCount(twice)).toBe(1)
    expect(twice.pages[0]!.items[0]!.readAt).toEqual(EARLIER)
})

test("marking all read stamps every loaded one and clears the count", () => {
    const before = loaded(7, [note(5), note(4, EARLIER)], [note(3)])

    const after = applyNotificationEvent(before, fromWire({ kind: "notifications_read", all: true }), NOW)!

    expect(readIds(after)).toEqual([5, 4, 3])
    expect(after.pages[0]!.items[1]!.readAt).toEqual(EARLIER)
    expect(unreadCount(after)).toBe(0)
})

test("the count never goes below zero", () => {
    expect(unreadCount(applyNotificationEvent(loaded(0, [note(5)]), fromWire({ kind: "notifications_read", ids: [1, 2] })))).toBe(0)
})

test("with nothing loaded yet there is nothing to patch", () => {
    expect(applyNotificationEvent(undefined, fromWire({ kind: "notification", notification: note(6) }))).toBeUndefined()
    expect(unreadCount(undefined)).toBe(0)
})
