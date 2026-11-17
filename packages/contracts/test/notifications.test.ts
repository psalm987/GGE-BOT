import { describe, expect, test } from "vitest"
import { Notification, describeNotification } from "../src/notifications.ts"

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

describe("describeNotification", () => {
    const at = "2031-02-10T09:30:00.000Z"

    test("plan notifications say what happened and when, in UTC", () => {
        expect(describeNotification({ kind: "trial_started", data: { endsAt: at } }))
            .toEqual({ title: "Your free trial has started", body: "Your bots can run on the Basic plan until 2031-02-10 09:30 UTC." })
        expect(describeNotification({ kind: "plan_expiring", data: { endsAt: at, daysLeft: 7 } }))
            .toEqual({ title: "Your plan ends in 7 days", body: "It ends at 2031-02-10 09:30 UTC. Renew before then to keep your bots running." })
        expect(describeNotification({ kind: "plan_expiring", data: { endsAt: at, daysLeft: 1 } }).title).toBe("Your plan ends in 1 day")
        expect(describeNotification({ kind: "plan_expired", data: { endedAt: at } }))
            .toEqual({ title: "Your plan has ended", body: "It ended at 2031-02-10 09:30 UTC, so your bots are stopped. They start again on their own when you renew." })
    })

    test("a purchase says what it gave", () => {
        expect(describeNotification({ kind: "purchase_completed", data: { packageId: "team5_28", seats: 5, points: 5, codes: 5 } }).body)
            .toBe("5 single-use codes are ready to share. You earned 5 points.")
        expect(describeNotification({ kind: "purchase_completed", data: { packageId: "basic_28", seats: 1, points: 1, codes: 0 } }).body)
            .toBe("The time is added to your plan. You earned 1 point.")
        expect(describeNotification({ kind: "purchase_completed", data: { packageId: "basic_28", seats: 1, points: 0, codes: 0 } }).body)
            .toBe("The time is added to your plan.")
    })
})
