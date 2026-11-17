import * as z from "zod"
import { CODE_STATUSES } from "./codes.ts"
import { PERIOD_SOURCES, PLAN_IDS } from "./plans.ts"

/** A player called a billing endpoint while app_settings.billing_live is off. */
export const BILLING_NOT_LIVE = "BILLING_NOT_LIVE"
/** Comes with `needed`: how many more points the redemption takes. */
export const NOT_ENOUGH_POINTS = "NOT_ENOUGH_POINTS"
/** Why a license code wasn't redeemed: no such code, already redeemed, or cancelled by an admin or a refund. */
export const CODE_INVALID = "CODE_INVALID"
export const CODE_USED = "CODE_USED"
export const CODE_REVOKED = "CODE_REVOKED"

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

/** The currencies Paystack charges in. */
export const CURRENCIES = ["GHS", "KES", "NGN", "ZAR", "USD"] as const
export const PURCHASE_PROVIDERS = ["manual", "paystack"] as const
export const PURCHASE_STATUSES = ["pending", "paid", "failed", "refunded"] as const
export const PurchaseStatus = z.enum(PURCHASE_STATUSES)
export type PurchaseStatus = z.infer<typeof PurchaseStatus>

const Currency = z.enum(CURRENCIES)
/** Money in the currency's smallest unit (pesewas, kobo, cents). */
const MinorAmount = z.number().int().min(0).max(2_000_000_000)

/** Something a player can buy: `seats` times `days` of a plan. A Basic package is time for the buyer; a Team package is one single-use code per seat. */
export const Package = z.object({
    id: z.string(),
    planId: PlanId,
    seats: z.number().int(),
    days: z.number().int(),
    /** null with `currency`: not sold online. */
    priceMinor: MinorAmount.nullable(),
    currency: Currency.nullable(),
    /** What a purchase earns the buyer. */
    points: z.number().int(),
    active: z.boolean(),
    sort: z.number().int(),
})
export type Package = z.infer<typeof Package>

export const UpdatePackage = z.object({
    id: z.string().min(1).max(64),
    priceMinor: MinorAmount.nullable().optional(),
    currency: Currency.nullable().optional(),
    points: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
})
export type UpdatePackage = z.infer<typeof UpdatePackage>

/** A Team code as its buyer and admins see it. Whoever holds `code` can redeem it. */
export const LicenseCode = z.object({
    id: z.uuid(),
    purchaseId: z.uuid(),
    planId: PlanId,
    days: z.number().int(),
    code: z.string(),
    status: z.enum(CODE_STATUSES),
    /** The redeemer's username; null when unused, or when that user is gone. */
    redeemedBy: z.string().nullable(),
    redeemedAt: z.date().nullable(),
    createdAt: z.date(),
})
export type LicenseCode = z.infer<typeof LicenseCode>

/** `seats`, `days` and `points` are the package's at the time of buying. */
export const Purchase = z.object({
    id: z.uuid(),
    packageId: z.string(),
    planId: PlanId,
    seats: z.number().int(),
    days: z.number().int(),
    points: z.number().int(),
    amountMinor: z.number().int().nullable(),
    currency: Currency.nullable(),
    status: PurchaseStatus,
    createdAt: z.date(),
    paidAt: z.date().nullable(),
})
export type Purchase = z.infer<typeof Purchase>

export const AdminPurchase = Purchase.extend({
    /** null once the buyer's account is deleted. */
    buyerId: z.uuid().nullable(),
    buyer: z.string().nullable(),
    provider: z.enum(PURCHASE_PROVIDERS),
    providerRef: z.string().nullable(),
    note: z.string().nullable(),
    /** The admin who recorded a manual purchase. */
    recordedBy: z.string().nullable(),
    /** When the time or codes and the points were delivered. */
    fulfilledAt: z.date().nullable(),
    codes: z.array(LicenseCode),
})
export type AdminPurchase = z.infer<typeof AdminPurchase>

export const RecordPurchase = z.object({
    userId: z.uuid(),
    packageId: z.string().min(1).max(64),
    amountMinor: MinorAmount.optional(),
    currency: Currency.optional(),
    note: z.string().trim().max(500).optional(),
}).refine(input => (input.amountMinor === undefined) === (input.currency === undefined), { path: ["currency"], message: "give an amount and its currency together" })
export type RecordPurchase = z.infer<typeof RecordPurchase>
