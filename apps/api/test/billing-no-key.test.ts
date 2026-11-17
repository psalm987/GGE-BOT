import { eq } from "drizzle-orm"
import { afterAll, beforeAll, expect, test } from "vitest"
import { PAYMENTS_DISABLED, PAYSTACK_NOT_CONFIGURED } from "@gge/contracts"
import { appSettings, isBillingLive, packages, users } from "@gge/db"
import { PASSWORD, startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

const refusal = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code: string; data?: { code?: string } }) => `${e.code} ${e.data?.code}`)

test("without a Paystack key, going live is refused and the switch stays off", async () => {
    const admin = await api.signedInAdmin()
    expect(await admin.api.billing.status()).toMatchObject({ billingLive: false, paystackConfigured: false })
    const error = await admin.api.billing.setLive({ live: true }).catch(e => e as { code: string; data?: { code?: string } })
    expect(error).toMatchObject({ code: "PRECONDITION_FAILED", data: { code: PAYSTACK_NOT_CONFIGURED } })
    expect(await isBillingLive(api.db)).toBe(false)
})

test("without a Paystack key, nobody can pay online, even with billing live, and no webhook is accepted", async () => {
    await api.db.update(packages).set({ priceMinor: 500, currency: "USD" }).where(eq(packages.id, "basic_28"))
    await api.db.update(appSettings).set({ billingLive: true })
    const player = await api.player()
    const adminId = await api.newAdmin("keyless", "keyless@example.test")
    await api.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, adminId))
    const admin = api.client()
    await admin.api.auth.login({ login: "keyless", password: PASSWORD })

    for (const caller of [player, admin]) {
        expect((await caller.api.billing.config()).onlinePayments).toBe(false)
        expect(await refusal(caller.api.billing.checkout({ packageId: "basic_28" }))).toBe(`FORBIDDEN ${PAYMENTS_DISABLED}`)
    }
    const hook = await fetch(`${api.baseUrl}/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    expect(hook.status).toBe(401)
})
