import * as z from "zod"

/** Go-live was asked for on a deployment with no PAYSTACK_SECRET_KEY. */
export const PAYSTACK_NOT_CONFIGURED = "PAYSTACK_NOT_CONFIGURED"

export const BillingStatus = z.object({
    billingLive: z.boolean(),
    paystackConfigured: z.boolean(),
    /** Active, verified players with no trial yet: the ones going live would give one to. */
    usersGettingTrial: z.number().int(),
})
export type BillingStatus = z.infer<typeof BillingStatus>
