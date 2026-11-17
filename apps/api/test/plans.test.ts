import { asc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { NO_PLAN, PLAN_LIMIT, type PlanId } from "@gge/contracts"
import { appSettings, gameAccounts, planPeriods, users } from "@gge/db"
import { sealFor } from "@gge/crypto"
import { appendPeriod, endCurrentPeriod } from "../src/services/plans.ts"
import { startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const DAY = 24 * 60 * 60 * 1000
const newUser = async () => (await api.db.insert(users).values({ username: `u${Math.random().toString(36).slice(2, 10)}`, passwordHash: "x" }).returning())[0]!.id
const periodsOf = (userId: string) => api.db.select().from(planPeriods).where(eq(planPeriods.userId, userId)).orderBy(asc(planPeriods.startsAt))
const append = (userId: string, over: { planId?: PlanId; days?: number; source?: "trial" | "purchase" | "admin" } = {}, now?: Date) =>
    api.db.transaction(tx => appendPeriod(tx, { userId, planId: "basic", days: 28, source: "purchase", ...over }, now))

describe("appendPeriod", () => {
    test("the first period starts now and lasts its days", async () => {
        const userId = await newUser()
        const now = new Date("2026-03-01T10:00:00Z")
        expect(await append(userId, { days: 7 }, now)).toMatchObject({ userId, planId: "basic", source: "purchase", startsAt: now, endsAt: new Date("2026-03-08T10:00:00Z") })
    })

    test("a second period queues behind the first with no gap and no overlap", async () => {
        const userId = await newUser()
        const now = new Date("2026-03-01T10:00:00Z")
        const first = await append(userId, {}, now)
        const second = await append(userId, { planId: "team" }, new Date(now.getTime() + 3 * DAY))
        expect(second.startsAt).toEqual(first.endsAt)
        expect(second.endsAt.getTime() - second.startsAt.getTime()).toBe(28 * DAY)
    })

    test("after the cover has run out, the next period starts now", async () => {
        const userId = await newUser()
        await append(userId, { days: 1 }, new Date("2026-03-01T10:00:00Z"))
        const later = new Date("2026-04-01T10:00:00Z")
        expect((await append(userId, {}, later)).startsAt).toEqual(later)
    })

    test("appends for one user at the same moment still queue", async () => {
        const userId = await newUser()
        const now = new Date("2026-03-01T10:00:00Z")
        await Promise.all(Array.from({ length: 4 }, () => append(userId, { days: 7 }, now)))
        const periods = await periodsOf(userId)
        expect(periods.map(p => p.startsAt.getTime())).toEqual([0, 7, 14, 21].map(d => now.getTime() + d * DAY))
        expect(periods.map(p => p.endsAt.getTime())).toEqual([7, 14, 21, 28].map(d => now.getTime() + d * DAY))
    })

    test("a user gets one trial, ever", async () => {
        const userId = await newUser()
        await append(userId, { source: "trial", days: 7 })
        await expect(append(userId, { source: "trial", days: 7 })).rejects.toMatchObject({ cause: { constraint: "plan_periods_one_trial" } })
        expect(await periodsOf(userId)).toHaveLength(1)
        expect(await append(userId)).toMatchObject({ source: "purchase" })
    })
})

describe("endCurrentPeriod", () => {
    const end = (userId: string, now: Date) => api.db.transaction(tx => endCurrentPeriod(tx, userId, now))

    test("cuts the current period to now and pulls the queued ones forward by the time cut", async () => {
        const userId = await newUser()
        const start = new Date("2026-03-01T10:00:00Z")
        for (const planId of ["basic", "team", "basic"] as const)
            await append(userId, { planId }, start)
        const now = new Date(start.getTime() + 10 * DAY)

        expect(await end(userId, now)).toMatchObject({ planId: "basic", startsAt: start })

        const periods = await periodsOf(userId)
        expect(periods.map(p => [p.planId, p.startsAt.getTime(), p.endsAt.getTime()])).toEqual([
            ["basic", start.getTime(), now.getTime()],
            ["team", now.getTime(), now.getTime() + 28 * DAY],
            ["basic", now.getTime() + 28 * DAY, now.getTime() + 56 * DAY],
        ])
    })

    test("ending the queued period next keeps the queue without a gap, and a repeat changes nothing", async () => {
        const userId = await newUser()
        const start = new Date("2026-03-01T10:00:00Z")
        await append(userId, {}, start)
        await append(userId, { planId: "team" }, start)
        const now = new Date(start.getTime() + 10 * DAY)
        await end(userId, now)
        // The team period now starts exactly at `now`, so ending it leaves it no length.
        await end(userId, now)
        expect(await end(userId, now)).toBeUndefined()
        expect((await periodsOf(userId)).map(p => [p.planId, p.endsAt.getTime()])).toEqual([["basic", now.getTime()]])
    })

    test("a user in no period is left alone", async () => {
        const userId = await newUser()
        const start = new Date("2026-03-01T10:00:00Z")
        await append(userId, { days: 1 }, start)
        expect(await end(userId, new Date(start.getTime() + 5 * DAY))).toBeUndefined()
        expect((await periodsOf(userId))[0]!.endsAt).toEqual(new Date(start.getTime() + DAY))
    })
})

describe("with billing live", () => {
    const setBilling = (billingLive: boolean) => api.db.update(appSettings).set({ billingLive })
    beforeAll(() => setBilling(true))
    afterAll(() => setBilling(false))

    const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string; data?: { code?: string } }) => `${e.code} ${e.data?.code}`)
    const newAccount = () => ({ name: `acc${Math.random().toString(36).slice(2, 8)}`, serverId: 26, password: "pw", externalEvent: false, plugins: {} })
    const start = (p: Awaited<ReturnType<Api["player"]>>, ids: string[]) => refusal(p.api.accounts.setDesiredState({ ids, state: "running" }))
    async function player(username: string) {
        const p = await api.player(username)
        const [user] = await api.db.select({ id: users.id }).from(users).where(eq(users.username, username))
        return { ...p, id: user!.id }
    }
    const seedAccount = async (ownerId: string, name: string) =>
        (await api.db.insert(gameAccounts).values({ ownerId, name, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw") }).returning())[0]!.id

    test("a player with no plan can neither add nor start an account", async () => {
        const p = await player("planless")
        expect(await refusal(p.api.accounts.create(newAccount()))).toBe(`FORBIDDEN ${NO_PLAN}`)
        const id = await seedAccount(p.id, "Planless1")
        expect(await p.api.accounts.list()).toMatchObject([{ id, entitled: false }])
        expect(await start(p, [id])).toBe(`FORBIDDEN ${NO_PLAN}`)
    })

    test("a Basic period runs one account and refuses the second as over the limit", async () => {
        const p = await player("basic1")
        await append(p.id)
        const first = await p.api.accounts.create(newAccount())
        expect(first.entitled).toBe(true)
        expect(await start(p, [first.id])).toBe("ok")
        expect(await refusal(p.api.accounts.create(newAccount()))).toBe(`FORBIDDEN ${PLAN_LIMIT}`)
        const second = await seedAccount(p.id, "Basic1Extra")
        expect(await start(p, [second])).toBe(`FORBIDDEN ${PLAN_LIMIT}`)
    })

    test("max_bots is ignored: a high one adds nothing to the plan", async () => {
        const p = await player("highmax")
        await api.db.update(users).set({ maxBots: 5 }).where(eq(users.id, p.id))
        await append(p.id)
        await p.api.accounts.create(newAccount())
        expect(await refusal(p.api.accounts.create(newAccount()))).toBe(`FORBIDDEN ${PLAN_LIMIT}`)
    })

    test("an override of 3 runs three accounts", async () => {
        const p = await player("override3")
        await append(p.id)
        await api.db.update(users).set({ maxBotsOverride: 3 }).where(eq(users.id, p.id))
        const ids = []
        for (let i = 0; i < 3; i++)
            ids.push((await p.api.accounts.create(newAccount())).id)
        expect(await start(p, ids)).toBe("ok")
        expect(await refusal(p.api.accounts.create(newAccount()))).toBe(`FORBIDDEN ${PLAN_LIMIT}`)
    })

    test("an expired period is no plan", async () => {
        const p = await player("expired")
        await append(p.id, { days: 1 }, new Date(Date.now() - 3 * DAY))
        const id = await seedAccount(p.id, "Expired1")
        expect(await start(p, [id])).toBe(`FORBIDDEN ${NO_PLAN}`)
    })

    test("a period that hasn't started is no plan yet", async () => {
        const p = await player("queued")
        await api.db.insert(planPeriods).values({ userId: p.id, planId: "basic", source: "admin", startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 2 * DAY) })
        const id = await seedAccount(p.id, "Queued1")
        expect(await start(p, [id])).toBe(`FORBIDDEN ${NO_PLAN}`)
    })

    test("turning billing off puts the player back on max_bots at once", async () => {
        const p = await player("switched")
        const id = await seedAccount(p.id, "Switched1")
        expect(await start(p, [id])).toBe(`FORBIDDEN ${NO_PLAN}`)
        await setBilling(false)
        try {
            expect(await p.api.accounts.list()).toMatchObject([{ id, entitled: true }])
            expect(await start(p, [id])).toBe("ok")
            expect(await refusal(p.api.accounts.create(newAccount()))).toBe(`FORBIDDEN ${PLAN_LIMIT}`)
        } finally {
            await setBilling(true)
        }
    })
})
