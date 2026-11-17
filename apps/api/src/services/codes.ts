import { randomBytes } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm"
import { CODE_INVALID, CODE_REVOKED, CODE_USED, codeFromBytes, codeStatus, normalizeCode, type LicenseCode, type Period, type PlanId } from "@gge/contracts"
import { licenseCodes, purchases, users, type Db } from "@gge/db"
import { audit } from "./audit.ts"
import { appendPeriod } from "./plans.ts"

type Reader = Pick<Db, "select">

/** One single-use code per seat of a Team purchase. */
export async function mintCodes(tx: Pick<Db, "insert">, purchase: { id: string; seats: number; days: number }, planId: PlanId) {
    await tx.insert(licenseCodes).values(Array.from({ length: purchase.seats }, () =>
        ({ purchaseId: purchase.id, planId, days: purchase.days, code: codeFromBytes(randomBytes(12)) })))
}

/** Codes with who redeemed each, oldest first. Only for the buyer and admins: the code itself is what redeems. */
export async function listCodes(db: Reader, where: SQL | undefined): Promise<LicenseCode[]> {
    const rows = await db.select({ code: licenseCodes, redeemer: users.username }).from(licenseCodes)
        .leftJoin(users, eq(users.id, licenseCodes.redeemedBy)).where(where).orderBy(asc(licenseCodes.createdAt), asc(licenseCodes.code))
    return rows.map(({ code, redeemer }) => ({
        id: code.id, purchaseId: code.purchaseId, planId: code.planId, days: code.days, code: code.code,
        status: codeStatus(code), redeemedBy: redeemer, redeemedAt: code.redeemedAt, createdAt: code.createdAt,
    }))
}

/** The codes of every purchase the user bought, newest purchase first. */
export async function myCodes(db: Reader, userId: string) {
    const bought = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.buyerId, userId)).orderBy(desc(purchases.createdAt))
    const codes = await listCodes(db, inArray(licenseCodes.purchaseId, bought.map(p => p.id)))
    const order = new Map(bought.map((p, i) => [p.id, i]))
    return codes.sort((a, b) => order.get(a.purchaseId)! - order.get(b.purchaseId)!)
}

const refused = (status: "NOT_FOUND" | "CONFLICT", message: string, code: string) => new ORPCError(status, { message, data: { code } })

/**
 * Turns a code into time on its plan for whoever redeems it, the buyer included. The lock on the code row makes two
 * redeemers take turns, so the second finds it used.
 */
export async function redeemCode(db: Db, userId: string, typed: string, now = new Date()): Promise<{ period: Period }> {
    const code = normalizeCode(typed)
    if (!code)
        throw refused("NOT_FOUND", "That code isn't valid. Check it and try again.", CODE_INVALID)
    return db.transaction(async tx => {
        const [found] = await tx.select().from(licenseCodes).where(eq(licenseCodes.code, code)).for("update")
        if (!found)
            throw refused("NOT_FOUND", "That code isn't valid. Check it and try again.", CODE_INVALID)
        if (found.redeemedAt)
            throw refused("CONFLICT", "This code has already been used.", CODE_USED)
        if (found.revokedAt)
            throw refused("CONFLICT", "This code was cancelled.", CODE_REVOKED)
        const period = await appendPeriod(tx, { userId, planId: found.planId, days: found.days, source: "code", codeId: found.id }, now)
        await tx.update(licenseCodes).set({ redeemedBy: userId, redeemedAt: now }).where(eq(licenseCodes.id, found.id))
        await audit(tx, { actorId: userId, action: "billing.code.redeem", targetType: "license_code", targetId: found.id })
        return { period }
    })
}

/** Cancels a code nobody has redeemed. A repeat changes nothing. */
export async function revokeCode(db: Db, actorId: string, codeId: string, now = new Date()) {
    await db.transaction(async tx => {
        const [found] = await tx.select().from(licenseCodes).where(eq(licenseCodes.id, codeId)).for("update")
        if (!found)
            throw new ORPCError("NOT_FOUND", { message: "No such code" })
        if (found.redeemedAt)
            throw refused("CONFLICT", "This code has already been used, so it can't be cancelled.", CODE_USED)
        if (found.revokedAt)
            return
        await tx.update(licenseCodes).set({ revokedAt: now }).where(and(eq(licenseCodes.id, codeId)))
        await audit(tx, { actorId, action: "admin.billing.revoke_code", targetType: "license_code", targetId: codeId, meta: { purchaseId: found.purchaseId } })
    })
}
