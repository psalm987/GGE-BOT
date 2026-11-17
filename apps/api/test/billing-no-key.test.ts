import { afterAll, beforeAll, expect, test } from "vitest"
import { PAYSTACK_NOT_CONFIGURED } from "@gge/contracts"
import { isBillingLive } from "@gge/db"
import { startApi, type Api } from "./harness.ts"

let api: Api
beforeAll(async () => { api = await startApi() })
afterAll(() => api.close())

test("without a Paystack key, going live is refused and the switch stays off", async () => {
    const admin = await api.signedInAdmin()
    expect(await admin.api.billing.status()).toMatchObject({ billingLive: false, paystackConfigured: false })
    const error = await admin.api.billing.setLive({ live: true }).catch(e => e as { code: string; data?: { code?: string } })
    expect(error).toMatchObject({ code: "PRECONDITION_FAILED", data: { code: PAYSTACK_NOT_CONFIGURED } })
    expect(await isBillingLive(api.db)).toBe(false)
})
