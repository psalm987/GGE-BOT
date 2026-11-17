import { asc, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import type { PeriodSource } from "@gge/contracts"
import { sealFor } from "@gge/crypto"
import { appSettings, gameAccounts, notifications, users } from "@gge/db"
import { appendPeriod } from "../src/services/plans.ts"
import { startApi, type Api } from "./harness.ts"

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date("2031-06-01T12:00:00.000Z")
const day = (n: number) => new Date(T0.getTime() + n * DAY)
const iso = (n: number) => day(n).toISOString()

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())
beforeEach(() => api.db.update(appSettings).set({ billingLive: true }))

let made = 0
/** A player whose periods start at T0, queued one after another as appendPeriod queues them. */
async function playerWith(lengths: number[], { source = "purchase", ...user }: { source?: PeriodSource; role?: "admin"; status?: "disabled" } = {}) {
    const [row] = await api.db.insert(users).values({ username: `lapse${++made}`, passwordHash: "x", ...user }).returning()
    for (const days of lengths)
        await api.db.transaction(tx => appendPeriod(tx, { userId: row!.id, planId: "basic", days, source }, T0))
    return row!.id
}
const noticesOf = async (userId: string) => (await api.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(asc(notifications.id)))
    .map(n => ({ kind: n.kind, data: n.data, accountId: n.accountId }))
const sweep = (at: Date) => api.planTick(at)

test("while billing is off, nobody is told anything", async () => {
    await api.db.update(appSettings).set({ billingLive: false })
    const id = await playerWith([28])
    for (const at of [day(22), day(27.5), day(28.1)])
        await sweep(at)
    expect(await noticesOf(id)).toEqual([])
})

test("a 28-day plan is reminded 7 days and 1 day before it ends, once each", async () => {
    const id = await playerWith([28])

    await sweep(day(20.9))
    expect(await noticesOf(id), "7.1 days left").toEqual([])

    await sweep(day(21.5))
    await sweep(day(22))
    expect(await noticesOf(id)).toEqual([{ kind: "plan_expiring", data: { endsAt: iso(28), daysLeft: 7 }, accountId: null }])

    await sweep(day(27.2))
    await sweep(day(27.9))
    expect(await noticesOf(id)).toEqual([
        { kind: "plan_expiring", data: { endsAt: iso(28), daysLeft: 7 }, accountId: null },
        { kind: "plan_expiring", data: { endsAt: iso(28), daysLeft: 1 }, accountId: null },
    ])
})

test("a plan that ended is announced once, with its end", async () => {
    const id = await playerWith([28])
    await sweep(day(28.01))
    await sweep(day(28.5))
    expect((await noticesOf(id)).filter(n => n.kind === "plan_expired")).toEqual([{ kind: "plan_expired", data: { endedAt: iso(28) }, accountId: null }])
})

test("first seen a few hours before the end, only the 1-day reminder goes out", async () => {
    const id = await playerWith([28])
    await sweep(day(27.8))
    expect(await noticesOf(id)).toEqual([{ kind: "plan_expiring", data: { endsAt: iso(28), daysLeft: 1 }, accountId: null }])
})

test("a 7-day trial isn't told on its first day that it ends in 7 days, but is told the day before", async () => {
    const id = await playerWith([7], { source: "trial" })
    await sweep(new Date(T0.getTime() + 5 * 60_000))
    await sweep(day(3))
    expect(await noticesOf(id)).toEqual([])
    await sweep(day(6.5))
    expect(await noticesOf(id)).toEqual([{ kind: "plan_expiring", data: { endsAt: iso(7), daysLeft: 1 }, accountId: null }])
})

test("time added after a reminder sets the reminders up again for the new end", async () => {
    const id = await playerWith([28])
    await sweep(day(21.5))
    await api.db.transaction(tx => appendPeriod(tx, { userId: id, planId: "basic", days: 28, source: "purchase" }, day(22)))

    await sweep(day(27.9))
    expect(await noticesOf(id), "the old end passes unremarked").toHaveLength(1)
    await sweep(day(49.5))
    await sweep(day(55.5))
    await sweep(day(56.1))
    expect((await noticesOf(id)).map(n => n.data)).toEqual([
        { endsAt: iso(28), daysLeft: 7 },
        { endsAt: iso(56), daysLeft: 7 },
        { endsAt: iso(56), daysLeft: 1 },
        { endedAt: iso(56) },
    ])
})

test("a plan renewed after it ended is announced again when the new one ends", async () => {
    const id = await playerWith([28])
    await sweep(day(28.1))
    await api.db.transaction(tx => appendPeriod(tx, { userId: id, planId: "basic", days: 28, source: "points" }, day(30)))
    await sweep(day(58.1))
    expect((await noticesOf(id)).filter(n => n.kind === "plan_expired").map(n => n.data)).toEqual([{ endedAt: iso(28) }, { endedAt: iso(58) }])
})

test("a plan that ended over a week ago isn't announced", async () => {
    const id = await playerWith([28])
    await sweep(day(36.5))
    expect(await noticesOf(id)).toEqual([])
})

test("an admin's and a disabled player's plans are left alone", async () => {
    const player = await playerWith([28])
    const admin = await playerWith([28], { role: "admin" })
    const disabled = await playerWith([28], { status: "disabled" })
    await sweep(day(27.5))
    expect(await noticesOf(player)).toHaveLength(1)
    expect([...await noticesOf(admin), ...await noticesOf(disabled)]).toEqual([])
})

test("two sweeps at once send one set of notifications", async () => {
    const ids = await Promise.all([playerWith([28]), playerWith([28]), playerWith([28])])
    await Promise.all([sweep(day(21.5)), sweep(day(21.5)), sweep(day(21.5))])
    for (const id of ids)
        expect(await noticesOf(id)).toHaveLength(1)
})

test("sweeping changes no account: the runner stops the bots at the end and starts them again on renewal", async () => {
    const id = await playerWith([28])
    const [account] = await api.db.insert(gameAccounts)
        .values({ ownerId: id, name: `Lapsed${made}`, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw"), desiredState: "running" }).returning()
    await sweep(day(28.1))
    expect((await noticesOf(id)).map(n => n.kind)).toContain("plan_expired")
    expect((await api.db.select().from(gameAccounts).where(eq(gameAccounts.id, account!.id)))[0]).toEqual(account)
})
