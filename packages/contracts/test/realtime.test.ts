import { describe, expect, test } from "vitest"
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
        const event = { v: 1, kind: "status", accountId, status: { actualState: "running", heartbeatAt, lastError: null, bannedUntil: null } }
        expect(UserEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("a log event keeps its parts", () => {
        const event = { v: 1, kind: "log", accountId, line: { id: 7, ts: new Date("2031-02-03T04:05:06.000Z"), level: 1, message: "a 3", parts: ["a", " ", 3] } }
        expect(BotChannelEvent.parse(overTheWire(event))).toEqual(event)
    })

    test("an event from a newer version or of an unknown kind is refused, not misread", () => {
        expect(UserEvent.safeParse({ v: 2, kind: "account", accountId, desiredState: "stopped" }).success).toBe(false)
        expect(UserEvent.safeParse({ v: 1, kind: "notification", accountId }).success).toBe(false)
        expect(UserEvent.safeParse({ v: 1, kind: "status", accountId, status: { actualState: "running", heartbeatAt: "yesterday", lastError: null, bannedUntil: null } }).success).toBe(false)
    })
})
