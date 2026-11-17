import { asc, eq, sql } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { userChannel } from "@gge/contracts"
import { appSettings, auditLog, centrifugoOutbox, gameAccounts, planPeriods, plans, users } from "@gge/db"
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
    await api.db.update(appSettings).set({ billingLive: true })
    await api.db.update(plans).set({ maxAccounts: 1 })
})

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string }) => e.code)
const trail = (targetId: string) => api.db.select({ action: auditLog.action, meta: auditLog.meta }).from(auditLog).where(eq(auditLog.targetId, targetId)).orderBy(asc(auditLog.id))
const alertEvents = (userId: string) => api.db.select().from(centrifugoOutbox)
    .where(sql`${centrifugoOutbox.payload}->>'channel' = ${userChannel(userId)} and ${centrifugoOutbox.payload}->'data'->>'kind' = 'alerts'`)

async function player() {
    const username = `p${Math.random().toString(36).slice(2, 10)}`
    const p = await api.player(username)
    const [user] = await api.db.select({ id: users.id }).from(users).where(eq(users.username, username))
    return { ...p, id: user!.id, username }
}

const addRunning = (ownerId: string, n: number) => api.db.insert(gameAccounts).values(Array.from({ length: n }, (_, i) => ({
    ownerId, name: `acc${Math.random().toString(36).slice(2, 8)}${i}`, serverId: 26, desiredState: "running" as const,
    passwordSealed: sealFor(api.keys.publicKey, "pw"), createdAt: new Date(Date.now() - (n - i) * 1000),
})))

describe("granting and ending time", () => {
    test("granted days queue behind the player's time, keep the note, and are audited and announced", async () => {
        const p = await player()
        const first = await admin.api.billing.grantDays({ userId: p.id, planId: "basic", days: 7, note: "welcome gift" })
        const second = await admin.api.billing.grantDays({ userId: p.id, planId: "team", days: 3, note: "sorry for the outage" })
        expect(first).toMatchObject({ source: "admin", planId: "basic", grantedBy: "boss", note: "welcome gift" })
        expect(second.startsAt).toEqual(first.endsAt)

        expect(await p.api.billing.myPlan()).toMatchObject({
            current: { planId: "basic", isTrial: false, endsAt: second.endsAt },
            periods: [{ id: first.id }, { id: second.id }],
            limit: 1,
            counted: 0,
        })
        expect((await trail(p.id)).map(e => e.action)).toEqual(["admin.billing.grant_days", "admin.billing.grant_days"])
        expect(await alertEvents(p.id)).toHaveLength(2)
    })

    test("ending the current period moves the queue up and stops bots the player no longer has a plan for", async () => {
        const p = await player()
        await admin.api.billing.grantDays({ userId: p.id, planId: "basic", days: 7, note: "trial extension" })
        await addRunning(p.id, 1)

        expect(await admin.api.billing.endPeriod({ userId: p.id })).toEqual({ ended: true })
        expect((await p.api.billing.myPlan()).current).toBeNull()
        const [account] = await api.db.select({ desiredState: gameAccounts.desiredState }).from(gameAccounts).where(eq(gameAccounts.ownerId, p.id))
        expect(account!.desiredState).toBe("stopped")
        expect((await trail(p.id)).at(-1)).toMatchObject({ action: "admin.billing.end_period" })

        expect(await admin.api.billing.endPeriod({ userId: p.id })).toEqual({ ended: false })
    })

    test("an unknown user is not found", async () => {
        expect(await refusal(admin.api.billing.grantDays({ userId: crypto.randomUUID(), planId: "basic", days: 1, note: "nobody" }))).toBe("NOT_FOUND")
    })
})

describe("limits", () => {
    test("an override replaces the plan's limit, stops what is over it, and clears again", async () => {
        const p = await player()
        await admin.api.billing.grantDays({ userId: p.id, planId: "basic", days: 28, note: "test" })
        await admin.api.users.setLimitOverride({ id: p.id, maxBotsOverride: 3 })
        await addRunning(p.id, 3)
        expect((await p.api.billing.myPlan()).limit).toBe(3)

        await admin.api.users.setLimitOverride({ id: p.id, maxBotsOverride: null })
        expect(await p.api.billing.myPlan()).toMatchObject({ limit: 1, counted: 3 })
        const states = await api.db.select({ desiredState: gameAccounts.desiredState }).from(gameAccounts).where(eq(gameAccounts.ownerId, p.id)).orderBy(asc(gameAccounts.createdAt))
        expect(states.map(s => s.desiredState)).toEqual(["running", "stopped", "stopped"])
        expect((await admin.api.billing.userPlan({ userId: p.id })).maxBotsOverride).toBeNull()
        expect((await trail(p.id)).filter(e => e.action === "admin.user.limit_override").map(e => e.meta)).toEqual([
            { from: null, to: 3, stopped: [] },
            { from: 3, to: null, stopped: expect.any(Array) },
        ])
    })

    test("a plan's size changes for everyone on it, audited", async () => {
        const p = await player()
        await admin.api.billing.grantDays({ userId: p.id, planId: "team", days: 28, note: "test" })
        expect(await admin.api.billing.updatePlan({ id: "team", maxAccounts: 4 })).toEqual({ id: "team", name: expect.any(String), maxAccounts: 4 })
        expect((await p.api.billing.myPlan()).limit).toBe(4)
        expect((await admin.api.billing.plans()).map(plan => [plan.id, plan.maxAccounts])).toEqual([["basic", 1], ["team", 4]])
        expect((await trail("team")).at(-1)).toMatchObject({ action: "admin.billing.update_plan", meta: { from: 1, to: 4 } })
    })
})

describe("a player's plan on their admin page", () => {
    test("periods latest first, points with who changed them, and the codes they bought", async () => {
        const p = await player()
        await admin.api.billing.grantDays({ userId: p.id, planId: "basic", days: 7, note: "first" })
        await admin.api.billing.recordPurchase({ userId: p.id, packageId: "team5_28" })
        await admin.api.billing.adjustPoints({ userId: p.id, delta: 2, note: "goodwill" })

        const plan = await admin.api.billing.userPlan({ userId: p.id })
        expect(plan.current).toMatchObject({ planId: "basic" })
        expect(plan.periods.map(x => x.note)).toEqual(["first"])
        expect(plan.points).toMatchObject({ balance: 7, history: [{ delta: 2, reason: "admin", note: "goodwill", createdBy: "boss" }, { delta: 5, reason: "purchase" }] })
        expect(plan.codes).toHaveLength(5)
    })
})

describe("the players list", () => {
    test("shows each player's plan and when it ends, and filters by trial, ending soon and no plan", async () => {
        const [trial, ending, later, none] = [await player(), await player(), await player(), await player()]
        const insert = (userId: string, source: "trial" | "purchase", endsIn: number) =>
            api.db.insert(planPeriods).values({ userId, planId: "basic", source, startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + endsIn) })
        await insert(trial.id, "trial", 20 * DAY)
        await insert(ending.id, "purchase", 3 * DAY)
        await insert(later.id, "purchase", 20 * DAY)

        const usernames = async (plan?: "trial" | "expiring" | "none") =>
            (await admin.api.users.list({ plan, limit: 200, offset: 0 })).items.map(u => u.username)
        expect(await usernames("trial")).toContain(trial.username)
        expect(await usernames("trial")).not.toContain(later.username)
        expect(await usernames("expiring")).toEqual(expect.arrayContaining([ending.username]))
        expect(await usernames("expiring")).not.toContain(later.username)
        expect(await usernames("none")).toContain(none.username)
        expect(await usernames("none")).not.toContain("boss")

        const { items } = await admin.api.users.list({ search: trial.username, limit: 10, offset: 0 })
        expect(items[0]!.plan).toMatchObject({ planId: "basic", isTrial: true })
        expect((await admin.api.users.get({ id: none.id })).plan).toBeNull()
    })
})

describe("the player's own plan", () => {
    test("is refused while billing is off", async () => {
        await api.db.update(appSettings).set({ billingLive: false })
        expect(await refusal((await player()).api.billing.myPlan())).toBe("FORBIDDEN")
    })

    test("billing.config says whether billing is live", async () => {
        const p = await player()
        expect((await p.api.billing.config()).billingLive).toBe(true)
        await api.db.update(appSettings).set({ billingLive: false })
        expect((await p.api.billing.config()).billingLive).toBe(false)
    })
})
