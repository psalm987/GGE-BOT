import { describe, expect, test } from "vitest"
import { createServerI18n, serverT } from "@gge/i18n/server"
import { NOTIFICATION_KINDS, Notification, notificationText, type NotificationContent } from "../src/notifications.ts"

const delivery = { id: 9, createdAt: "2031-02-03T04:05:06.000Z", readAt: null }
const accountId = "7f6fd670-065e-4904-ac1f-4182677aa76b"

describe("stored notifications", () => {
    test.each([
        ["banned", { accountName: "Hero", serverLabel: "India 1", bannedUntil: "2031-03-01T00:00:00.000Z" }],
        ["auth_failed", { accountName: "Hero", serverLabel: "India 1", lastError: "INVALID_PASSWORD" }],
        ["crash_loop", { accountName: "Hero", serverLabel: "India 1", failures: 8, lastError: "boom" }],
        ["shutoff", { accountName: "Hero", serverLabel: "India 1" }],
    ])("a %s row stored before plan notifications existed still reads", (kind, data) => {
        expect(Notification.parse({ ...delivery, kind, accountId, data })).toMatchObject({ kind, accountId, data })
        expect(Notification.parse({ ...delivery, kind, accountId: null, data }), "its account removed").toMatchObject({ kind, data })
    })

    test("a bot notification still needs its account's snapshot", () => {
        expect(Notification.safeParse({ ...delivery, kind: "shutoff", accountId, data: {} }).success).toBe(false)
        expect(Notification.safeParse({ ...delivery, kind: "banned", accountId, data: { accountName: "Hero", bannedUntil: null } }).success).toBe(false)
    })

    test.each([
        ["trial_started", { endsAt: "2031-02-10T09:30:00.000Z" }],
        ["plan_expiring", { endsAt: "2031-02-10T09:30:00.000Z", daysLeft: 7 }],
        ["plan_expired", { endedAt: "2031-02-10T09:30:00.000Z" }],
        ["purchase_completed", { packageId: "team5_28", seats: 5, points: 5, codes: 5 }],
    ])("a %s notification reads with no account", (kind, data) => {
        expect(Notification.parse({ ...delivery, kind, accountId: null, data })).toEqual({ ...delivery, createdAt: new Date(delivery.createdAt), kind, accountId: null, data })
    })

    test("a plan notification must carry its own details", () => {
        expect(Notification.safeParse({ ...delivery, kind: "plan_expiring", accountId: null, data: { endsAt: "2031-02-10T09:30:00.000Z" } }).success).toBe(false)
        expect(Notification.safeParse({ ...delivery, kind: "plan_expired", accountId: null, data: { endedAt: "next week" } }).success).toBe(false)
    })
})

const at = "2026-12-08T01:00:00.000Z"
const snapshot = { accountName: "Alpha", serverLabel: "Germany 1" }
const en = serverT("en")

const everyKind: Record<NotificationContent["kind"], NotificationContent> = {
    banned: { kind: "banned", data: { ...snapshot, bannedUntil: at } },
    auth_failed: { kind: "auth_failed", data: { ...snapshot, lastError: null } },
    crash_loop: { kind: "crash_loop", data: { ...snapshot, failures: 5, lastError: "boom" } },
    shutoff: { kind: "shutoff", data: snapshot },
    trial_started: { kind: "trial_started", data: { endsAt: at } },
    plan_expiring: { kind: "plan_expiring", data: { endsAt: at, daysLeft: 7 } },
    plan_expired: { kind: "plan_expired", data: { endedAt: at } },
    purchase_completed: { kind: "purchase_completed", data: { packageId: "team5_28", seats: 5, points: 5, codes: 5 } },
}

describe("notificationText", () => {
    test.each(NOTIFICATION_KINDS)("%s has a title and a body in English", kind => {
        const { title, body } = notificationText(en, everyKind[kind])
        expect(title).toBeTruthy()
        expect(body).toBeTruthy()
        expect(`${title} ${body}`).not.toMatch(/\{\{|undefined|NaN/)
    })

    test("a bot notification names the account and says what happened", () => {
        expect(notificationText(en, everyKind.banned)).toEqual({
            title: "Alpha was banned",
            body: "The game banned this account until Dec 8, 2026, 01:00 AM UTC. Its bot is stopped.",
        })
        expect(notificationText(en, { kind: "banned", data: { ...snapshot, bannedUntil: null } }).body).toBe("The game banned this account. Its bot is stopped.")
        expect(notificationText(en, everyKind.crash_loop).body).toBe("It failed 5 times in a row and won't restart on its own. Last error: boom")
    })

    test("a plan notification reads without an account snapshot, as rows written before the snapshot was optional do", () => {
        expect(notificationText(en, everyKind.trial_started)).toEqual({
            title: "Your free trial has started",
            body: "Your bots can run on the Basic plan until Dec 8, 2026, 01:00 AM UTC.",
        })
        expect(notificationText(en, { kind: "plan_expiring", data: { endsAt: at, daysLeft: 1 } }).title).toBe("Your plan ends in 1 day")
        expect(notificationText(en, everyKind.plan_expiring).title).toBe("Your plan ends in 7 days")
        expect(notificationText(en, everyKind.plan_expired).body).toBe("It ended at Dec 8, 2026, 01:00 AM UTC, so your bots are stopped. They start again on their own when you renew.")
    })

    test("a purchase says what it gave", () => {
        expect(notificationText(en, everyKind.purchase_completed).body).toBe("5 single-use codes are ready to share. You earned 5 points.")
        expect(notificationText(en, { kind: "purchase_completed", data: { packageId: "basic_28", seats: 1, points: 1, codes: 0 } }).body).toBe("The time is added to your plan. You earned 1 point.")
        expect(notificationText(en, { kind: "purchase_completed", data: { packageId: "basic_28", seats: 1, points: 0, codes: 0 } }).body).toBe("The time is added to your plan.")
    })

    test("reads in the player's language, with dates in its own format and English where a text is missing", () => {
        const i18n = createServerI18n({
            en: { notifications: { "shutoff.title": "{{accountName}} was stopped", "shutoff.body": "Start it again.", "plan_expired.title": "Your plan has ended", "plan_expired.body": "It ended at {{endedAt, when}}." } },
            it: { notifications: { "shutoff.title": "{{accountName}} è stato fermato" } },
        })
        const it = i18n.getFixedT("it") as unknown as typeof en
        expect(notificationText(it, everyKind.shutoff)).toEqual({ title: "Alpha è stato fermato", body: "Start it again." })
        expect(notificationText(it, everyKind.plan_expired).body).toBe("It ended at 8 dic 2026, 01:00 UTC.")
    })
})
