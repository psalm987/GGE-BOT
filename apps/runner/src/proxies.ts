import { and, count, eq, inArray, isNotNull } from "drizzle-orm"
import { gameAccounts, loadPlanOwners, planOwnerColumns, proxies, users, type Db } from "@gge/db"
import { planStanding } from "./plan.ts"

/** The proxy a bot connects through. Only the runner's key opens `urlSealed`. */
export type SpecProxy = { id: string; urlSealed: Buffer }

/**
 * Gives every account that should run a place on a proxy, and keeps it there: an account moves only when its
 * proxy is turned off or removed. Run it before loadSpecs.
 *
 * - An account without a usable proxy gets the enabled proxy with the fewest accounts that is still under its
 *   max_accounts; among equals, the lowest id. With no room anywhere it is left without one.
 * - An event twin holds no place. loadSpecs gives it its main's proxy, so the main gets a place even when
 *   only the twin is wanted.
 * - A place is counted for every account assigned to a proxy, running or not, so a stopped account comes back
 *   on the same address.
 *
 * Returns how many accounts it moved. With no proxies configured it changes nothing.
 */
export async function assignProxies(db: Db) {
    const [configured] = await db.select({ id: proxies.id }).from(proxies).limit(1)
    if (!configured)
        return 0
    return db.transaction(async tx => {
        // Locking the pool makes two assigners take turns, so they can't both take a proxy's last place.
        const pool = await tx.select({ id: proxies.id, enabled: proxies.enabled, maxAccounts: proxies.maxAccounts })
            .from(proxies).orderBy(proxies.id).for("update")
        const owners = await tx.selectDistinct(planOwnerColumns)
            .from(gameAccounts).innerJoin(users, eq(users.id, gameAccounts.ownerId))
            .where(and(eq(gameAccounts.desiredState, "running"), eq(users.status, "active")))
        const { accounts, entitled, mainOf } = await planStanding(tx, await loadPlanOwners(tx, owners, new Date()))

        const moves = new Map<string, string | null>()
        for (const account of accounts)
            if (mainOf.has(account.id) && account.proxyId)
                moves.set(account.id, null)

        const places = new Map((await tx.select({ proxyId: gameAccounts.proxyId, n: count() }).from(gameAccounts)
            .where(isNotNull(gameAccounts.proxyId)).groupBy(gameAccounts.proxyId)).map(row => [row.proxyId!, row.n]))
        for (const id of moves.keys()) {
            const held = accounts.find(a => a.id === id)!.proxyId!
            places.set(held, places.get(held)! - 1)
        }
        const taken = (proxyId: string) => places.get(proxyId) ?? 0

        const usable = new Set(pool.filter(p => p.enabled).map(p => p.id))
        const placeHolders = new Set(accounts
            .filter(a => a.desiredState === "running" && entitled.has(a.id))
            .map(a => mainOf.get(a.id) ?? a.id))
        const unplaced = accounts
            .filter(a => placeHolders.has(a.id) && !(a.proxyId && usable.has(a.proxyId)))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
        for (const account of unplaced) {
            // The pool is in id order, so the first of the least-loaded proxies is the one with the lowest id.
            const free = pool.filter(p => p.enabled && taken(p.id) < p.maxAccounts)
                .reduce<typeof pool[number] | undefined>((best, p) => best && taken(best.id) <= taken(p.id) ? best : p, undefined)
            if (free)
                places.set(free.id, taken(free.id) + 1)
            if ((free?.id ?? null) !== account.proxyId)
                moves.set(account.id, free?.id ?? null)
        }

        // One statement per target, and none when nothing moved: each one wakes the runner through game_accounts' trigger.
        for (const [proxyId, moved] of Map.groupBy(moves, ([, target]) => target))
            await tx.update(gameAccounts).set({ proxyId }).where(inArray(gameAccounts.id, moved.map(([accountId]) => accountId)))
        return moves.size
    })
}

/** The enabled proxy each of these accounts is assigned to. An account with none, or with one that is off, is absent. */
export async function enabledProxiesOf(db: Pick<Db, "select">, accountIds: string[]) {
    if (!accountIds.length)
        return new Map<string, SpecProxy>()
    const rows = await db.select({ accountId: gameAccounts.id, id: proxies.id, urlSealed: proxies.urlSealed })
        .from(gameAccounts).innerJoin(proxies, eq(proxies.id, gameAccounts.proxyId))
        .where(and(inArray(gameAccounts.id, accountIds), eq(proxies.enabled, true)))
    return new Map(rows.map(({ accountId, ...proxy }) => [accountId, proxy]))
}
