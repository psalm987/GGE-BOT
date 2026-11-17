import { ORPCError } from "@orpc/server"
import { and, asc, count, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm"
import { BILLING_NOT_LIVE, PAYSTACK_NOT_CONFIGURED, type BillingStatus } from "@gge/contracts"
import { appSettings, gameAccounts, isBillingLive, planPeriods, trialGameAccounts, users, type Db } from "@gge/db"
import type { Env } from "../env.ts"
import { audit } from "./audit.ts"
import { grantTrial } from "./plans.ts"
import { trialAccountHash } from "./trial-guard.ts"

type Reader = Pick<Db, "select">

/**
 * The switch, read under a lock that a go-live in flight waits for and that waits for one. A player whose email is
 * confirmed at that moment is then given their trial by this transaction or by the go-live, never by neither.
 */
export async function billingLiveForTrial(tx: Reader) {
    const [settings] = await tx.select({ billingLive: appSettings.billingLive }).from(appSettings).for("share")
    return settings?.billingLive ?? false
}

/** Players reach nothing in billing until it is live. An admin gets through, to try it out first. */
export async function requireBillingLive(db: Reader, role: "user" | "admin") {
    if (role !== "admin" && !await isBillingLive(db))
        throw new ORPCError("FORBIDDEN", { message: "Plans aren't available yet.", data: { code: BILLING_NOT_LIVE } })
}

/** Players a go-live gives a trial to: active, email confirmed, and never had one. */
const owedTrial = (db: Reader) => and(
    eq(users.status, "active"), eq(users.role, "user"), isNotNull(users.emailVerifiedAt),
    notExists(db.select({ one: sql`1` }).from(planPeriods).where(and(eq(planPeriods.userId, users.id), eq(planPeriods.source, "trial")))),
)

export async function billingStatus(db: Reader, env: Env): Promise<BillingStatus> {
    const [billingLive, [owed]] = await Promise.all([isBillingLive(db), db.select({ n: count() }).from(users).where(owedTrial(db))])
    return { billingLive, paystackConfigured: !!env.PAYSTACK_SECRET_KEY, usersGettingTrial: owed!.n }
}

const setSwitch = (tx: Pick<Db, "insert">, billingLive: boolean) => tx.insert(appSettings).values({ id: 1, billingLive })
    .onConflictDoUpdate({ target: appSettings.id, set: { billingLive, updatedAt: new Date() } })

/**
 * Turns plans on for every player. Each player owed a trial gets it in the same transaction, so nobody's bots stop
 * for want of a plan the moment the switch flips, and the game accounts they already have count as run on that trial.
 * A repeat finds nobody owed one.
 */
export async function goLive(db: Db, env: Env, actorId: string) {
    if (!env.PAYSTACK_SECRET_KEY)
        throw new ORPCError("PRECONDITION_FAILED", { message: "Set PAYSTACK_SECRET_KEY on the API before going live.", data: { code: PAYSTACK_NOT_CONFIGURED } })
    await db.transaction(async tx => {
        await setSwitch(tx, true)
        const now = new Date()
        const owed = await tx.select({ id: users.id }).from(users).where(owedTrial(tx)).orderBy(asc(users.id))
        for (const { id } of owed)
            await grantTrial(tx, id, now)
        const accounts = owed.length
            ? await tx.select({ ownerId: gameAccounts.ownerId, serverId: gameAccounts.serverId, name: gameAccounts.name }).from(gameAccounts)
                .where(inArray(gameAccounts.ownerId, owed.map(u => u.id))).orderBy(asc(gameAccounts.createdAt), asc(gameAccounts.id))
            : []
        // The oldest account keeps a game account that two players both have (a main under one, its event twin under the other).
        const recorded = accounts.length
            ? await tx.insert(trialGameAccounts).values(accounts.map(a => ({ accountHash: trialAccountHash(a), userId: a.ownerId })))
                .onConflictDoNothing().returning({ hash: trialGameAccounts.accountHash })
            : []
        await audit(tx, { actorId, action: "admin.billing.go_live", meta: { trialsGranted: owed.length, gameAccountsRecorded: recorded.length } })
    })
}

/** Puts every player back on users.max_bots. Periods, trials and everything bought stay as they are. */
export async function backToFree(db: Db, actorId: string) {
    await db.transaction(async tx => {
        await setSwitch(tx, false)
        await audit(tx, { actorId, action: "admin.billing.back_to_free" })
    })
}
