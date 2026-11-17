import { randomUUID } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { BILLING_NOT_LIVE, CODE_INVALID, CODE_REVOKED, CODE_USED } from "@gge/contracts"
import { appSettings, auditLog, licenseCodes, notifications, planPeriods, pointsLedger, purchases, users } from "@gge/db"
import { appendPeriod } from "../src/services/plans.ts"
import { pointsBalance } from "../src/services/points.ts"
import { fulfil } from "../src/services/purchases.ts"
import { startApi, type Api } from "./harness.ts"

let api: Api
let admin: Awaited<ReturnType<Api["signedInAdmin"]>>
beforeAll(async () => {
    api = await startApi()
    admin = await api.signedInAdmin()
    await setBilling(true)
})
afterAll(() => api.close())

const DAY = 24 * 60 * 60 * 1000
const setBilling = (billingLive: boolean) => api.db.update(appSettings).set({ billingLive })
const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string; data?: { code?: string } }) => `${e.code} ${e.data?.code}`)
const periodsOf = (userId: string) => api.db.select().from(planPeriods).where(eq(planPeriods.userId, userId)).orderBy(asc(planPeriods.startsAt))
const ledgerOf = (userId: string) => api.db.select().from(pointsLedger).where(eq(pointsLedger.userId, userId)).orderBy(asc(pointsLedger.id))
const codesOf = (purchaseId: string) => api.db.select().from(licenseCodes).where(eq(licenseCodes.purchaseId, purchaseId))
const noticesOf = async (userId: string) => (await api.db.select().from(notifications).where(eq(notifications.userId, userId)))
    .map(n => ({ kind: n.kind, data: n.data, accountId: n.accountId }))
const audited = async (action: string, targetId: string) =>
    (await api.db.select().from(auditLog).where(eq(auditLog.targetId, targetId))).filter(entry => entry.action === action)

async function player() {
    const username = `p${Math.random().toString(36).slice(2, 10)}`
    const p = await api.player(username)
    const [user] = await api.db.select({ id: users.id }).from(users).where(eq(users.username, username))
    return { ...p, id: user!.id, username }
}
const buy = (userId: string, packageId: string) => admin.api.billing.recordPurchase({ userId, packageId })

describe("packages", () => {
    test("three are seeded, none sold online yet", async () => {
        expect(await admin.api.billing.packages()).toMatchObject([
            { id: "basic_28", planId: "basic", seats: 1, days: 28, points: 1, priceMinor: null, currency: null, active: true },
            { id: "team5_28", planId: "team", seats: 5, days: 28, points: 5, priceMinor: null, currency: null, active: true },
            { id: "team10_28", planId: "team", seats: 10, days: 28, points: 10, priceMinor: null, currency: null, active: true },
        ])
    })

    test("an admin sets a price with its currency, and the change is audited", async () => {
        expect(await refusal(admin.api.billing.updatePackage({ id: "basic_28", priceMinor: 5000 }))).toBe("BAD_REQUEST PRICE_NEEDS_CURRENCY")
        expect(await refusal(admin.api.billing.updatePackage({ id: "nope", active: false }))).toBe("NOT_FOUND PACKAGE_NOT_FOUND")
        expect(await admin.api.billing.updatePackage({ id: "basic_28", priceMinor: 5000, currency: "GHS" })).toMatchObject({ priceMinor: 5000, currency: "GHS", points: 1 })
        expect((await audited("admin.billing.update_package", "basic_28")).at(-1)).toMatchObject({ meta: { from: { priceMinor: null }, to: { priceMinor: 5000, currency: "GHS" } } })
        expect(await admin.api.billing.updatePackage({ id: "basic_28", priceMinor: null, currency: null })).toMatchObject({ priceMinor: null, currency: null })
    })
})

describe("a manual purchase", () => {
    test("of Basic gives the buyer 28 days behind what they have, and 1 point", async () => {
        const p = await player()
        const existing = await api.db.transaction(tx => appendPeriod(tx, { userId: p.id, planId: "basic", days: 3, source: "admin" }))

        const purchase = await admin.api.billing.recordPurchase({ userId: p.id, packageId: "basic_28", amountMinor: 5000, currency: "GHS", note: "paid by MoMo" })
        expect(purchase).toMatchObject({
            buyer: p.username, packageId: "basic_28", planId: "basic", seats: 1, days: 28, points: 1, amountMinor: 5000, currency: "GHS",
            provider: "manual", status: "paid", recordedBy: "boss", note: "paid by MoMo", codes: [],
        })
        expect(purchase.paidAt).toBeInstanceOf(Date)
        expect(purchase.fulfilledAt).toBeInstanceOf(Date)

        const [, bought] = await periodsOf(p.id)
        expect(bought).toMatchObject({ planId: "basic", source: "purchase", purchaseId: purchase.id, startsAt: existing.endsAt })
        expect(bought!.endsAt.getTime() - bought!.startsAt.getTime()).toBe(28 * DAY)
        expect(await ledgerOf(p.id)).toMatchObject([{ delta: 1, reason: "purchase", purchaseId: purchase.id }])
        expect(await audited("admin.billing.record_purchase", purchase.id)).toMatchObject([{ meta: { userId: p.id, packageId: "basic_28" } }])
        expect(await p.api.billing.myPurchases()).toMatchObject([{ id: purchase.id, packageId: "basic_28", status: "paid", points: 1 }])
        expect(await p.api.billing.myCodes()).toEqual([])
    })

    test("of Team-5 gives the buyer 5 codes and 5 points, and no time", async () => {
        const p = await player()
        const purchase = await buy(p.id, "team5_28")
        expect(purchase.codes).toHaveLength(5)
        expect(new Set(purchase.codes.map(c => c.code)).size).toBe(5)
        for (const code of purchase.codes) {
            expect(code).toMatchObject({ planId: "team", days: 28, status: "unused", redeemedBy: null })
            expect(code.code).toMatch(/^GGE(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
        }
        expect(await periodsOf(p.id)).toEqual([])
        expect(await pointsBalance(api.db, p.id)).toBe(5)
        expect((await p.api.billing.myCodes()).map(c => c.code).toSorted()).toEqual(purchase.codes.map(c => c.code).toSorted())
    })

    test("of Team-10 gives 10 codes and 10 points", async () => {
        const p = await player()
        expect((await buy(p.id, "team10_28")).codes).toHaveLength(10)
        expect(await pointsBalance(api.db, p.id)).toBe(10)
    })

    test("needs a real user and package, and an amount with its currency", async () => {
        const p = await player()
        expect(await refusal(buy(randomUUID(), "basic_28"))).toBe("NOT_FOUND USER_NOT_FOUND")
        expect(await refusal(buy(p.id, "gold"))).toBe("NOT_FOUND PACKAGE_NOT_FOUND")
        expect(await refusal(admin.api.billing.recordPurchase({ userId: p.id, packageId: "basic_28", amountMinor: 100 }))).toBe("BAD_REQUEST undefined")
        expect(await api.db.select().from(purchases).where(eq(purchases.buyerId, p.id))).toEqual([])
    })

    test("the list filters by buyer and status and pages by date", async () => {
        const p = await player()
        const first = await buy(p.id, "basic_28")
        const second = await buy(p.id, "team5_28")
        await admin.api.billing.markRefunded({ purchaseId: first.id })
        expect((await admin.api.billing.purchases({ userId: p.id })).map(x => x.id)).toEqual([second.id, first.id])
        expect((await admin.api.billing.purchases({ userId: p.id, status: "refunded" })).map(x => x.id)).toEqual([first.id])
        expect((await admin.api.billing.purchases({ userId: p.id, before: second.createdAt })).map(x => x.id)).toEqual([first.id])
        expect((await admin.api.billing.purchases({ userId: p.id, limit: 1 })).map(x => x.id)).toEqual([second.id])
    })
})

describe("fulfil", () => {
    const paidUnfulfilled = async (buyerId: string, packageId: "basic_28" | "team5_28", seats: number, points: number) =>
        (await api.db.insert(purchases).values({ buyerId, packageId, seats, days: 28, points, provider: "paystack", providerRef: `gge_${randomUUID()}`, status: "paid", paidAt: new Date() }).returning())[0]!.id
    const run = (purchaseId: string) => api.db.transaction(tx => fulfil(tx, purchaseId))

    test("run again and at the same moment, a Team purchase is delivered once", async () => {
        const p = await player()
        const id = await paidUnfulfilled(p.id, "team5_28", 5, 5)
        const results = await Promise.all(Array.from({ length: 4 }, () => run(id)))
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await run(id)).toBe(false)
        expect(await codesOf(id)).toHaveLength(5)
        expect(await ledgerOf(p.id)).toMatchObject([{ delta: 5, reason: "purchase" }])
        expect(await noticesOf(p.id)).toEqual([{ kind: "purchase_completed", data: { packageId: "team5_28", seats: 5, points: 5, codes: 5 }, accountId: null }])
    })

    test("run again and at the same moment, a Basic purchase gives one period", async () => {
        const p = await player()
        const id = await paidUnfulfilled(p.id, "basic_28", 1, 1)
        await Promise.all(Array.from({ length: 4 }, () => run(id)))
        await run(id)
        expect(await periodsOf(p.id)).toHaveLength(1)
        expect(await pointsBalance(api.db, p.id)).toBe(1)
        expect(await noticesOf(p.id)).toEqual([{ kind: "purchase_completed", data: { packageId: "basic_28", seats: 1, points: 1, codes: 0 }, accountId: null }])
    })

    test("a purchase that isn't paid delivers nothing", async () => {
        const p = await player()
        const [pending] = await api.db.insert(purchases).values({ buyerId: p.id, packageId: "team5_28", seats: 5, days: 28, points: 5, provider: "paystack", status: "pending" }).returning()
        await expect(run(pending!.id)).rejects.toThrow(/pending/)
        expect(await codesOf(pending!.id)).toEqual([])
        expect(await pointsBalance(api.db, p.id)).toBe(0)
        expect(await noticesOf(p.id)).toEqual([])
    })

    test("the ledger takes one purchase row per purchase", async () => {
        const p = await player()
        const { id: purchaseId } = await buy(p.id, "basic_28")
        await expect(api.db.insert(pointsLedger).values({ userId: p.id, delta: 1, reason: "purchase", purchaseId })).rejects.toMatchObject({ cause: { code: "23505" } })
    })
})

describe("redeeming a code", () => {
    test("gives the redeemer 28 days of Team and marks the code used", async () => {
        const [buyer, friend] = [await player(), await player()]
        const { codes } = await buy(buyer.id, "team5_28")
        const { period } = await friend.api.billing.redeemCode({ code: codes[0]!.code })
        expect(period).toMatchObject({ planId: "team", source: "code" })
        expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(28 * DAY)
        expect(await periodsOf(friend.id)).toMatchObject([{ codeId: codes[0]!.id }])
        expect((await buyer.api.billing.myCodes()).find(c => c.id === codes[0]!.id)).toMatchObject({ status: "redeemed", redeemedBy: friend.username })
        // Codes earn the redeemer nothing, and are the buyer's alone to see.
        expect(await pointsBalance(api.db, friend.id)).toBe(0)
        expect(await friend.api.billing.myCodes()).toEqual([])
        expect(await audited("billing.code.redeem", codes[0]!.id)).toHaveLength(1)
    })

    test("a buyer may redeem their own code", async () => {
        const buyer = await player()
        const { codes } = await buy(buyer.id, "team5_28")
        expect(await refusal(buyer.api.billing.redeemCode({ code: codes[0]!.code }))).toBe("ok")
        expect(await periodsOf(buyer.id)).toMatchObject([{ planId: "team", source: "code" }])
    })

    test("a code typed in lower case with spaces and look-alike letters is accepted", async () => {
        const buyer = await player()
        const { codes } = await buy(buyer.id, "team10_28")
        const typed = (code: string) => code.toLowerCase().replace("gge-", "gge ").replace("-", " ").replace(/0/g, "o").replace(/1/, "i").replace(/1/g, "L")
        for (const { code } of codes)
            expect(await refusal(buyer.api.billing.redeemCode({ code: typed(code) })), typed(code)).toBe("ok")
        expect(await periodsOf(buyer.id)).toHaveLength(10)
    })

    test("two players redeeming one code at the same moment: exactly one wins", async () => {
        const [buyer, a, b] = [await player(), await player(), await player()]
        const { codes } = await buy(buyer.id, "team5_28")
        const code = codes[0]!.code
        const results = await Promise.all([a, b].map(p => refusal(p.api.billing.redeemCode({ code }))))
        expect(results.toSorted()).toEqual([`CONFLICT ${CODE_USED}`, "ok"])
        expect([...await periodsOf(a.id), ...await periodsOf(b.id)]).toHaveLength(1)
    })

    test("a refused code says which refusal it is and reads in English", async () => {
        const friend = await player()
        const error = await friend.api.billing.redeemCode({ code: "GGE-0000-0000-0000" }).catch((e: unknown) => e)
        expect(error).toMatchObject({ code: "NOT_FOUND", message: "That code isn't valid. Check it and try again.", data: { code: CODE_INVALID, params: {} } })
    })

    test("an unknown, a used and a revoked code are each refused", async () => {
        const [buyer, friend] = [await player(), await player()]
        const { codes } = await buy(buyer.id, "team5_28")
        expect(await refusal(friend.api.billing.redeemCode({ code: "GGE-0000-0000-0000" }))).toBe(`NOT_FOUND ${CODE_INVALID}`)
        expect(await refusal(friend.api.billing.redeemCode({ code: "not a code" }))).toBe(`NOT_FOUND ${CODE_INVALID}`)

        await buyer.api.billing.redeemCode({ code: codes[0]!.code })
        expect(await refusal(friend.api.billing.redeemCode({ code: codes[0]!.code }))).toBe(`CONFLICT ${CODE_USED}`)

        await admin.api.billing.revokeCode({ codeId: codes[1]!.id })
        await admin.api.billing.revokeCode({ codeId: codes[1]!.id })
        expect(await audited("admin.billing.revoke_code", codes[1]!.id)).toHaveLength(1)
        expect(await refusal(friend.api.billing.redeemCode({ code: codes[1]!.code }))).toBe(`CONFLICT ${CODE_REVOKED}`)
        expect(await refusal(admin.api.billing.revokeCode({ codeId: codes[0]!.id }))).toBe("CONFLICT CANCEL_CODE_USED")
        expect(await periodsOf(friend.id)).toEqual([])
        expect((await buyer.api.billing.myCodes()).map(c => c.status).toSorted()).toEqual(["redeemed", "revoked", "unused", "unused", "unused"])
    })

    test("wrong guesses run out, and right codes don't count", async () => {
        const [buyer, guesser] = [await player(), await player()]
        const { codes } = await buy(buyer.id, "team10_28")
        for (const { code } of codes)
            expect(await refusal(buyer.api.billing.redeemCode({ code }))).toBe("ok")
        const guess = () => refusal(guesser.api.billing.redeemCode({ code: "GGE-0000-0000-0000" }))
        for (let i = 0; i < 10; i++)
            expect(await guess()).toBe(`NOT_FOUND ${CODE_INVALID}`)
        expect(await guess()).toBe("TOO_MANY_REQUESTS TOO_MANY_ATTEMPTS")
    })
})

describe("a refund", () => {
    test("cancels the unredeemed codes and takes the points back once", async () => {
        const [buyer, friend] = [await player(), await player()]
        const purchase = await buy(buyer.id, "team5_28")
        await friend.api.billing.redeemCode({ code: purchase.codes[0]!.code })
        await admin.api.billing.adjustPoints({ userId: buyer.id, delta: -2, note: "spent elsewhere" })

        const refunded = await admin.api.billing.markRefunded({ purchaseId: purchase.id })
        expect(refunded.status).toBe("refunded")
        expect(refunded.codes.map(c => c.status).toSorted()).toEqual(["redeemed", "revoked", "revoked", "revoked", "revoked"])
        expect(await pointsBalance(api.db, buyer.id)).toBe(-2)
        expect(await refusal(buyer.api.billing.redeemCode({ code: purchase.codes[1]!.code }))).toBe(`CONFLICT ${CODE_REVOKED}`)
        // What was redeemed before the refund stays with the player who redeemed it.
        expect(await periodsOf(friend.id)).toHaveLength(1)

        expect((await admin.api.billing.markRefunded({ purchaseId: purchase.id })).status).toBe("refunded")
        expect(await pointsBalance(api.db, buyer.id)).toBe(-2)
        expect((await ledgerOf(buyer.id)).filter(row => row.reason === "refund")).toMatchObject([{ delta: -5, purchaseId: purchase.id }])
        expect(await audited("admin.billing.refund", purchase.id)).toMatchObject([{ meta: { codesRevoked: 4, pointsTakenBack: 5 } }])
        expect(await refusal(admin.api.billing.markRefunded({ purchaseId: randomUUID() }))).toBe("NOT_FOUND PURCHASE_NOT_FOUND")
    })
})

describe("while billing is off", () => {
    beforeAll(() => setBilling(false))
    afterAll(() => setBilling(true))

    test("an admin still records purchases, and players reach none of it", async () => {
        const p = await player()
        const { codes } = await buy(p.id, "team5_28")
        expect(codes).toHaveLength(5)
        expect(await refusal(p.api.billing.redeemCode({ code: codes[0]!.code }))).toBe(`FORBIDDEN ${BILLING_NOT_LIVE}`)
        expect(await refusal(p.api.billing.myCodes())).toBe(`FORBIDDEN ${BILLING_NOT_LIVE}`)
        expect(await refusal(p.api.billing.myPurchases())).toBe(`FORBIDDEN ${BILLING_NOT_LIVE}`)
        expect((await codesOf(codes[0]!.purchaseId)).every(c => c.redeemedAt === null)).toBe(true)
    })

    test("an unverified player is refused before anything else", async () => {
        const p = await api.signup()
        expect(await refusal(p.api.billing.redeemCode({ code: "GGE-0000-0000-0000" }))).toBe("FORBIDDEN EMAIL_VERIFY_REQUIRED")
    })
})
