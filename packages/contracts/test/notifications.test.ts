import { describe, expect, test } from "vitest"
import { createServerI18n, serverT } from "@gge/i18n/server"
import { BotNotice, NOTIFICATION_KINDS, Notification, notificationText, type NotificationContent } from "../src/notifications.ts"

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

    test.each([
        ["incoming_attack", { accountName: "Hero", serverLabel: "India 1", attacker: "Raider", castle: "Hero's Keep", arrival: "2031-02-03T05:00:00.000Z" }],
        ["station_result", { accountName: "Hero", serverLabel: "India 1", castle: "Hero's Keep", outcome: "stationed", destination: "Ally's Keep (310:402)", rubies: null }],
    ])("an Auto Station %s row reads with its account and after the account is removed", (kind, data) => {
        expect(Notification.parse({ ...delivery, kind, accountId, data })).toMatchObject({ kind, accountId, data })
        expect(Notification.parse({ ...delivery, kind, accountId: null, data })).toMatchObject({ kind, data })
    })

    test("a station_result row stored without the details a later version adds still reads", () => {
        const data = { accountName: "Hero", serverLabel: "India 1", castle: "Hero's Keep", outcome: "unprotected" }
        expect(Notification.parse({ ...delivery, kind: "station_result", accountId, data })).toMatchObject({ data })
        expect(Notification.safeParse({ ...delivery, kind: "station_result", accountId, data: { ...data, outcome: "teleported" } }).success).toBe(false)
        expect(Notification.safeParse({ ...delivery, kind: "incoming_attack", accountId, data: { accountName: "Hero", serverLabel: "India 1", attacker: "Raider", castle: "Keep", arrival: "soon" } }).success).toBe(false)
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
    incoming_attack: { kind: "incoming_attack", data: { ...snapshot, attacker: "Raider", castle: "Alpha Keep", arrival: at } },
    station_result: { kind: "station_result", data: { ...snapshot, castle: "Alpha Keep", outcome: "stationed", destination: "Ally Keep (310:402)", rubies: null } },
    plugin_finished: { kind: "plugin_finished", data: { ...snapshot, plugin: "bladeCoast", reason: "done" } },
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

    test("an incoming attack says who attacks which castle of which account, and when it lands", () => {
        expect(notificationText(en, everyKind.incoming_attack)).toEqual({
            title: "Raider is attacking Alpha Keep on Alpha",
            body: "The attack lands at Dec 8, 2026, 01:00 AM UTC. Auto Station moves the troops out just before.",
        })
    })

    test("a station result says where the troops went, or what happened instead", () => {
        expect(notificationText(en, everyKind.station_result)).toEqual({
            title: "Troops left Alpha Keep on Alpha before the attack",
            body: "They are stationed at Ally Keep (310:402) and come home once the attack has landed.",
        })
        const gates = notificationText(en, { kind: "station_result", data: { ...snapshot, castle: "Alpha Keep", outcome: "gates_opened", destination: null, rubies: 450 } })
        expect(gates).toEqual({ title: "Gates opened at Alpha Keep on Alpha", body: "No alliance castle could take the troops, so the gates were opened for 450 rubies." })
        const exposed = notificationText(en, { kind: "station_result", data: { ...snapshot, castle: "Alpha Keep", outcome: "unprotected" } })
        expect(exposed.title).toBe("Auto Station couldn't move the troops out of Alpha Keep on Alpha")
        expect(exposed.body).toBe("No alliance castle could take them and the gates stayed shut. The logs say why.")
    })

    test("a plugin that switched itself off says which, on which account, and why", () => {
        const names = createServerI18n({ en: { bot: { bladeCoast: "Blade Coast" } } })
        const named = (key: string, options?: Record<string, unknown>) => options?.ns === "bot" ? names.getFixedT("en")(key, options) : en(key, options)
        expect(notificationText(named as typeof en, everyKind.plugin_finished)).toEqual({
            title: "Blade Coast switched off on Alpha",
            body: "It finished everything it can do this event. Switch it on again when the event comes back.",
        })
        expect(notificationText(en, { kind: "plugin_finished", data: { ...snapshot, plugin: "bladeCoast", reason: "eventOver" } })).toEqual({
            title: "bladeCoast switched off on Alpha",
            body: "Its event isn't running. Switch it on again when the event comes back.",
        })
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

describe("notices a running bot raises", () => {
    test("carry a kind, its details without the account snapshot, and a key that names the event", () => {
        const notice = { kind: "incoming_attack", key: "0:1001:42", data: { attacker: "Raider", castle: "Keep", arrival: at } }
        expect(BotNotice.parse(notice)).toEqual(notice)
        expect(BotNotice.parse({ kind: "station_result", key: "0:1001:42", data: { castle: "Keep", outcome: "unprotected", destination: null, rubies: null } }).kind).toBe("station_result")
    })

    test.each([
        ["a kind only the runner raises", { kind: "banned", key: "k", data: { bannedUntil: null } }],
        ["a plan kind", { kind: "plan_expired", key: "k", data: { endedAt: at } }],
        ["no key", { kind: "incoming_attack", data: { attacker: "Raider", castle: "Keep", arrival: at } }],
        ["a key too long to store", { kind: "incoming_attack", key: "k".repeat(200), data: { attacker: "Raider", castle: "Keep", arrival: at } }],
        ["a name too long to show", { kind: "incoming_attack", key: "k", data: { attacker: "R".repeat(500), castle: "Keep", arrival: at } }],
    ])("refuse %s", (_, notice) => {
        expect(BotNotice.safeParse(notice).success).toBe(false)
    })
})
