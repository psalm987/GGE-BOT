import { createHash } from "node:crypto"
import { and, inArray, ne } from "drizzle-orm"
import { trialGameAccounts, type Db } from "@gge/db"

type GameAccount = { serverId: number; name: string }

/** A main and its event twin are one game account, so they share a hash. */
export const trialAccountHash = ({ serverId, name }: GameAccount) =>
    createHash("sha256").update(`${serverId}:${name.toLowerCase()}`).digest("hex")

/**
 * Marks these game accounts as run on the user's trial, leaving any that already are as they were.
 * Returns false when one of them was run on another user's trial.
 */
export async function claimTrialAccounts(tx: Pick<Db, "select" | "insert">, userId: string, accounts: GameAccount[]) {
    const hashes = [...new Set(accounts.map(trialAccountHash))]
    if (!hashes.length)
        return true
    await tx.insert(trialGameAccounts).values(hashes.map(accountHash => ({ accountHash, userId }))).onConflictDoNothing()
    const [taken] = await tx.select({ hash: trialGameAccounts.accountHash }).from(trialGameAccounts)
        .where(and(inArray(trialGameAccounts.accountHash, hashes), ne(trialGameAccounts.userId, userId))).limit(1)
    return !taken
}
