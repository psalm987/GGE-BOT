import { expect, test } from "vitest"
import { UserEvent, type AccountEvent, type PublicAccount } from "@gge/contracts"
import { applyUserEvent } from "../src/account-events.ts"

const account = (id: string, over: Partial<PublicAccount> = {}): PublicAccount => ({
    id, name: "Hero", serverId: 26, desiredState: "stopped", externalEvent: false, plugins: {}, status: null,
    createdAt: new Date(0), isTwin: false, entitled: true, ...over,
})
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
/** An event as it arrives off the socket: JSON, parsed the way the app parses it. */
const fromWire = (event: object) => UserEvent.parse(JSON.parse(JSON.stringify({ v: 1, ...event }))) as AccountEvent

test("a status event replaces that account's status and leaves the others alone", () => {
    const list = [account(A), account(B)]
    const heartbeatAt = new Date("2031-02-03T04:05:06.000Z")

    const next = applyUserEvent(list, fromWire({ kind: "status", accountId: A, status: { actualState: "running", heartbeatAt, lastError: null, bannedUntil: null } }))!

    expect(next[0]!.status).toEqual({ actualState: "running", heartbeatAt, lastError: null, bannedUntil: null })
    expect(next[0]!.desiredState).toBe("stopped")
    expect(next[1]).toBe(list[1])
})

test("an account event changes only whether the account should run", () => {
    const status = { actualState: "running" as const, heartbeatAt: new Date(1), lastError: null, bannedUntil: null }
    const list = [account(A, { desiredState: "running", status })]

    const [next] = applyUserEvent(list, fromWire({ kind: "account", accountId: A, desiredState: "stopped" }))!

    expect(next).toEqual({ ...list[0], desiredState: "stopped" })
})

test("an event for an account that isn't listed changes nothing", () => {
    const list = [account(A)]
    expect(applyUserEvent(list, fromWire({ kind: "account", accountId: B, desiredState: "running" }))).toEqual(list)
})

test("with no list loaded yet there is nothing to patch", () => {
    expect(applyUserEvent(undefined, fromWire({ kind: "account", accountId: A, desiredState: "running" }))).toBeUndefined()
})
