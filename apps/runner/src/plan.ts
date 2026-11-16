import { inArray } from "drizzle-orm"
import { entitledAccountIds, twinMainIds, type PlanOwner } from "@gge/contracts"
import { gameAccounts, type Db } from "@gge/db"

/**
 * Where these owners' accounts stand under their plans, worked out from every account each owner has:
 * which may run, and which is the main of each event twin.
 *
 * The API already refuses to start accounts beyond a plan, but a demotion, a lowered limit or a direct SQL edit
 * can leave them wanted, so the runner checks again here.
 */
export async function planStanding(db: Pick<Db, "select">, owners: Map<string, PlanOwner>) {
    const entitled = new Set<string>()
    const mainOf = new Map<string, string>()
    if (!owners.size)
        return { accounts: [], entitled, mainOf }
    const accounts = await db
        .select({
            ownerId: gameAccounts.ownerId, id: gameAccounts.id, serverId: gameAccounts.serverId, name: gameAccounts.name,
            externalEvent: gameAccounts.externalEvent, createdAt: gameAccounts.createdAt, desiredState: gameAccounts.desiredState, proxyId: gameAccounts.proxyId,
        })
        .from(gameAccounts)
        .where(inArray(gameAccounts.ownerId, [...owners.keys()]))
    for (const [ownerId, mine] of Map.groupBy(accounts, a => a.ownerId)) {
        for (const id of entitledAccountIds(owners.get(ownerId)!, mine))
            entitled.add(id)
        for (const [twin, main] of twinMainIds(mine))
            mainOf.set(twin, main)
    }
    return { accounts, entitled, mainOf }
}
