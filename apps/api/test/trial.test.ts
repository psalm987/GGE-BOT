import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { NO_PLAN, PLAN_LIMIT, TRIAL_GAME_ACCOUNT_USED } from "@gge/contracts"
import { appSettings, auditLog, gameAccounts, planPeriods, trialGameAccounts, users } from "@gge/db"
import { sealFor } from "@gge/crypto"
import { appendPeriod, grantTrial } from "../src/services/plans.ts"
import { PASSWORD, startApi, type Api } from "./harness.ts"

const DAY = 24 * 60 * 60 * 1000
const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string; data?: { code?: string } }) => `${e.code} ${e.data?.code}`)

describe("with a Paystack key", () => {
    let api: Api
    let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
    beforeAll(async () => {
        api = await startApi({ PAYSTACK_SECRET_KEY: "sk_test_x" })
        admin = await api.signedInAdmin()
    })
    afterAll(() => api.close())

    const setBilling = (billingLive: boolean) => api.db.update(appSettings).set({ billingLive })
    const idOf = async (username: string) => (await api.db.select({ id: users.id }).from(users).where(eq(users.username, username)))[0]!.id
    const periodsOf = (userId: string) => api.db.select().from(planPeriods).where(eq(planPeriods.userId, userId))
    const audited = async (action: string) => (await api.db.select().from(auditLog).where(eq(auditLog.action, action))).at(-1)
    const newAccount = (name = `acc${Math.random().toString(36).slice(2, 8)}`) => ({ name, serverId: 26, password: "pw", externalEvent: false, plugins: {} })
    const seedAccount = async (ownerId: string, name: string, over: { desiredState?: "running"; externalEvent?: boolean } = {}) =>
        (await api.db.insert(gameAccounts).values({ ownerId, name, serverId: 26, passwordSealed: sealFor(api.keys.publicKey, "pw"), ...over }).returning())[0]!.id
    const start = (p: Awaited<ReturnType<Api["player"]>>, ids: string[]) => refusal(p.api.accounts.setDesiredState({ ids, state: "running" }))

    /** A player who confirms their email through the emailed link, as a real one does. */
    async function verifiedByLink(username: string) {
        const p = await api.signup(username)
        await p.api.auth.verifyEmail({ token: api.lastToken(p.email)! })
        return { ...p, id: await idOf(username) }
    }

    describe("while billing is off", () => {
        test("confirming an email grants no trial", async () => {
            const p = await verifiedByLink("freebie")
            expect(await periodsOf(p.id)).toEqual([])
        })

        test("no game account is recorded when one starts", async () => {
            const p = await api.player("offstart")
            const { id } = await p.api.accounts.create(newAccount())
            expect(await start(p, [id])).toBe("ok")
            expect(await api.db.select().from(trialGameAccounts)).toEqual([])
        })
    })

    describe("grantTrial", () => {
        test("gives trial_days of Basic once, and a second call changes nothing", async () => {
            const [user] = await api.db.insert(users).values({ username: "twice", passwordHash: "x" }).returning()
            const now = new Date("2026-03-01T10:00:00Z")
            const first = await api.db.transaction(tx => grantTrial(tx, user!.id, now))
            expect(first).toMatchObject({ planId: "basic", source: "trial", startsAt: now, endsAt: new Date(now.getTime() + 7 * DAY) })
            expect(await api.db.transaction(tx => grantTrial(tx, user!.id, new Date(now.getTime() + 30 * DAY)))).toBeUndefined()
            expect(await periodsOf(user!.id)).toHaveLength(1)
        })

        test("two at the same moment grant one trial", async () => {
            const [user] = await api.db.insert(users).values({ username: "racer", passwordHash: "x" }).returning()
            const results = await Promise.all(Array.from({ length: 4 }, () => api.db.transaction(tx => grantTrial(tx, user!.id))))
            expect(results.filter(Boolean)).toHaveLength(1)
            expect(await periodsOf(user!.id)).toHaveLength(1)
        })
    })

    describe("going live", () => {
        afterAll(() => setBilling(false))

        test("gives every active, verified player one trial and records their game accounts, once", async () => {
            const owed = await api.player("owed")
            const owedId = await idOf("owed")
            const running = await seedAccount(owedId, "OwedMain", { desiredState: "running" })
            await seedAccount(owedId, "owedmain", { externalEvent: true })
            await api.signup("unverified")
            await api.player("disabled")
            await api.db.update(users).set({ status: "disabled" }).where(eq(users.username, "disabled"))
            await api.player("paying")
            const paying = await idOf("paying")
            const paid = await api.db.transaction(tx => appendPeriod(tx, { userId: paying, planId: "team", days: 28, source: "admin" }))

            const before = await admin.api.billing.status()
            expect(before).toMatchObject({ billingLive: false, paystackConfigured: true })
            const trialsBefore = (await api.db.select().from(planPeriods).where(eq(planPeriods.source, "trial"))).length

            expect(await admin.api.billing.setLive({ live: true })).toEqual({ billingLive: true, paystackConfigured: true, usersGettingTrial: 0 })

            const trials = await api.db.select().from(planPeriods).where(eq(planPeriods.source, "trial"))
            expect(trials.length - trialsBefore).toBe(before.usersGettingTrial)
            const [trial] = await periodsOf(owedId)
            expect(trial).toMatchObject({ planId: "basic", source: "trial" })
            expect(trial!.endsAt.getTime() - trial!.startsAt.getTime()).toBe(7 * DAY)
            expect(await periodsOf(await idOf("unverified"))).toEqual([])
            expect(await periodsOf(await idOf("disabled"))).toEqual([])
            expect(await periodsOf(await idOf("boss"))).toEqual([])
            // The trial of a player who already has time queues behind it.
            expect((await periodsOf(paying)).find(p => p.source === "trial")!.startsAt).toEqual(paid.endsAt)
            // A main and its twin are one game account.
            expect(await api.db.select().from(trialGameAccounts).where(eq(trialGameAccounts.userId, owedId))).toHaveLength(1)
            expect(await audited("admin.billing.go_live")).toMatchObject({ meta: { trialsGranted: before.usersGettingTrial } })

            // Nothing stopped: the account that ran before still may.
            expect(await owed.api.accounts.list()).toContainEqual(expect.objectContaining({ id: running, entitled: true, desiredState: "running" }))

            await admin.api.billing.setLive({ live: true })
            expect(await api.db.select().from(planPeriods).where(eq(planPeriods.source, "trial"))).toHaveLength(trials.length)
            expect(await audited("admin.billing.go_live")).toMatchObject({ meta: { trialsGranted: 0, gameAccountsRecorded: 0 } })
        })

        test("a player an admin let run three bots keeps all three, on the trial and on a later Basic plan", async () => {
            await setBilling(false)
            const p = await api.player("triple")
            const id = await idOf("triple")
            await api.db.update(users).set({ maxBots: 3 }).where(eq(users.id, id))
            const running = [
                await seedAccount(id, "Triple1", { desiredState: "running" }),
                await seedAccount(id, "Triple2", { desiredState: "running" }),
                await seedAccount(id, "Triple3", { desiredState: "running" }),
            ]
            const allRun = async () => expect((await p.api.accounts.list()).map(a => ({ id: a.id, entitled: a.entitled, desiredState: a.desiredState })))
                .toEqual(running.map(accountId => ({ id: accountId, entitled: true, desiredState: "running" })))

            await admin.api.billing.setLive({ live: true })

            expect(await periodsOf(id)).toMatchObject([{ planId: "basic", source: "trial" }])
            await allRun()
            expect(await audited("admin.billing.go_live")).toMatchObject({ meta: { limitsKept: 1 } })

            await api.db.delete(planPeriods).where(eq(planPeriods.userId, id))
            await api.db.transaction(tx => appendPeriod(tx, { userId: id, planId: "basic", days: 28, source: "purchase" }))
            await allRun()

            await admin.api.billing.setLive({ live: true })
            expect(await audited("admin.billing.go_live")).toMatchObject({ meta: { limitsKept: 0 } })
        })

        test("confirming an email grants exactly one 7-day trial", async () => {
            const p = await verifiedByLink("fresh")
            const periods = await periodsOf(p.id)
            expect(periods).toMatchObject([{ planId: "basic", source: "trial" }])
            expect(periods[0]!.endsAt.getTime() - periods[0]!.startsAt.getTime()).toBe(7 * DAY)
            const { id } = await p.api.accounts.create(newAccount())
            expect(await start(p, [id])).toBe("ok")
        })

        test("confirming a changed email grants nothing more", async () => {
            const p = await verifiedByLink("mover")
            await api.db.delete(planPeriods).where(eq(planPeriods.userId, p.id))
            await p.api.account.changeEmail({ email: "mover2@example.test", password: PASSWORD })
            await p.api.account.confirmEmailChange({ token: api.lastToken("mover2@example.test")! })
            expect(await periodsOf(p.id)).toEqual([])
        })

        test("a game account that ran on one player's trial is refused on another's", async () => {
            const first = await verifiedByLink("trial1")
            const account = await first.api.accounts.create(newAccount("Shared"))
            expect(await start(first, [account.id])).toBe("ok")
            await first.api.accounts.remove({ ids: [account.id] })

            const second = await verifiedByLink("trial2")
            const again = await second.api.accounts.create(newAccount("shared"))
            expect(await start(second, [again.id])).toBe(`FORBIDDEN ${TRIAL_GAME_ACCOUNT_USED}`)
            expect((await second.api.accounts.list())[0]!.desiredState).toBe("stopped")

            // The first player may run it again, and a paid plan runs it for anyone.
            const back = await first.api.accounts.create({ ...newAccount("Shared"), externalEvent: true })
            expect(await start(first, [back.id])).toBe("ok")
            await api.db.delete(planPeriods).where(eq(planPeriods.userId, second.id))
            await api.db.transaction(tx => appendPeriod(tx, { userId: second.id, planId: "basic", days: 28, source: "purchase" }))
            expect(await start(second, [again.id])).toBe("ok")
        })

        test("renaming a running account to a used game account is refused on a trial", async () => {
            const first = await verifiedByLink("trial3")
            const used = await first.api.accounts.create(newAccount("Veteran"))
            await start(first, [used.id])
            await first.api.accounts.remove({ ids: [used.id] })

            const second = await verifiedByLink("trial4")
            const decoy = await second.api.accounts.create(newAccount("Decoy"))
            expect(await start(second, [decoy.id])).toBe("ok")
            expect(await refusal(second.api.accounts.update({ id: decoy.id, name: "veteran" }))).toBe(`FORBIDDEN ${TRIAL_GAME_ACCOUNT_USED}`)
            expect((await second.api.accounts.list())[0]!.name).toBe("Decoy")
        })

        test("turning billing off puts players back on max_bots at once, and it is audited", async () => {
            const p = await api.player("lapsed")
            const id = await seedAccount(await idOf("lapsed"), "Lapsed1")
            expect(await periodsOf(await idOf("lapsed"))).toEqual([])
            expect(await start(p, [id])).toBe(`FORBIDDEN ${NO_PLAN}`)

            const periods = await api.db.select().from(planPeriods)
            expect(await admin.api.billing.setLive({ live: false })).toMatchObject({ billingLive: false, usersGettingTrial: expect.any(Number) })
            try {
                expect(await api.db.select().from(planPeriods)).toEqual(periods)
                expect(await audited("admin.billing.back_to_free")).toBeDefined()
                expect(await p.api.accounts.list()).toMatchObject([{ id, entitled: true }])
                expect(await start(p, [id])).toBe("ok")
                expect(await refusal(p.api.accounts.create(newAccount()))).toBe(`FORBIDDEN ${PLAN_LIMIT}`)
            } finally {
                await setBilling(true)
            }
        })
    })
})
