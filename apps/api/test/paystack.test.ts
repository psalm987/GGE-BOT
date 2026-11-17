import { createHmac } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { PAYMENTS_DISABLED } from "@gge/contracts"
import { appSettings, auditLog, notifications, packages, planPeriods, pointsLedger, purchases, users } from "@gge/db"
import { validWebhookSignature } from "../src/services/paystack.ts"
import { PASSWORD, startApi, type Api } from "./harness.ts"

const SECRET = "sk_test_stub"
const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string; data?: { code?: string } }) => `${e.code} ${e.data?.code}`)

type Transaction = { status: string; amount: number; currency: string }

/** Paystack's two endpoints as a real account answers them: a new transaction reads "abandoned" until the buyer pays. */
async function stubPaystack() {
    const transactions = new Map<string, Transaction>()
    const initialized: { authorization: string | undefined; body: Record<string, unknown> }[] = []
    const send = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    const read = async (req: IncomingMessage) => {
        const chunks: Buffer[] = []
        for await (const chunk of req)
            chunks.push(chunk as Buffer)
        return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {}
    }
    const server = createServer((req, res) => void (async () => {
        if (req.method === "POST" && req.url === "/transaction/initialize") {
            const body = await read(req)
            const reference = body.reference as string
            initialized.push({ authorization: req.headers.authorization, body })
            transactions.set(reference, { status: "abandoned", amount: body.amount as number, currency: body.currency as string })
            return send(res, 200, { status: true, message: "Authorization URL created", data: { authorization_url: `https://checkout.paystack.test/${reference}`, access_code: "code", reference } })
        }
        const verify = req.method === "GET" && req.url?.match(/^\/transaction\/verify\/(.+)$/)
        const transaction = verify && transactions.get(decodeURIComponent(verify[1]!))
        if (verify && transaction)
            return send(res, 200, { status: true, message: "Verification successful", data: { id: 1, ...transaction, reference: decodeURIComponent(verify[1]!), paid_at: null } })
        send(res, 400, { status: false, message: "Transaction reference not found" })
    })())
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    return {
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        initialized,
        /** The buyer pays, by default exactly what the transaction asked for. */
        pay: (reference: string, paid: Partial<Transaction> = {}) => transactions.set(reference, { ...transactions.get(reference)!, status: "success", ...paid }),
        setStatus: (reference: string, status: string) => transactions.set(reference, { ...transactions.get(reference)!, status }),
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}

let paystack: Awaited<ReturnType<typeof stubPaystack>>
let api: Api
beforeAll(async () => {
    paystack = await stubPaystack()
    api = await startApi({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_BASE_URL: paystack.url })
    await api.db.update(packages).set({ priceMinor: 500, currency: "USD" }).where(eq(packages.id, "basic_28"))
    await api.db.update(packages).set({ priceMinor: 2000, currency: "USD" }).where(eq(packages.id, "team5_28"))
})
afterAll(async () => {
    await api.close()
    await paystack.close()
})

const setBilling = (billingLive: boolean) => api.db.update(appSettings).set({ billingLive })
const purchaseOf = async (reference: string) => (await api.db.select().from(purchases).where(eq(purchases.providerRef, reference)))[0]!
const periodsOf = (purchaseId: string) => api.db.select().from(planPeriods).where(eq(planPeriods.purchaseId, purchaseId))
const earned = (purchaseId: string) => api.db.select().from(pointsLedger).where(and(eq(pointsLedger.purchaseId, purchaseId), eq(pointsLedger.reason, "purchase")))
const audited = (action: string, targetId: string) => api.db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)))

/** Paystack telling us about an event, signed with `secret`. */
function webhook(event: unknown, secret = SECRET, signature?: string) {
    const body = JSON.stringify(event)
    return fetch(`${api.baseUrl}/webhooks/paystack`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(signature !== "" && { "x-paystack-signature": signature ?? createHmac("sha512", secret).update(body).digest("hex") }) },
        body,
    })
}
const chargeSuccess = (reference: string) => webhook({ event: "charge.success", data: { reference, status: "success", amount: 500, currency: "USD" } })

describe("while billing is live", () => {
    beforeEach(() => setBilling(true))

    test("checkout records a pending purchase at today's price and returns Paystack's checkout page", async () => {
        const player = await api.player("buyer")
        const { authorizationUrl, reference } = await player.api.billing.checkout({ packageId: "basic_28" })

        expect(reference).toMatch(/^gge_[0-9a-f-]{36}$/)
        expect(authorizationUrl).toBe(`https://checkout.paystack.test/${reference}`)
        const purchase = await purchaseOf(reference)
        expect(purchase).toMatchObject({ provider: "paystack", status: "pending", packageId: "basic_28", seats: 1, days: 28, points: 1, amountMinor: 500, currency: "USD", paidAt: null, fulfilledAt: null })
        expect(paystack.initialized.at(-1)).toEqual({
            authorization: `Bearer ${SECRET}`,
            body: { email: player.email, amount: 500, currency: "USD", reference, callback_url: "https://app.test/plan/return", metadata: { purchaseId: purchase.id } },
        })
    })

    test("the player sees what is sold online and that they can pay", async () => {
        const config = await (await api.player()).api.billing.config()
        expect(config.onlinePayments).toBe(true)
        expect(config.packages.map(p => [p.id, p.priceMinor, p.currency])).toEqual([["basic_28", 500, "USD"], ["team5_28", 2000, "USD"]])
        expect(config).toMatchObject({ pointsCost: 8, pointsDays: 28 })
    })

    test("a package with no price can't be bought online", async () => {
        expect(await refusal((await api.player()).api.billing.checkout({ packageId: "team10_28" }))).toBe("NOT_FOUND undefined")
    })

    test("confirming a successful payment delivers it once, and confirming again changes nothing", async () => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference)

        const first = await player.api.billing.confirm({ reference })
        const again = await player.api.billing.confirm({ reference })

        expect(first).toMatchObject({ status: "paid", delivered: { period: { planId: "basic", source: "purchase" }, codes: 0, points: 1 } })
        expect(again).toEqual(first)
        const purchase = await purchaseOf(reference)
        expect(purchase).toMatchObject({ status: "paid", paidAt: expect.any(Date), fulfilledAt: expect.any(Date) })
        expect(await periodsOf(purchase.id)).toHaveLength(1)
        expect(await earned(purchase.id)).toHaveLength(1)
    })

    test("a Team package's codes are delivered to its buyer", async () => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "team5_28" })
        paystack.pay(reference)
        expect(await player.api.billing.confirm({ reference })).toEqual({ status: "paid", delivered: { period: null, codes: 5, points: 5 } })
        expect(await player.api.billing.myCodes()).toHaveLength(5)
    })

    test("a checkout the buyer left reads failed, and is delivered if they pay after all", async () => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })

        expect(await player.api.billing.confirm({ reference })).toEqual({ status: "failed", delivered: null })
        paystack.pay(reference)
        expect(await player.api.billing.confirm({ reference })).toMatchObject({ status: "paid", delivered: { points: 1 } })
    })

    test("a payment Paystack is still processing reads pending", async () => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })
        paystack.setStatus(reference, "ongoing")
        expect(await player.api.billing.confirm({ reference })).toEqual({ status: "pending", delivered: null })
    })

    test.each([
        ["a smaller amount", { amount: 400 }],
        ["another currency", { currency: "NGN" }],
    ])("a success for %s delivers nothing and is recorded for admins", async (_, paid) => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference, paid)

        expect(await player.api.billing.confirm({ reference })).toEqual({ status: "failed", delivered: null })
        const purchase = await purchaseOf(reference)
        expect(purchase.fulfilledAt).toBeNull()
        expect(await periodsOf(purchase.id)).toEqual([])
        expect(await audited("billing.paystack.amount_mismatch", purchase.id)).toMatchObject([{ meta: { expected: { amountMinor: 500, currency: "USD" } } }])
    })

    test("another player can't confirm someone's payment", async () => {
        const { reference } = await (await api.player()).api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference)
        expect(await refusal((await api.player()).api.billing.confirm({ reference }))).toBe("NOT_FOUND undefined")
        expect((await purchaseOf(reference)).status).toBe("pending")
    })

    test("a signed charge.success delivers the payment after checking it with Paystack", async () => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })

        expect((await chargeSuccess(reference)).status, "the event alone proves nothing").toBe(200)
        expect((await purchaseOf(reference)).status).toBe("failed")

        paystack.pay(reference)
        expect((await chargeSuccess(reference)).status).toBe(200)
        const purchase = await purchaseOf(reference)
        expect(purchase).toMatchObject({ status: "paid", fulfilledAt: expect.any(Date) })
        expect(await periodsOf(purchase.id)).toHaveLength(1)
    })

    test("a webhook with a wrong or missing signature is refused and changes nothing", async () => {
        const { reference } = await (await api.player()).api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference)
        const event = { event: "charge.success", data: { reference } }

        expect((await webhook(event, "sk_test_someone_else")).status).toBe(401)
        expect((await webhook(event, SECRET, "")).status).toBe(401)
        expect((await webhook(event, SECRET, "deadbeef")).status).toBe(401)
        expect((await purchaseOf(reference)).status).toBe("pending")
    })

    test("a webhook for a reference that isn't ours, or another event, is acknowledged and ignored", async () => {
        expect((await chargeSuccess("someone_elses_ref")).status).toBe(200)
        expect((await webhook({ event: "transfer.success", data: { reference: "x" } })).status).toBe(200)
    })

    test("a webhook and a confirm arriving together deliver once", async () => {
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference)

        const [hook, confirmed] = await Promise.all([chargeSuccess(reference), player.api.billing.confirm({ reference })])

        expect(hook.status).toBe(200)
        expect(confirmed).toMatchObject({ status: "paid" })
        const purchase = await purchaseOf(reference)
        expect(await periodsOf(purchase.id)).toHaveLength(1)
        expect(await earned(purchase.id)).toHaveLength(1)
        expect(await api.db.select().from(notifications).where(eq(notifications.dedupKey, `purchase_completed:${purchase.id}`))).toHaveLength(1)
    })

    test("a payment whose buyer deleted their account is marked paid, delivered to nobody, and recorded for admins", async () => {
        const player = await api.player("leaver")
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference)
        await api.db.delete(users).where(eq(users.username, "leaver"))

        expect((await chargeSuccess(reference)).status).toBe(200)

        const purchase = await purchaseOf(reference)
        expect(purchase).toMatchObject({ status: "paid", buyerId: null, paidAt: expect.any(Date), fulfilledAt: null })
        expect(await audited("billing.paystack.paid_without_buyer", purchase.id)).toMatchObject([{ actorId: null, meta: { packageId: "basic_28", amountMinor: 500, currency: "USD" } }])
        expect((await chargeSuccess(reference)).status).toBe(200)
        expect(await audited("billing.paystack.paid_without_buyer", purchase.id)).toHaveLength(1)
    })
})

describe("while billing is off", () => {
    beforeEach(() => setBilling(false))

    test("a player can't pay online, and is told so", async () => {
        const player = await api.player()
        expect((await player.api.billing.config()).onlinePayments).toBe(false)
        expect(await refusal(player.api.billing.checkout({ packageId: "basic_28" }))).toBe(`FORBIDDEN ${PAYMENTS_DISABLED}`)
    })

    test("an admin can buy in test mode, and the payment is delivered", async () => {
        const adminId = await api.newAdmin("tester", "tester@example.test")
        await api.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, adminId))
        const admin = api.client()
        await admin.api.auth.login({ login: "tester", password: PASSWORD })

        expect((await admin.api.billing.config()).onlinePayments).toBe(true)
        const { reference } = await admin.api.billing.checkout({ packageId: "basic_28" })
        paystack.pay(reference)
        expect(await admin.api.billing.confirm({ reference })).toMatchObject({ status: "paid", delivered: { period: { planId: "basic" } } })
    })

    test("a payment made while billing was live is still delivered", async () => {
        await setBilling(true)
        const player = await api.player()
        const { reference } = await player.api.billing.checkout({ packageId: "basic_28" })
        await setBilling(false)
        paystack.pay(reference)

        expect((await chargeSuccess(reference)).status).toBe(200)
        expect(await player.api.billing.confirm({ reference })).toMatchObject({ status: "paid", delivered: { points: 1 } })
    })
})

describe("validWebhookSignature", () => {
    const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "gge_1" } }))
    const signed = (secret: string, bytes = body) => createHmac("sha512", secret).update(bytes).digest("hex")

    test("accepts the HMAC-SHA512 of the exact body under the secret, in either case", () => {
        expect(validWebhookSignature(body, signed(SECRET), SECRET)).toBe(true)
        expect(validWebhookSignature(body, signed(SECRET).toUpperCase(), SECRET)).toBe(true)
    })

    test("refuses another secret, a changed body, a short or garbled signature, and none", () => {
        expect(validWebhookSignature(body, signed("sk_test_other"), SECRET)).toBe(false)
        expect(validWebhookSignature(Buffer.from(`${body.toString()} `), signed(SECRET), SECRET)).toBe(false)
        expect(validWebhookSignature(body, signed(SECRET).slice(0, 64), SECRET)).toBe(false)
        expect(validWebhookSignature(body, `zz${signed(SECRET).slice(2)}`, SECRET)).toBe(false)
        expect(validWebhookSignature(body, undefined, SECRET)).toBe(false)
    })
})
