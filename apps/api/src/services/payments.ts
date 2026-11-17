import { randomUUID } from "node:crypto"
import { and, asc, count, eq } from "drizzle-orm"
import { PAYMENTS_DISABLED, type BillingConfig, type Checkout, type PaymentOutcome, type PublicUser, type PurchaseStatus } from "@gge/contracts"
import { isBillingLive, licenseCodes, packages, planPeriods, purchases, type Db } from "@gge/db"
import type { Ctx } from "../context.ts"
import { audit } from "./audit.ts"
import { clientLink } from "./email.ts"
import type { Paystack, PaystackTransaction } from "./paystack.ts"
import { periodColumns } from "./plans.ts"
import { billingSettings } from "./points.ts"
import { fulfil } from "./purchases.ts"
import { fail } from "../errors.ts"

type Reader = Pick<Db, "select">

/** Paystack statuses after which this transaction will never be paid. */
const NEVER_PAID = new Set(["failed", "abandoned", "reversed"])

/** A purchase still waiting for its money. A failed one may yet be paid: Paystack reports a checkout the buyer left open as abandoned. */
const waiting = (status: PurchaseStatus) => status === "pending" || status === "failed"

/** Paystack, when it may take this caller's money: with a key, from players once billing is live, and from an admin before then, to try it out. */
async function paystackFor(ctx: Pick<Ctx, "db" | "paystack">, role: PublicUser["role"]) {
    if (ctx.paystack && (role === "admin" || await isBillingLive(ctx.db)))
        return ctx.paystack
    return undefined
}

const paymentsDisabled = () =>
    fail("FORBIDDEN", PAYMENTS_DISABLED)

const providerDown = (cause: unknown) =>
    fail("BAD_GATEWAY", "PAYMENT_PROVIDER_DOWN", undefined, cause)

export async function billingConfig(ctx: Pick<Ctx, "db" | "paystack">, role: PublicUser["role"]): Promise<BillingConfig> {
    const [billingLive, paystack, offered, settings] = await Promise.all([
        isBillingLive(ctx.db),
        paystackFor(ctx, role),
        ctx.db.select().from(packages).where(eq(packages.active, true)).orderBy(asc(packages.sort), asc(packages.id)),
        billingSettings(ctx.db),
    ])
    return { billingLive, onlinePayments: !!paystack, packages: offered, pointsCost: settings.pointsRedeemCost, pointsDays: settings.pointsRedeemDays }
}

/**
 * Records a pending purchase of the package at today's price and opens a Paystack transaction for it. Paystack sends the buyer
 * back to /plan/return with the reference. A transaction Paystack wouldn't open leaves the purchase failed.
 */
export async function checkout(ctx: Pick<Ctx, "db" | "env" | "paystack">, user: Pick<PublicUser, "id" | "role" | "email">, packageId: string): Promise<Checkout> {
    const paystack = await paystackFor(ctx, user.role)
    if (!paystack)
        throw paymentsDisabled()
    const [pkg] = await ctx.db.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.active, true)))
    if (!pkg || pkg.priceMinor === null || pkg.currency === null)
        throw fail("NOT_FOUND", "PACKAGE_NOT_SOLD")
    if (!user.email)
        throw fail("BAD_REQUEST", "EMAIL_REQUIRED")
    const reference = `gge_${randomUUID()}`
    const [purchase] = await ctx.db.insert(purchases).values({
        buyerId: user.id, packageId: pkg.id, seats: pkg.seats, days: pkg.days, points: pkg.points,
        amountMinor: pkg.priceMinor, currency: pkg.currency, provider: "paystack", providerRef: reference, status: "pending",
    }).returning({ id: purchases.id })
    const authorizationUrl = await paystack.initialize({
        email: user.email, amount: pkg.priceMinor, currency: pkg.currency, reference,
        callbackUrl: clientLink(ctx, "/plan/return", {}), metadata: { purchaseId: purchase!.id },
    }).catch(async (error: unknown) => {
        await ctx.db.update(purchases).set({ status: "failed" }).where(eq(purchases.id, purchase!.id))
        throw providerDown(error)
    })
    await audit(ctx.db, { actorId: user.id, action: "billing.checkout", targetType: "purchase", targetId: purchase!.id, meta: { packageId: pkg.id } })
    return { authorizationUrl, reference }
}

/**
 * Applies what Paystack says about a purchase. A success for exactly the purchase's amount and currency marks it paid and
 * delivers it in one transaction, under the lock on its row, so a webhook and a confirm arriving together deliver once.
 * A paid or refunded purchase is left as it is.
 */
async function settle(db: Db, purchaseId: string, transaction: PaystackTransaction, now: Date) {
    await db.transaction(async tx => {
        const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for("update")
        if (!purchase || !waiting(purchase.status))
            return
        if (transaction.status === "success") {
            const target = { targetType: "purchase", targetId: purchaseId }
            if (transaction.amount !== purchase.amountMinor || transaction.currency !== purchase.currency) {
                await tx.update(purchases).set({ status: "failed" }).where(eq(purchases.id, purchaseId))
                await audit(tx, {
                    actorId: null, action: "billing.paystack.amount_mismatch", ...target,
                    meta: { expected: { amountMinor: purchase.amountMinor, currency: purchase.currency }, paid: { amountMinor: transaction.amount, currency: transaction.currency } },
                })
                return
            }
            await tx.update(purchases).set({ status: "paid", paidAt: now }).where(eq(purchases.id, purchaseId))
            if (purchase.buyerId)
                await fulfil(tx, purchaseId, now)
            else
                await audit(tx, { actorId: null, action: "billing.paystack.paid_without_buyer", ...target, meta: { packageId: purchase.packageId, amountMinor: purchase.amountMinor, currency: purchase.currency } })
            return
        }
        if (NEVER_PAID.has(transaction.status) && purchase.status === "pending")
            await tx.update(purchases).set({ status: "failed" }).where(eq(purchases.id, purchaseId))
    })
}

async function outcome(db: Reader, purchaseId: string): Promise<PaymentOutcome> {
    const [purchase] = await db.select({ status: purchases.status, points: purchases.points, fulfilledAt: purchases.fulfilledAt }).from(purchases).where(eq(purchases.id, purchaseId))
    if (!purchase!.fulfilledAt)
        return { status: purchase!.status, delivered: null }
    const [[period], [codes]] = await Promise.all([
        db.select(periodColumns).from(planPeriods).where(eq(planPeriods.purchaseId, purchaseId)),
        db.select({ n: count() }).from(licenseCodes).where(eq(licenseCodes.purchaseId, purchaseId)),
    ])
    return { status: purchase!.status, delivered: { period: period ?? null, codes: codes!.n, points: purchase!.points } }
}

/** Checks the buyer's payment with Paystack, never with what the browser says, and settles it. Repeating it changes nothing. */
export async function confirmPayment(ctx: Pick<Ctx, "db" | "paystack">, userId: string, reference: string, now = new Date()): Promise<PaymentOutcome> {
    const [purchase] = await ctx.db.select({ id: purchases.id, status: purchases.status }).from(purchases)
        .where(and(eq(purchases.provider, "paystack"), eq(purchases.providerRef, reference), eq(purchases.buyerId, userId)))
    if (!purchase)
        throw fail("NOT_FOUND", "PAYMENT_NOT_FOUND")
    if (waiting(purchase.status)) {
        if (!ctx.paystack)
            throw paymentsDisabled()
        const transaction = await ctx.paystack.verify(reference).catch((error: unknown) => { throw providerDown(error) })
        await settle(ctx.db, purchase.id, transaction, now)
    }
    return outcome(ctx.db, purchase.id)
}

/** What a webhook's paid reference comes to. A reference that isn't one of ours is ignored. */
export async function settleReference(db: Db, paystack: Paystack, reference: string, now = new Date()) {
    const [purchase] = await db.select({ id: purchases.id, status: purchases.status }).from(purchases)
        .where(and(eq(purchases.provider, "paystack"), eq(purchases.providerRef, reference)))
    if (purchase && waiting(purchase.status))
        await settle(db, purchase.id, await paystack.verify(reference), now)
}
