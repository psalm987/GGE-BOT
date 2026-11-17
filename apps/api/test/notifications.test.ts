import { asc, eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { UserEvent, userChannel, type NotificationContent } from "@gge/contracts"
import { centrifugoOutbox, notifications, users } from "@gge/db"
import { CLIENT_ORIGIN, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const codeOf = async (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)

const PLAN_PREFS = { trial_started: true, plan_expiring: true, plan_expired: true, purchase_completed: true }
const DEFAULT_PREFS = { banned: true, auth_failed: true, crash_loop: true, shutoff: false, ...PLAN_PREFS, incoming_attack: false, station_result: false }

const banned = (accountName: string): NotificationContent => ({ kind: "banned", data: { accountName, serverLabel: "India 1", bannedUntil: null } })
const shutoff = (accountName: string): NotificationContent => ({ kind: "shutoff", data: { accountName, serverLabel: "India 1" } })

let counter = 0
/** A notification as the runner would have left it `ageSeconds` ago. */
async function notify(userId: string, content: NotificationContent, { ageSeconds = 60, ...columns }: { ageSeconds?: number } & Partial<typeof notifications.$inferInsert> = {}) {
    const [row] = await api.db.insert(notifications).values({
        userId, ...content, dedupKey: `test:${++counter}`, createdAt: sql`now() - make_interval(secs => ${ageSeconds})`, ...columns,
    }).returning()
    return row!.id
}
const row = async (id: number) => (await api.db.select().from(notifications).where(eq(notifications.id, id)))[0]!
const digestsTo = (email: string) => api.sent.filter(m => m.to === email && m.tag === "bot_alerts")

/** A signed-in player with a confirmed email, and their id. */
async function player() {
    const p = await api.player()
    return { ...p, id: (await p.api.auth.me())!.id }
}

/** What Centrifugo would deliver to this player, oldest first. */
async function published(userId: string) {
    const rows = await api.db.select().from(centrifugoOutbox)
        .where(sql`${centrifugoOutbox.payload}->>'channel' = ${userChannel(userId)}`).orderBy(asc(centrifugoOutbox.id))
    return rows.map(r => UserEvent.parse((r.payload as { data: unknown }).data))
}

describe("emailing notifications", () => {
    test("two notifications for one player go out as one email that names both accounts and links to the app", async () => {
        const alice = await player()
        const first = await notify(alice.id, banned("Ironhold"))
        const second = await notify(alice.id, { kind: "auth_failed", data: { accountName: "Ravenmoor", serverLabel: "Germany 1", lastError: "INVALID_PASSWORD" } })

        await api.mailTick()

        const [digest, ...more] = digestsTo(alice.email)
        expect(more).toEqual([])
        expect(digest!.subject).toBe("2 of your bots need attention")
        expect(digest!.text).toContain("Ironhold was banned (India 1)")
        expect(digest!.text).toContain("Ravenmoor couldn't sign in (Germany 1)")
        expect(digest!.text).toContain(`${CLIENT_ORIGIN}/`)
        expect(digest!.html).toContain("Ironhold was banned")
        for (const id of [first, second])
            expect(await row(id)).toMatchObject({ emailState: "sent", emailError: null, emailClaimedAt: null, emailedAt: expect.any(Date) })

        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
    })

    test("a single notification's email is titled with what happened", async () => {
        const alice = await player()
        await notify(alice.id, { kind: "crash_loop", data: { accountName: "Emberfall", serverLabel: "India 1", failures: 8, lastError: "boom" } })
        await api.mailTick()
        expect(digestsTo(alice.email)).toMatchObject([{ subject: "Emberfall stopped after repeated crashes" }])
        expect(digestsTo(alice.email)[0]!.text).toContain("It failed 8 times in a row")
    })

    test("each player gets their own email", async () => {
        const alice = await player()
        const bob = await player()
        await notify(alice.id, banned("Alpha"))
        await notify(bob.id, banned("Bravo"))
        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
        expect(digestsTo(alice.email)[0]!.text).not.toContain("Bravo")
        expect(digestsTo(bob.email)[0]!.text).toContain("Bravo was banned")
    })

    test("a notification younger than 30 seconds waits for the next round", async () => {
        const alice = await player()
        const id = await notify(alice.id, banned("Ironhold"), { ageSeconds: 20 })

        await api.mailTick()
        expect(digestsTo(alice.email)).toEqual([])
        expect(await row(id)).toMatchObject({ emailState: "pending", emailClaimedAt: null })

        await api.db.update(notifications).set({ createdAt: sql`now() - interval '31 seconds'` }).where(eq(notifications.id, id))
        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
    })

    test("a burst waits for its newest notification to settle, then goes out as one email", async () => {
        const alice = await player()
        await notify(alice.id, banned("Ironhold"), { ageSeconds: 40 })
        const newest = await notify(alice.id, banned("Ravenmoor"), { ageSeconds: 10 })

        await api.mailTick()
        expect(digestsTo(alice.email)).toEqual([])

        await api.db.update(notifications).set({ createdAt: sql`now() - interval '31 seconds'` }).where(eq(notifications.id, newest))
        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
        expect(digestsTo(alice.email)[0]!.subject).toBe("2 of your bots need attention")
    })

    test("a steady stream holds back the oldest notification no longer than 5 minutes", async () => {
        const alice = await player()
        await notify(alice.id, banned("Ironhold"), { ageSeconds: 301 })
        await notify(alice.id, banned("Ravenmoor"), { ageSeconds: 5 })

        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
        expect(digestsTo(alice.email)[0]!.text).toContain("Ironhold was banned")
    })

    test("a delivery failure is retried on the next round", async () => {
        const alice = await player()
        const id = await notify(alice.id, banned("Ironhold"))
        api.failMail(true)
        try {
            await api.mailTick()
        } finally {
            api.failMail(false)
        }
        expect(await row(id)).toMatchObject({ emailState: "pending", emailAttempts: 1, emailClaimedAt: null, emailError: "the email could not be delivered", emailedAt: null })

        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
        expect(await row(id)).toMatchObject({ emailState: "sent", emailAttempts: 1, emailError: null })
    })

    test("after 5 failed deliveries the notification is given up on", async () => {
        const alice = await player()
        const id = await notify(alice.id, banned("Ironhold"))
        api.failMail(true)
        try {
            for (let round = 1; round <= 4; round++) {
                await api.mailTick()
                expect(await row(id)).toMatchObject({ emailState: "pending", emailAttempts: round })
            }
            await api.mailTick()
        } finally {
            api.failMail(false)
        }
        expect(await row(id)).toMatchObject({ emailState: "failed", emailAttempts: 5 })

        await api.mailTick()
        expect(digestsTo(alice.email)).toEqual([])
    })

    test("a player whose email isn't confirmed gets no email", async () => {
        const newcomer = await api.signup()
        const id = await notify((await newcomer.api.auth.me())!.id, banned("Ironhold"))
        await api.mailTick()
        expect(digestsTo(newcomer.email)).toEqual([])
        expect(await row(id)).toMatchObject({ emailState: "skipped", emailError: "no verified email", emailedAt: null })
    })

    test("a disabled player gets no email", async () => {
        const alice = await player()
        await api.db.update(users).set({ status: "disabled" }).where(eq(users.id, alice.id))
        const id = await notify(alice.id, banned("Ironhold"))
        await api.mailTick()
        expect(digestsTo(alice.email)).toEqual([])
        expect(await row(id)).toMatchObject({ emailState: "skipped", emailError: "the user is disabled" })
    })

    test("a kind the player turned off is skipped while the others still go out", async () => {
        const alice = await player()
        await alice.api.account.setNotificationPrefs({ banned: false, auth_failed: true, crash_loop: true, shutoff: true, ...PLAN_PREFS, incoming_attack: false, station_result: false })
        const off = await notify(alice.id, banned("Ironhold"))
        const on = await notify(alice.id, shutoff("Ravenmoor"))

        await api.mailTick()

        expect(await row(off)).toMatchObject({ emailState: "skipped", emailError: "turned off in the user's settings" })
        expect(await row(on)).toMatchObject({ emailState: "sent" })
        expect(digestsTo(alice.email)).toHaveLength(1)
        expect(digestsTo(alice.email)[0]!.text).not.toContain("Ironhold")
    })

    test("Auto Station notifications stay under the bell unless the player asks for the emails", async () => {
        const alice = await player()
        const attack: NotificationContent = { kind: "incoming_attack", data: { accountName: "Ironhold", serverLabel: "India 1", attacker: "Raider", castle: "Keep", arrival: "2031-02-10T09:30:00.000Z" } }
        const result: NotificationContent = { kind: "station_result", data: { accountName: "Ironhold", serverLabel: "India 1", castle: "Keep", outcome: "stationed", destination: "Ally (3:4)", rubies: null } }
        const quiet = [await notify(alice.id, attack), await notify(alice.id, result)]
        await api.mailTick()
        for (const id of quiet)
            expect(await row(id)).toMatchObject({ emailState: "skipped" })
        expect(digestsTo(alice.email)).toEqual([])

        await alice.api.account.setNotificationPrefs({ ...DEFAULT_PREFS, incoming_attack: true })
        const asked = await notify(alice.id, attack)
        await api.mailTick()
        expect(await row(asked)).toMatchObject({ emailState: "sent" })
        expect(digestsTo(alice.email)[0]!.text).toContain("Raider is attacking Keep on Ironhold")
    })

    test("a notice about the plan, which has no server, is emailed under its own title", async () => {
        const alice = await player()
        await notify(alice.id, { kind: "trial_started", data: { endsAt: "2031-02-10T09:30:00.000Z" } })

        await api.mailTick()

        const [digest, ...more] = digestsTo(alice.email)
        expect(more).toEqual([])
        expect(digest!.subject).toBe("Your free trial has started")
        expect(digest!.text).toContain("Your bots can run on the Basic plan until Feb 10, 2031, 09:30 AM UTC.")
        expect(digest!.text).not.toMatch(/started \(|undefined|stopped and won't start/)
    })

    test("a notice about the plan and a stopped bot go out together, each headed as it should be", async () => {
        const alice = await player()
        await notify(alice.id, banned("Ironhold"))
        await notify(alice.id, { kind: "plan_expiring", data: { endsAt: "2031-02-10T09:30:00.000Z", daysLeft: 1 } })

        await api.mailTick()

        const [digest] = digestsTo(alice.email)
        expect(digest!.subject).toBe("2 updates on your GGE Bot account")
        expect(digest!.text).toContain("Ironhold was banned (India 1)")
        expect(digest!.text).toContain("Your plan ends in 1 day\n")
        expect(digest!.text).not.toContain("undefined")
    })

    test("a digest reads in the player's language: dates in its format, English where the text isn't translated yet", async () => {
        const hans = await player()
        await api.db.update(users).set({ locale: "de" }).where(eq(users.id, hans.id))
        await notify(hans.id, { kind: "plan_expiring", data: { endsAt: "2031-02-10T09:30:00.000Z", daysLeft: 7 } })

        await api.mailTick()

        const [digest] = digestsTo(hans.email)
        expect(digest!.text).toContain("It ends at 10. Feb. 2031, 09:30 UTC.")
        expect(digest!.text).toContain("Your plan ends in 7 days")
        expect(digest!.html).toContain('lang="de" dir="ltr"')
    })

    test("a player who never chose a language is written to in the one detected for them", async () => {
        const hans = await player()
        await api.db.update(users).set({ detectedLocale: "de" }).where(eq(users.id, hans.id))
        await notify(hans.id, { kind: "plan_expired", data: { endedAt: "2031-02-10T09:30:00.000Z" } })
        await api.mailTick()
        expect(digestsTo(hans.email)[0]!.text).toContain("It ended at 10. Feb. 2031, 09:30 UTC")

        const chosen = await player()
        await api.db.update(users).set({ locale: "en", detectedLocale: "de" }).where(eq(users.id, chosen.id))
        await notify(chosen.id, { kind: "plan_expired", data: { endedAt: "2031-02-10T09:30:00.000Z" } })
        await api.mailTick()
        expect(digestsTo(chosen.email)[0]!.text).toContain("It ended at Feb 10, 2031, 09:30 AM UTC")
    })

    test("shutoff emails are off until the player turns them on", async () => {
        const alice = await player()
        const id = await notify(alice.id, shutoff("Ironhold"))
        await api.mailTick()
        expect(await row(id)).toMatchObject({ emailState: "skipped" })
        expect(digestsTo(alice.email)).toEqual([])
    })

    test("past 20 emailed notifications in a day the rest are skipped", async () => {
        const alice = await player()
        for (let i = 0; i < 19; i++)
            await notify(alice.id, banned(`Old ${i}`), { emailState: "sent", emailedAt: new Date() })
        const twentieth = await notify(alice.id, banned("Twentieth"))
        const over = await notify(alice.id, banned("Over"))

        await api.mailTick()

        expect(await row(twentieth)).toMatchObject({ emailState: "sent" })
        expect(await row(over)).toMatchObject({ emailState: "skipped", emailError: "over the limit of 20 emails a day" })
        expect(digestsTo(alice.email)).toHaveLength(1)
        expect(digestsTo(alice.email)[0]!.text).not.toContain("Over was banned")
    })

    test("emails from more than a day ago don't count toward the limit", async () => {
        const alice = await player()
        for (let i = 0; i < 20; i++)
            await notify(alice.id, banned(`Old ${i}`), { emailState: "sent", emailedAt: new Date(Date.now() - 25 * 3600_000) })
        const id = await notify(alice.id, banned("Today"))
        await api.mailTick()
        expect(await row(id)).toMatchObject({ emailState: "sent" })
    })

    test("two mailers running at once send one email", async () => {
        const alice = await player()
        await notify(alice.id, banned("Ironhold"))
        await notify(alice.id, banned("Ravenmoor"))

        await Promise.all([api.mailTick(), api.mailTick(), api.mailTick()])

        expect(digestsTo(alice.email)).toHaveLength(1)
    })

    test("a row another mailer holds locked is passed over, not waited for", async () => {
        const alice = await player()
        const id = await notify(alice.id, banned("Ironhold"))
        const other = await api.db.$pool.connect()
        try {
            await other.query("begin")
            await other.query("select id from notifications where id = $1 for update", [id])

            await api.mailTick()
            expect(digestsTo(alice.email)).toEqual([])

            await other.query("commit")
        } finally {
            other.release()
        }
        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
    })

    test("a claim is honoured for 5 minutes, then another mailer takes the row over", async () => {
        const alice = await player()
        const id = await notify(alice.id, banned("Ironhold"), { emailClaimedAt: new Date(Date.now() - 4 * 60_000) })
        await api.mailTick()
        expect(digestsTo(alice.email)).toEqual([])

        await api.db.update(notifications).set({ emailClaimedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(notifications.id, id))
        await api.mailTick()
        expect(digestsTo(alice.email)).toHaveLength(1)
    })
})

describe("reading notifications", () => {
    test("a player sees only their own, newest first, with how many are unread", async () => {
        const alice = await player()
        const bob = await player()
        const older = await notify(alice.id, banned("Ironhold"))
        const newer = await notify(alice.id, shutoff("Ravenmoor"), { readAt: new Date() })
        await notify(bob.id, banned("Bravo"))

        const mine = await alice.api.notifications.list({})

        expect(mine.unread).toBe(1)
        expect(mine.items).toMatchObject([
            { id: newer, kind: "shutoff", accountId: null, readAt: expect.any(Date), data: { accountName: "Ravenmoor", serverLabel: "India 1" } },
            { id: older, kind: "banned", readAt: null, createdAt: expect.any(Date), data: { accountName: "Ironhold", bannedUntil: null } },
        ])
        expect(Object.keys(mine.items[0]!).sort()).toEqual(["accountId", "createdAt", "data", "id", "kind", "readAt"])
    })

    test("older ones load a page at a time", async () => {
        const alice = await player()
        const ids = []
        for (let i = 0; i < 5; i++)
            ids.push(await notify(alice.id, banned(`A${i}`)))

        const first = await alice.api.notifications.list({ limit: 2 })
        const second = await alice.api.notifications.list({ limit: 2, before: first.items.at(-1)!.id })

        expect(first.items.map(n => n.id)).toEqual([ids[4], ids[3]])
        expect(second.items.map(n => n.id)).toEqual([ids[2], ids[1]])
        expect(second.unread).toBe(5)
        expect(await codeOf(alice.api.notifications.list({ limit: 51 }))).toBe("BAD_REQUEST")
    })

    test("marking some read leaves the rest, and another player's, unread", async () => {
        const alice = await player()
        const bob = await player()
        const [a1, a2] = [await notify(alice.id, banned("A1")), await notify(alice.id, banned("A2"))]
        const b1 = await notify(bob.id, banned("B1"))

        await alice.api.notifications.markRead({ ids: [a1, b1] })

        expect((await row(a1)).readAt).toBeInstanceOf(Date)
        expect((await row(a2)).readAt).toBeNull()
        expect((await row(b1)).readAt).toBeNull()
        expect((await alice.api.notifications.list({})).unread).toBe(1)
        expect((await bob.api.notifications.list({})).unread).toBe(1)
    })

    test("marking all read touches only the caller's", async () => {
        const alice = await player()
        const bob = await player()
        await notify(alice.id, banned("A1"))
        await notify(alice.id, banned("A2"))
        const b1 = await notify(bob.id, banned("B1"))

        await alice.api.notifications.markRead({ all: true })

        expect(await alice.api.notifications.list({})).toMatchObject({ unread: 0, items: [{ readAt: expect.any(Date) }, { readAt: expect.any(Date) }] })
        expect((await row(b1)).readAt).toBeNull()
    })

    test("marking read tells the player's other tabs which ones, and nobody else", async () => {
        const alice = await player()
        const bob = await player()
        const [a1, a2] = [await notify(alice.id, banned("A1")), await notify(alice.id, banned("A2"))]
        const b1 = await notify(bob.id, banned("B1"))

        await alice.api.notifications.markRead({ ids: [a1, b1] })
        expect(await published(alice.id)).toEqual([{ v: 1, kind: "notifications_read", ids: [a1] }])

        await alice.api.notifications.markRead({ all: true })
        expect(await published(alice.id)).toEqual([{ v: 1, kind: "notifications_read", ids: [a1] }, { v: 1, kind: "notifications_read", all: true }])
        expect((await row(a2)).readAt).toBeInstanceOf(Date)
        expect(await published(bob.id)).toEqual([])
    })

    test("marking read when nothing was unread tells nobody", async () => {
        const alice = await player()
        const id = await notify(alice.id, banned("A1"), { readAt: new Date() })
        await alice.api.notifications.markRead({ ids: [id] })
        await alice.api.notifications.markRead({ all: true })
        expect(await published(alice.id)).toEqual([])
    })

    test("a player whose email isn't confirmed can still read theirs; a visitor can't", async () => {
        const newcomer = await api.signup()
        const id = await notify((await newcomer.api.auth.me())!.id, banned("Ironhold"))

        expect((await newcomer.api.notifications.list({})).items.map(n => n.id)).toEqual([id])
        expect(await codeOf(newcomer.api.notifications.markRead({ ids: [id] }))).toBe("ok")
        expect(await codeOf(api.client().api.notifications.list({}))).toBe("UNAUTHORIZED")
        expect(await codeOf(api.client().api.notifications.markRead({ all: true }))).toBe("UNAUTHORIZED")
    })
})

describe("email preferences", () => {
    test("a new player is emailed about bans, rejected passwords, crash loops and their plan, not shutoffs", async () => {
        const alice = await player()
        expect(await alice.api.account.notificationPrefs()).toEqual(DEFAULT_PREFS)
    })

    test("a change is saved for that player only", async () => {
        const alice = await player()
        const bob = await player()
        const chosen = {
            banned: false, auth_failed: true, crash_loop: false, shutoff: true, trial_started: true, plan_expiring: false, plan_expired: true, purchase_completed: false,
            incoming_attack: true, station_result: false,
        }

        await alice.api.account.setNotificationPrefs(chosen)

        expect(await alice.api.account.notificationPrefs()).toEqual(chosen)
        expect(await bob.api.account.notificationPrefs()).toEqual(DEFAULT_PREFS)
    })

    test("a kind missing from what is stored takes its default", async () => {
        const alice = await player()
        await api.db.update(users).set({ notificationPrefs: { banned: false } }).where(eq(users.id, alice.id))
        expect(await alice.api.account.notificationPrefs()).toEqual({ ...DEFAULT_PREFS, banned: false })
    })

    test("a visitor has no preferences to read or set", async () => {
        expect(await codeOf(api.client().api.account.notificationPrefs())).toBe("UNAUTHORIZED")
        expect(await codeOf(api.client().api.account.setNotificationPrefs({ ...DEFAULT_PREFS, shutoff: true }))).toBe("UNAUTHORIZED")
    })
})
