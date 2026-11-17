import * as z from "zod"
import { PERIOD_SOURCES, PLAN_IDS } from "./plans.ts"

/** A player called a billing endpoint while app_settings.billing_live is off. */
export const BILLING_NOT_LIVE = "BILLING_NOT_LIVE"
/** Comes with `needed`: how many more points the redemption takes. */
export const NOT_ENOUGH_POINTS = "NOT_ENOUGH_POINTS"

/** Go-live was asked for on a deployment with no PAYSTACK_SECRET_KEY. */
export const PAYSTACK_NOT_CONFIGURED = "PAYSTACK_NOT_CONFIGURED"

export const BillingStatus = z.object({
    billingLive: z.boolean(),
    paystackConfigured: z.boolean(),
    /** Active, verified players with no trial yet: the ones going live would give one to. */
    usersGettingTrial: z.number().int(),
})
export type BillingStatus = z.infer<typeof BillingStatus>

/** Why a points_ledger row exists. A purchase earns, a redemption spends, a refund takes back what its purchase earned. */
export const POINTS_REASONS = ["purchase", "redeem", "admin", "refund"] as const
export type PointsReason = typeof POINTS_REASONS[number]

const PlanId = z.enum(PLAN_IDS)

export const Period = z.object({
    id: z.uuid(),
    planId: PlanId,
    startsAt: z.date(),
    endsAt: z.date(),
    source: z.enum(PERIOD_SOURCES),
})
export type Period = z.infer<typeof Period>

export const PointsEntry = z.object({
    id: z.number().int(),
    delta: z.number().int(),
    reason: z.enum(POINTS_REASONS),
    createdAt: z.date(),
})
export type PointsEntry = z.infer<typeof PointsEntry>

/** A player's points and what they buy: `cost` points for `days` days of `plan`. `history` is newest first. */
export const PointsSummary = z.object({
    balance: z.number().int(),
    cost: z.number().int(),
    days: z.number().int(),
    plan: PlanId,
    history: z.array(PointsEntry),
})
export type PointsSummary = z.infer<typeof PointsSummary>

export const PointsRedemption = z.object({
    /** The balance right after this redemption. */
    balance: z.number().int(),
    period: Period,
})
export type PointsRedemption = z.infer<typeof PointsRedemption>

export const BillingSettings = z.object({
    trialDays: z.number().int().min(1).max(90),
    pointsRedeemCost: z.number().int().min(1).max(1000),
    pointsRedeemDays: z.number().int().min(1).max(366),
    pointsRedeemPlan: PlanId,
})
export type BillingSettings = z.infer<typeof BillingSettings>
