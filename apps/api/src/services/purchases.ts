import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm"
import type { AdminPurchase, Package, PlanId, Purchase, PurchaseStatus, RecordPurchase, UpdatePackage } from "@gge/contracts"
import { insertNotification, licenseCodes, packages, pointsLedger, purchases, users, type Db } from "@gge/db"
import { audit } from "./audit.ts"
import { listCodes, mintCodes } from "./codes.ts"
import { appendPeriod } from "./plans.ts"
import { alertsChanged } from "./realtime.ts"

type Reader = Pick<Db, "select">
type Tx = Pick<Db, "select" | "insert" | "update" | "delete">

export const listPackages = (db: Reader): Promise<Package[]> => db.select().from(packages).orderBy(asc(packages.sort), asc(packages.id))

export async function updatePackage(db: Db, actorId: string, { id, ...changes }: UpdatePackage): Promise<Package> {
    return db.transaction(async tx => {
        const [from] = await tx.select().from(packages).where(eq(packages.id, id)).for("update")
        if (!from)
            throw new ORPCError("NOT_FOUND", { message: "No such package" })
        const to = {
            priceMinor: changes.priceMinor === undefined ? from.priceMinor : changes.priceMinor,
            currency: changes.currency === undefined ? from.currency : changes.currency,
            points: changes.points ?? from.points,
            active: changes.active ?? from.active,
        }
        if ((to.priceMinor === null) !== (to.currency === null))
            throw new ORPCError("BAD_REQUEST", { message: "A price needs a currency, and a currency needs a price." })
        const [updated] = await tx.update(packages).set(to).where(eq(packages.id, id)).returning()
        const { priceMinor, currency, points, active } = from
        await audit(tx, { actorId, action: "admin.billing.update_package", targetType: "package", targetId: id, meta: { from: { priceMinor, currency, points, active }, to } })
        return updated!
    })
}

/** What paying for a package of each plan delivers: time for the buyer, or codes for the buyer to hand out. */
const DELIVERS: Record<PlanId, "period" | "codes"> = { basic: "period", team: "codes" }

/**
 * Delivers a paid purchase once: the buyer's period or the codes, and the points it earns, and tells the buyer. The
 * lock on the purchase row makes callers take turns, and `fulfilled_at` tells each later one that nothing is left to
 * do. Returns whether this call did the delivering.
 */
export async function fulfil(tx: Tx, purchaseId: string, now = new Date()) {
    const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for("update")
    if (!purchase)
        throw new Error(`No purchase ${purchaseId} to fulfil`)
    if (purchase.fulfilledAt)
        return false
    if (purchase.status !== "paid")
        throw new Error(`Purchase ${purchaseId} is ${purchase.status}, so it can't be fulfilled`)
    if (!purchase.buyerId)
        throw new Error(`Purchase ${purchaseId} has no buyer left to fulfil it for`)
    const [pkg] = await tx.select({ planId: packages.planId }).from(packages).where(eq(packages.id, purchase.packageId))
    const delivers = DELIVERS[pkg!.planId]
    if (delivers === "codes")
        await mintCodes(tx, purchase, pkg!.planId)
    else
        await appendPeriod(tx, { userId: purchase.buyerId, planId: pkg!.planId, days: purchase.days, source: "purchase", purchaseId }, now)
    if (purchase.points > 0)
        await tx.insert(pointsLedger).values({ userId: purchase.buyerId, delta: purchase.points, reason: "purchase", purchaseId })
    await tx.update(purchases).set({ fulfilledAt: now }).where(eq(purchases.id, purchaseId))
    await insertNotification(tx, {
        userId: purchase.buyerId, kind: "purchase_completed", dedupKey: `purchase_completed:${purchaseId}`,
        data: { packageId: purchase.packageId, seats: purchase.seats, points: purchase.points, codes: delivers === "codes" ? purchase.seats : 0 },
    })
    return true
}

/** A purchase as its buyer sees it. */
export const purchaseColumns = {
    id: purchases.id, packageId: purchases.packageId, planId: packages.planId, seats: purchases.seats, days: purchases.days, points: purchases.points,
    amountMinor: purchases.amountMinor, currency: purchases.currency, status: purchases.status, createdAt: purchases.createdAt, paidAt: purchases.paidAt,
}
const newestFirst = [desc(purchases.createdAt), desc(purchases.id)]

/** What the player bought, newest first. */
export const myPurchases = (db: Reader, userId: string): Promise<Purchase[]> =>
    db.select(purchaseColumns).from(purchases).innerJoin(packages, eq(packages.id, purchases.packageId))
        .where(eq(purchases.buyerId, userId)).orderBy(...newestFirst).limit(200)

async function adminPurchases(db: Reader, where: SQL | undefined, limit: number): Promise<AdminPurchase[]> {
    const rows = await db.select({
        ...purchaseColumns, buyerId: purchases.buyerId, provider: purchases.provider, providerRef: purchases.providerRef,
        note: purchases.note, recordedById: purchases.recordedBy, fulfilledAt: purchases.fulfilledAt,
    }).from(purchases).innerJoin(packages, eq(packages.id, purchases.packageId)).where(where).orderBy(...newestFirst).limit(limit)
    if (!rows.length)
        return []
    const userIds = [...new Set(rows.flatMap(r => [r.buyerId, r.recordedById]).filter(id => id !== null))]
    const [names, codes] = await Promise.all([
        userIds.length ? db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds)) : [],
        listCodes(db, inArray(licenseCodes.purchaseId, rows.map(r => r.id))),
    ])
    const nameOf = new Map(names.map(u => [u.id, u.username]))
    const codesOf = Map.groupBy(codes, c => c.purchaseId)
    return rows.map(({ recordedById, ...row }) => ({
        ...row,
        buyer: row.buyerId ? nameOf.get(row.buyerId) ?? null : null,
        recordedBy: recordedById ? nameOf.get(recordedById) ?? null : null,
        codes: codesOf.get(row.id) ?? [],
    }))
}

export const listPurchases = (db: Reader, { userId, status, before, limit }: { userId?: string; status?: PurchaseStatus; before?: Date; limit: number }) =>
    adminPurchases(db, and(
        userId ? eq(purchases.buyerId, userId) : undefined,
        status ? eq(purchases.status, status) : undefined,
        before ? lt(purchases.createdAt, before) : undefined,
    ), limit)

const onePurchase = async (db: Reader, id: string) => (await adminPurchases(db, eq(purchases.id, id), 1))[0]!

/** A sale made outside the app: recorded as paid and delivered in the same transaction. Works while billing is off. */
export async function recordPurchase(db: Db, actorId: string, input: RecordPurchase, now = new Date()) {
    const id = await db.transaction(async tx => {
        const [buyer] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId))
        if (!buyer)
            throw new ORPCError("NOT_FOUND", { message: "No such user" })
        const [pkg] = await tx.select().from(packages).where(eq(packages.id, input.packageId))
        if (!pkg)
            throw new ORPCError("NOT_FOUND", { message: "No such package" })
        const [purchase] = await tx.insert(purchases).values({
            buyerId: buyer.id, packageId: pkg.id, seats: pkg.seats, days: pkg.days, points: pkg.points,
            amountMinor: input.amountMinor ?? null, currency: input.currency ?? null,
            provider: "manual", status: "paid", paidAt: now, recordedBy: actorId, note: input.note || null,
        }).returning({ id: purchases.id })
        await fulfil(tx, purchase!.id, now)
        await alertsChanged(tx, buyer.id)
        await audit(tx, {
            actorId, action: "admin.billing.record_purchase", targetType: "purchase", targetId: purchase!.id,
            meta: { userId: buyer.id, packageId: pkg.id, amountMinor: input.amountMinor ?? null, currency: input.currency ?? null },
        })
        return purchase!.id
    })
    return onePurchase(db, id)
}

/**
 * Marks a paid purchase refunded, cancels its codes nobody has redeemed, and takes back the points it earned, which
 * may leave the buyer below zero. Time already given stays. A repeat changes nothing.
 */
export async function markRefunded(db: Db, actorId: string, purchaseId: string, now = new Date()) {
    await db.transaction(async tx => {
        const [purchase] = await tx.select({ status: purchases.status }).from(purchases).where(eq(purchases.id, purchaseId)).for("update")
        if (!purchase)
            throw new ORPCError("NOT_FOUND", { message: "No such purchase" })
        if (purchase.status === "refunded")
            return
        if (purchase.status !== "paid")
            throw new ORPCError("CONFLICT", { message: "Only a paid purchase can be refunded." })
        await tx.update(purchases).set({ status: "refunded" }).where(eq(purchases.id, purchaseId))
        const revoked = await tx.update(licenseCodes).set({ revokedAt: now })
            .where(and(eq(licenseCodes.purchaseId, purchaseId), isNull(licenseCodes.redeemedAt), isNull(licenseCodes.revokedAt)))
            .returning({ id: licenseCodes.id })
        const [earned] = await tx.select({ userId: pointsLedger.userId, delta: pointsLedger.delta }).from(pointsLedger)
            .where(and(eq(pointsLedger.purchaseId, purchaseId), eq(pointsLedger.reason, "purchase")))
        if (earned) {
            await tx.insert(pointsLedger).values({ userId: earned.userId, delta: -earned.delta, reason: "refund", purchaseId, createdBy: actorId })
            await alertsChanged(tx, earned.userId)
        }
        await audit(tx, {
            actorId, action: "admin.billing.refund", targetType: "purchase", targetId: purchaseId,
            meta: { codesRevoked: revoked.length, pointsTakenBack: earned?.delta ?? 0 },
        })
    })
    return onePurchase(db, purchaseId)
}
