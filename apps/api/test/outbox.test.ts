import { asc, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { UserEvent, userChannel } from "@gge/contracts"
import { centrifugoOutbox } from "@gge/db"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
})
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const newAccount = (name: string) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })
const idOf = async (p: Awaited<ReturnType<Api["player"]>>) => (await p.api.auth.me())!.id

/** The account events Centrifugo would deliver on a player's channel, oldest first. Banner refreshes are left out. */
async function accountEvents(userId: string) {
    const rows = await api.db.select().from(centrifugoOutbox)
        .where(sql`${centrifugoOutbox.method} = 'publish' and ${centrifugoOutbox.payload}->>'channel' = ${userChannel(userId)}`)
        .orderBy(asc(centrifugoOutbox.id))
    return rows.map(r => UserEvent.parse((r.payload as { data: unknown }).data)).filter(e => e.kind !== "alerts")
}
const mentions = async (id: string) =>
    (await api.db.select().from(centrifugoOutbox).where(sql`${centrifugoOutbox.payload}::text like ${`%${id}%`}`)).length
/** The disconnects queued for a user: what closes their open sockets. */
const disconnects = async (userId: string) =>
    (await api.db.select().from(centrifugoOutbox)
        .where(sql`${centrifugoOutbox.method} = 'disconnect' and ${centrifugoOutbox.payload}->>'user' = ${userId}`))
        .map(r => r.payload)

describe("starting and stopping tells the owner's other tabs", () => {
    test("a player's start and stop are each published to their own channel", async () => {
        const p = await api.player()
        const { id } = await p.api.accounts.create(newAccount("ev-own"))

        await p.api.accounts.setDesiredState({ ids: [id], state: "running" })
        await p.api.accounts.setDesiredState({ ids: [id], state: "stopped" })

        expect(await accountEvents(await idOf(p))).toEqual([
            { v: 1, kind: "account", accountId: id, desiredState: "running" },
            { v: 1, kind: "account", accountId: id, desiredState: "stopped" },
        ])
    })

    test("naming another player's account changes nothing and publishes nothing about it", async () => {
        const alice = await api.player()
        const bob = await api.player()
        const theirs = await bob.api.accounts.create(newAccount("ev-theirs"))

        await alice.api.accounts.setDesiredState({ ids: [theirs.id], state: "running" })
        await alice.api.accounts.setDesiredState({ ids: [theirs.id], state: "stopped" })

        expect(await mentions(theirs.id)).toBe(0)
        expect(await accountEvents(await idOf(alice))).toEqual([])
    })

    test("a start the plan refuses publishes nothing", async () => {
        const p = await api.player()
        const userId = await idOf(p)
        await admin.api.users.setMaxBots({ id: userId, maxBots: 2 })
        const first = await p.api.accounts.create(newAccount("ev-plan-1"))
        const second = await p.api.accounts.create(newAccount("ev-plan-2"))
        await admin.api.users.setMaxBots({ id: userId, maxBots: 1 })

        expect(await codeOf(p.api.accounts.setDesiredState({ ids: [first.id, second.id], state: "running" }))).toBe("FORBIDDEN")

        expect(await accountEvents(userId)).toEqual([])
    })

    test("lowering a plan publishes a stop for each bot it stops, and only those", async () => {
        const p = await api.player()
        const userId = await idOf(p)
        await admin.api.users.setMaxBots({ id: userId, maxBots: 2 })
        const kept = await p.api.accounts.create(newAccount("ev-kept"))
        const cut = await p.api.accounts.create(newAccount("ev-cut"))
        await p.api.accounts.setDesiredState({ ids: [kept.id, cut.id], state: "running" })

        await admin.api.users.setMaxBots({ id: userId, maxBots: 1 })

        expect((await accountEvents(userId)).filter(e => e.kind === "account" && e.desiredState === "stopped"))
            .toEqual([{ v: 1, kind: "account", accountId: cut.id, desiredState: "stopped" }])
    })

    test("an admin's force stop is published to the account's owner, not to the admin", async () => {
        const p = await api.player()
        const { id } = await p.api.accounts.create(newAccount("ev-forced"))
        await p.api.accounts.setDesiredState({ ids: [id], state: "running" })

        await admin.api.accounts.forceStop({ id })

        expect((await accountEvents(await idOf(p))).at(-1)).toEqual({ v: 1, kind: "account", accountId: id, desiredState: "stopped" })
        const boss = (await admin.api.users.list({ search: "boss" })).items[0]!.id
        expect(await accountEvents(boss)).toEqual([])
    })

    test("disabling a player publishes the stop and closes their sockets", async () => {
        const p = await api.player()
        const userId = await idOf(p)
        const { id } = await p.api.accounts.create(newAccount("ev-disabled"))
        await p.api.accounts.setDesiredState({ ids: [id], state: "running" })

        await admin.api.users.setStatus({ id: userId, status: "disabled" })

        expect((await accountEvents(userId)).at(-1)).toEqual({ v: 1, kind: "account", accountId: id, desiredState: "stopped" })
        expect(await disconnects(userId)).toHaveLength(1)
    })
})

describe("ending a session closes the player's sockets", () => {
    const closing = { disconnect: { code: 3014, reason: "session ended" } }

    test("signing out", async () => {
        const p = await api.player()
        const userId = await idOf(p)
        expect(await disconnects(userId)).toEqual([])

        await p.api.auth.logout()

        expect(await disconnects(userId)).toEqual([{ user: userId, ...closing }])
    })

    test("signing out without a session queues nothing", async () => {
        const before = (await api.db.select().from(centrifugoOutbox)).length
        await api.client().api.auth.logout()
        expect((await api.db.select().from(centrifugoOutbox)).length).toBe(before)
    })

    test("an admin revoking the player's sessions", async () => {
        const p = await api.player()
        const userId = await idOf(p)

        await admin.api.users.revokeSessions({ id: userId })

        expect(await disconnects(userId)).toEqual([{ user: userId, ...closing }])
    })

    test("changing the password, which signs out the player's other devices", async () => {
        const p = await api.player()
        const userId = await idOf(p)

        await p.api.account.changePassword({ current: PASSWORD, next: "a much newer password" })

        expect(await disconnects(userId)).toEqual([{ user: userId, ...closing }])
        expect(await p.api.auth.me()).not.toBeNull()
    })

    test("resetting a forgotten password", async () => {
        const p = await api.player()
        const userId = await idOf(p)
        await p.api.auth.requestPasswordReset({ email: p.email })

        const link = await vi.waitFor(() => {
            const mail = api.sent.findLast(m => m.to === p.email && m.tag === "reset_password")
            if (!mail) throw new Error("no mail yet")
            return new URL(mail.text.match(/https?:\/\/\S+/)![0])
        })

        await api.client().api.auth.resetPassword({ token: link.searchParams.get("token")!, password: "a much newer password" })

        expect(await disconnects(userId)).toEqual([{ user: userId, ...closing }])
    })
})
