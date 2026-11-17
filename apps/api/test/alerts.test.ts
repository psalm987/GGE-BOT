import { asc, eq, like, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { userChannel, type CreateAnnouncement, type PlanId } from "@gge/contracts"
import { announcements, appSettings, auditLog, centrifugoOutbox, gameAccounts, planPeriods, users } from "@gge/db"
import { sealFor } from "@gge/crypto"
import { startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
})
afterAll(() => api.close())
beforeEach(async () => {
    await setBilling(false)
    await api.db.delete(announcements)
})

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const setBilling = (billingLive: boolean) => api.db.update(appSettings).set({ billingLive })
const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)

async function player() {
    const username = `p${Math.random().toString(36).slice(2, 10)}`
    const p = await api.player(username)
    const [user] = await api.db.select({ id: users.id }).from(users).where(eq(users.username, username))
    return { ...p, id: user!.id, username }
}

/** A period on `planId` that ends `endsIn` ms from now; negative for one that has ended. */
const period = (userId: string, endsIn: number, source: "trial" | "purchase" = "purchase", planId: PlanId = "basic") =>
    api.db.insert(planPeriods).values({ userId, planId, source, startsAt: new Date(Date.now() + endsIn - 28 * DAY), endsAt: new Date(Date.now() + endsIn) })

const addAccounts = (ownerId: string, n: number) => api.db.insert(gameAccounts).values(Array.from({ length: n }, (_, i) => ({
    ownerId, name: `acc${Math.random().toString(36).slice(2, 8)}${i}`, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw"),
})))

const announce = (over: Partial<CreateAnnouncement> = {}) => admin.api.announcements.create({
    severity: "info", title: "Maintenance tonight", body: "The game servers restart at 02:00.", linkUrl: null,
    startsAt: new Date(Date.now() - HOUR), endsAt: null, dismissible: true, ...over,
})

describe("while billing is off", () => {
    test("a player sees no plan, trial or points banner, whatever their periods and points", async () => {
        const p = await player()
        await period(p.id, 2 * DAY, "trial")
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 20, note: "test grant" })
        expect(await p.api.alerts.list()).toEqual({ plan: null, noPlan: false, overLimit: null, points: null, announcements: [] })
    })

    test("announcements and over-limit still show, against users.max_bots", async () => {
        const p = await player()
        await addAccounts(p.id, 3)
        const created = await announce()
        const alerts = await p.api.alerts.list()
        expect(alerts.overLimit).toEqual({ limit: 1, counted: 3 })
        expect(alerts.announcements.map(a => a.id)).toEqual([created.id])
    })
})

describe("plan banners once billing is live", () => {
    beforeEach(() => setBilling(true))

    test("a plan with more than 14 days left shows nothing; at 14 days it shows with the days left rounded up", async () => {
        const p = await player()
        await period(p.id, 14 * DAY + HOUR)
        expect((await p.api.alerts.list()).plan).toBeNull()
        await api.db.update(planPeriods).set({ endsAt: new Date(Date.now() + 14 * DAY - HOUR) }).where(eq(planPeriods.userId, p.id))
        expect((await p.api.alerts.list()).plan).toMatchObject({ planId: "basic", isTrial: false, daysLeft: 14 })
    })

    test("a trial ending in under a day reads 1 day left", async () => {
        const p = await player()
        await period(p.id, 5 * HOUR, "trial")
        expect(await p.api.alerts.list()).toMatchObject({ plan: { isTrial: true, daysLeft: 1 }, noPlan: false })
    })

    test("time queued behind the trial is what ends, so the banner speaks of the later plan", async () => {
        const p = await player()
        await period(p.id, 2 * DAY, "trial")
        await api.db.insert(planPeriods).values({ userId: p.id, planId: "team", source: "purchase", startsAt: new Date(Date.now() + 2 * DAY), endsAt: new Date(Date.now() + 10 * DAY) })
        expect((await p.api.alerts.list()).plan).toMatchObject({ planId: "team", isTrial: false, daysLeft: 10 })
    })

    test("a plan that has ended shows with no plan and 0 days, and nobody is over a limit", async () => {
        const p = await player()
        await period(p.id, -3 * DAY)
        await addAccounts(p.id, 2)
        expect(await p.api.alerts.list()).toMatchObject({ plan: { planId: "basic", daysLeft: 0 }, noPlan: true, overLimit: null })
    })

    test("a player who never had a plan has none to show and no plan", async () => {
        const p = await player()
        expect(await p.api.alerts.list()).toMatchObject({ plan: null, noPlan: true })
    })

    test("admins see no plan banners", async () => {
        expect(await admin.api.billing.status()).toMatchObject({ billingLive: true })
        const p = await player()
        await api.db.update(users).set({ role: "admin" }).where(eq(users.id, p.id))
        expect(await p.api.alerts.list()).toMatchObject({ plan: null, noPlan: false })
    })
})

describe("the points banner", () => {
    beforeEach(() => setBilling(true))

    test("shows at the redeem cost, stays closed once closed, and comes back when the player earns more", async () => {
        const p = await player()
        await period(p.id, 20 * DAY)
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 7, note: "test grant" })
        expect((await p.api.alerts.list()).points).toBeNull()
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 2, note: "test grant" })
        expect((await p.api.alerts.list()).points).toEqual({ balance: 9, cost: 8, days: 28, planId: "basic" })

        await p.api.alerts.dismiss({ id: "points" })
        expect((await p.api.alerts.list()).points).toBeNull()

        await new Promise(resolve => setTimeout(resolve, 5))
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 1, note: "test grant" })
        expect((await p.api.alerts.list()).points).toMatchObject({ balance: 10 })
    })
})

describe("announcements", () => {
    test("show only between their start and end, critical first", async () => {
        const p = await player()
        const info = await announce({ title: "Info" })
        const critical = await announce({ title: "Critical", severity: "critical" })
        await announce({ title: "Later", startsAt: new Date(Date.now() + DAY) })
        await announce({ title: "Over", startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - DAY) })
        expect((await p.api.alerts.list()).announcements.map(a => a.id)).toEqual([critical.id, info.id])
    })

    test("a dismissal hides it for that player only, and repeats are harmless", async () => {
        const [a, b] = [await player(), await player()]
        const { id } = await announce()
        await a.api.alerts.dismiss({ id })
        await a.api.alerts.dismiss({ id })
        expect((await a.api.alerts.list()).announcements).toEqual([])
        expect((await b.api.alerts.list()).announcements.map(x => x.id)).toEqual([id])
        expect((await admin.api.announcements.list()).find(x => x.id === id)?.dismissals).toBe(1)
    })

    test("one that can't be dismissed is refused and keeps showing", async () => {
        const p = await player()
        const { id } = await announce({ dismissible: false, severity: "critical" })
        expect(await refusal(p.api.alerts.dismiss({ id }))).toBe("FORBIDDEN")
        expect((await p.api.alerts.list()).announcements.map(x => x.id)).toEqual([id])
    })

    test("an unknown id is not found", async () => {
        const p = await player()
        expect(await refusal(p.api.alerts.dismiss({ id: crypto.randomUUID() }))).toBe("NOT_FOUND")
    })

    test("a link must be http or https", async () => {
        expect(await refusal(announce({ linkUrl: "javascript:alert(1)" }))).toBe("BAD_REQUEST")
    })
})

describe("admin announcements", () => {
    test("create, update and end are each audited, and ending takes it off every player's banners", async () => {
        const p = await player()
        const created = await announce({ severity: "warning" })
        expect(created).toMatchObject({ state: "live", createdBy: "boss", dismissals: 0 })

        const updated = await admin.api.announcements.update({ id: created.id, title: "Maintenance moved", linkUrl: "https://status.example.test" })
        expect(updated).toMatchObject({ title: "Maintenance moved", linkUrl: "https://status.example.test", severity: "warning" })
        expect((await p.api.alerts.list()).announcements[0]).toMatchObject({ title: "Maintenance moved" })

        expect(await admin.api.announcements.end({ id: created.id })).toMatchObject({ state: "ended" })
        expect((await p.api.alerts.list()).announcements).toEqual([])

        const trail = await api.db.select({ action: auditLog.action }).from(auditLog)
            .where(eq(auditLog.targetId, created.id)).orderBy(asc(auditLog.id))
        expect(trail.map(e => e.action)).toEqual(["admin.announcement.create", "admin.announcement.update", "admin.announcement.end"])
    })

    test("ending a scheduled one ends it before it starts", async () => {
        const created = await announce({ startsAt: new Date(Date.now() + DAY) })
        expect(created.state).toBe("scheduled")
        const ended = await admin.api.announcements.end({ id: created.id })
        expect(ended.state).toBe("ended")
        expect(ended.endsAt! > ended.startsAt).toBe(true)
    })

    test("an end before the start is refused", async () => {
        const created = await announce()
        expect(await refusal(admin.api.announcements.update({ id: created.id, endsAt: new Date(Date.now() - 2 * HOUR) }))).toBe("BAD_REQUEST")
    })

    test("nobody signed out of the admin app reaches them", async () => {
        expect(await refusal(api.admin().api.announcements.list())).toBe("UNAUTHORIZED")
    })
})

describe("live refresh", () => {
    test("changing a player's limit or points tells their open tabs to refetch the banners", async () => {
        const p = await player()
        const alertEvents = () => api.db.select().from(centrifugoOutbox)
            .where(sql`${centrifugoOutbox.payload}->>'channel' = ${userChannel(p.id)} and ${centrifugoOutbox.payload}->'data'->>'kind' = 'alerts'`)
        await admin.api.users.setMaxBots({ id: p.id, maxBots: 3 })
        expect(await alertEvents()).toHaveLength(1)
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 1, note: "test grant" })
        expect(await alertEvents()).toHaveLength(2)
        expect(await api.db.select().from(auditLog).where(like(auditLog.action, "admin.user.max_bots"))).not.toHaveLength(0)
    })
})
