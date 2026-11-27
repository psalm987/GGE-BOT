import { describe, expect, test } from "vitest"
import { notificationPrefs } from "../src/notifications.ts"
import { BotChannelEvent, UserEvent, botChannel, userChannel } from "../src/realtime.ts"

const accountId = "7f6fd670-065e-4904-ac1f-4182677aa76b"
/** What a subscriber gets: the event after a trip through JSON. */
const overTheWire = (event: unknown) => JSON.parse(JSON.stringify(event)) as unknown

describe("realtime channels", () => {
    test("a player's channel ends in '#' and their id, which is how Centrifugo limits it to them", () => {
        expect(userChannel("u1")).toBe("personal:user#u1")
        expect(botChannel(accountId)).toBe(`bot:${accountId}`)
    })
})

describe("realtime events", () => {
    test("a status event read off the wire has real dates again", () => {
        const heartbeatAt = new Date("2031-02-03T04:05:06.789Z")
        const event = { v: 1, kind: "status", accountId, status: { actualState: "running", heartbeatAt, lastError: null, bannedUntil: null, pluginStates: {}, castles: [], commanders: null, gamePresets: [], resources: null, readBack: null, bladeCoast: null, session: null } }
        expect(UserEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("a status event's figures get a real report time again", () => {
        const reportedAt = new Date("2031-02-03T04:05:06.789Z")
        const resources = { food: 1, mead: null, cash: 2, gold: null, aquamarine: 3, attackDailyCount: 4, reportedAt }
        const event = { v: 1, kind: "status", accountId, status: { actualState: "running", heartbeatAt: null, lastError: null, bannedUntil: null, pluginStates: {}, castles: [], commanders: null, gamePresets: [], resources, readBack: null, bladeCoast: null, session: null } }
        expect(UserEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("a log event keeps its parts", () => {
        const event = { v: 1, kind: "log", accountId, line: { id: 7, ts: new Date("2031-02-03T04:05:06.000Z"), level: 1, message: "a 3", parts: ["a", " ", 3], plugin: null } }
        expect(BotChannelEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("a log event keeps the plugin that wrote it", () => {
        const event = { v: 1, kind: "log", accountId, line: { id: 8, ts: new Date("2031-02-03T04:05:06.000Z"), level: 0, message: "[t] [attack] hi", parts: ["[t] ", "[", "attack", "] ", "hi"], plugin: "attack" } }
        expect(BotChannelEvent.parse(overTheWire(event))).toEqual(event)
    })
    test("a log event from a runner that predates the plugin field still parses, with no plugin", () => {
        const line = { id: 9, ts: new Date("2031-02-03T04:05:06.000Z"), level: 0, message: "hi", parts: ["hi"] }
        expect(BotChannelEvent.parse(overTheWire({ v: 1, kind: "log", accountId, line }))).toEqual({ v: 1, kind: "log", accountId, line: { ...line, plugin: null } })
    })

    test("an event from a newer version or of an unknown kind is refused, not misread", () => {
        expect(UserEvent.safeParse({ v: 2, kind: "account", accountId, desiredState: "stopped" }).success).toBe(false)
        expect(UserEvent.safeParse({ v: 1, kind: "notification", accountId }).success).toBe(false)
        expect(UserEvent.safeParse({ v: 1, kind: "status", accountId, status: { actualState: "running", heartbeatAt: "yesterday", lastError: null, bannedUntil: null } }).success).toBe(false)
    })
})

describe("notification events", () => {
    const notification = {
        id: 4, kind: "banned", accountId, createdAt: new Date("2031-02-03T04:05:06.000Z"), readAt: null,
        data: { accountName: "Hero", serverLabel: "India 1", bannedUntil: "2031-03-01T00:00:00.000Z" },
    }

    test("a notification read off the wire has real dates and keeps the account's snapshot", () => {
        const event = { v: 1, kind: "notification", notification }
        expect(UserEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("a notification for a removed account is still readable", () => {
        const event = { v: 1, kind: "notification", notification: { ...notification, accountId: null } }
        expect(UserEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("each kind must carry its own details", () => {
        const crashLoop = { ...notification, kind: "crash_loop" }
        expect(UserEvent.safeParse({ v: 1, kind: "notification", notification: crashLoop }).success).toBe(false)
        expect(UserEvent.safeParse({ v: 1, kind: "notification", notification: { ...crashLoop, data: { accountName: "Hero", serverLabel: "India 1", failures: 8, lastError: "boom" } } }).success).toBe(true)
    })

    test("marking read names some notifications or all of them, never neither", () => {
        expect(UserEvent.parse({ v: 1, kind: "notifications_read", ids: [4, 5] })).toEqual({ v: 1, kind: "notifications_read", ids: [4, 5] })
        expect(UserEvent.parse({ v: 1, kind: "notifications_read", all: true })).toEqual({ v: 1, kind: "notifications_read", all: true })
        expect(UserEvent.safeParse({ v: 1, kind: "notifications_read" }).success).toBe(false)
        expect(UserEvent.safeParse({ v: 1, kind: "notifications_read", ids: [] }).success).toBe(false)
    })
})

describe("email preferences", () => {
    const plan = { trial_started: true, plan_expiring: true, plan_expired: true, purchase_completed: true, incoming_attack: false, station_result: false, plugin_finished: false }

    test("a kind the player never chose takes its default: shutoff, Auto Station and finished-plugin emails start off, the rest on", () => {
        expect(notificationPrefs({})).toEqual({ banned: true, auth_failed: true, crash_loop: true, shutoff: false, ...plan })
        expect(notificationPrefs({ banned: false, shutoff: true })).toEqual({ banned: false, auth_failed: true, crash_loop: true, shutoff: true, ...plan })
    })

    test("preferences stored before the plan kinds existed get those kinds on", () => {
        expect(notificationPrefs({ banned: true, auth_failed: false, crash_loop: true, shutoff: true }))
            .toEqual({ banned: true, auth_failed: false, crash_loop: true, shutoff: true, ...plan })
    })

    test("preferences stored before the Auto Station kinds existed get those kinds off, since attacks can come often", () => {
        const stored = { banned: false, auth_failed: true, crash_loop: true, shutoff: true, trial_started: false, plan_expiring: true, plan_expired: true, purchase_completed: true }
        expect(notificationPrefs(stored)).toEqual({ ...stored, incoming_attack: false, station_result: false, plugin_finished: false })
    })

    test("a stored value that isn't preferences falls back to the defaults", () => {
        expect(notificationPrefs("nonsense")).toEqual({ banned: true, auth_failed: true, crash_loop: true, shutoff: false, ...plan })
    })
})
