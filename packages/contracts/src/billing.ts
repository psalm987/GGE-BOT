import * as z from "zod"
import { CODE_STATUSES } from "./codes.ts"
import { PERIOD_SOURCES, PLAN_IDS } from "./plans.ts"

/** A player called a billing endpoint while app_settings.billing_live is off. */
export const BILLING_NOT_LIVE = "BILLING_NOT_LIVE"
/** Comes with `data.params.count`: how many more points the redemption takes. */
export const NOT_ENOUGH_POINTS = "NOT_ENOUGH_POINTS"
/** Why a license code wasn't redeemed: no such code, already redeemed, or cancelled by an admin or a refund. */
export const CODE_INVALID = "CODE_INVALID"
export const CODE_USED = "CODE_USED"
export const CODE_REVOKED = "CODE_REVOKED"

/** Go-live was asked for on a deployment with no PAYSTACK_SECRET_KEY. */
export const PAYSTACK_NOT_CONFIGURED = "PAYSTACK_NOT_CONFIGURED"
/** A checkout with no Paystack key on the API, or by a player while billing is off. */
export const PAYMENTS_DISABLED = "PAYMENTS_DISABLED"

export const BillingStatus = z.object({
    billingLive: z.boolean(),
    paystackConfigured: z.boolean(),
    /** Whether the key is a test key (sk_test_), which takes no real money; null without a key. */
    paystackMode: z.enum(["test", "live"]).nullable(),
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

/** What the Plan page offers the caller. */
export const BillingConfig = z.object({
    /** Plans restrict players. While false, players see no plan, trial or points anywhere. */
    billingLive: z.boolean(),
    /** Whether the caller can pay online now: Paystack is set up and billing is live, or the caller is an admin trying it out. */
    onlinePayments: z.boolean(),
    /** Every active package in display order. One with no price (`priceMinor` null) is not sold online; the page says to contact support. */
    packages: z.array(Package),
    pointsCost: z.number().int(),
    pointsDays: z.number().int(),
})
export type BillingConfig = z.infer<typeof BillingConfig>

/** Where to send the buyer to pay. Paystack sends them back to /plan/return with `reference`. */
export const Checkout = z.object({ authorizationUrl: z.url(), reference: z.string() })
export type Checkout = z.infer<typeof Checkout>

/** A purchase paid online, as Paystack last reported it, and what it gave once delivered. */
export const PaymentOutcome = z.object({
    status: PurchaseStatus,
    /** null until the purchase is delivered. */
    delivered: z.object({
        /** The time a Basic package added; null for a Team package. */
        period: Period.nullable(),
        /** How many codes a Team package gave. They are listed with the buyer's codes. */
        codes: z.number().int(),
        points: z.number().int(),
    }).nullable(),
})
export type PaymentOutcome = z.infer<typeof PaymentOutcome>

/** The caller's plan, for the Plan page. */
export const MyPlan = z.object({
    /** Covering now; `endsAt` is when the whole queue runs out. null when no period covers now. */
    current: z.object({ planId: PlanId, isTrial: z.boolean(), endsAt: z.date() }).nullable(),
    /** The current period and every one queued behind it, soonest first. */
    periods: z.array(Period),
    /** How many accounts may run now; null for no limit (admins). */
    limit: z.number().int().nullable(),
    /** Accounts that count toward the limit: event twins ride free. */
    counted: z.number().int(),
})
export type MyPlan = z.infer<typeof MyPlan>

export const PlanRow = z.object({ id: PlanId, name: z.string(), maxAccounts: z.number().int() })
export type PlanRow = z.infer<typeof PlanRow>

export const AdminPeriod = Period.extend({
    /** The admin who granted it; null for other sources, or once that admin is gone. */
    grantedBy: z.string().nullable(),
    note: z.string().nullable(),
})
export type AdminPeriod = z.infer<typeof AdminPeriod>

export const AdminPointsEntry = PointsEntry.extend({ note: z.string().nullable(), createdBy: z.string().nullable() })
export type AdminPointsEntry = z.infer<typeof AdminPointsEntry>

/** Everything about one player's plan an admin manages on their page. */
export const UserPlan = z.object({
    current: MyPlan.shape.current,
    /** Every period, latest first. */
    periods: z.array(AdminPeriod),
    /** Replaces the plan's account limit for this player while billing is live; null follows the plan. */
    maxBotsOverride: z.number().int().nullable(),
    points: z.object({ balance: z.number().int(), history: z.array(AdminPointsEntry) }),
    /** The codes of the Team packages they bought. */
    codes: z.array(LicenseCode),
})
export type UserPlan = z.infer<typeof UserPlan>

export const GrantDays = z.object({
    userId: z.uuid(),
    planId: PlanId,
    days: z.number().int().min(1).max(366),
    note: z.string().trim().min(3).max(500),
})
export type GrantDays = z.infer<typeof GrantDays>
