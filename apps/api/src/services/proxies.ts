import { asc, count, eq, inArray } from "drizzle-orm"
import { gameAccounts, proxies, type Db } from "@gge/db"
import { sealFor } from "@gge/crypto"
import { proxyHostHint, twinMainIds, type AdminProxy } from "@gge/contracts"
import { fail } from "../errors.ts"

type Reader = Pick<Db, "select">

/** The only way a proxy leaves the API: its host hint, never its URL, sealed or not. */
const adminProxies = (db: Reader) => db.select({
    id: proxies.id, label: proxies.label, hostHint: proxies.hostHint, enabled: proxies.enabled, maxAccounts: proxies.maxAccounts,
    accountCount: count(gameAccounts.id), consecutiveFailures: proxies.consecutiveFailures,
    lastOkAt: proxies.lastOkAt, lastErrorAt: proxies.lastErrorAt, lastError: proxies.lastError, disabledReason: proxies.disabledReason,
}).from(proxies).leftJoin(gameAccounts, eq(gameAccounts.proxyId, proxies.id)).groupBy(proxies.id)

export const listProxies = (db: Reader): Promise<AdminProxy[]> => adminProxies(db).orderBy(asc(proxies.createdAt), proxies.id)

async function getProxy(db: Reader, id: string) {
    const [proxy] = await adminProxies(db).where(eq(proxies.id, id))
    if (!proxy)
        throw fail("NOT_FOUND", "PROXY_NOT_FOUND")
    return proxy
}

const sealedUrl = (sealKey: string, url: string) => ({ urlSealed: sealFor(sealKey, url), hostHint: proxyHostHint(url) })

export async function createProxy(db: Db, sealKey: string, input: { label: string; url: string; maxAccounts: number }) {
    const [created] = await db.insert(proxies)
        .values({ label: input.label, maxAccounts: input.maxAccounts, ...sealedUrl(sealKey, input.url) })
        .returning({ id: proxies.id })
    return getProxy(db, created!.id)
}

export async function updateProxy(db: Db, sealKey: string, input: { id: string; label?: string; url?: string; maxAccounts?: number; enabled?: boolean }) {
    // Only the given columns are set: the runner is woken by a write to enabled, url_sealed or max_accounts, and not by a new label.
    const [updated] = await db.update(proxies).set({
        ...(input.label !== undefined && { label: input.label }),
        ...(input.url !== undefined && sealedUrl(sealKey, input.url)),
        ...(input.maxAccounts !== undefined && { maxAccounts: input.maxAccounts }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.enabled && { disabledReason: null, consecutiveFailures: 0 }),
        updatedAt: new Date(),
    }).where(eq(proxies.id, input.id)).returning({ id: proxies.id })
    if (!updated)
        throw fail("NOT_FOUND", "PROXY_NOT_FOUND")
    return getProxy(db, input.id)
}

/** Its accounts lose their proxy through the foreign key, which wakes the runner to assign them another. */
export async function removeProxy(db: Db, id: string) {
    const [removed] = await db.delete(proxies).where(eq(proxies.id, id)).returning({ label: proxies.label, hostHint: proxies.hostHint })
    if (!removed)
        throw fail("NOT_FOUND", "PROXY_NOT_FOUND")
    return removed
}

/**
 * An admin's manual pin. It may put more accounts on a proxy than its maxAccounts, which only limits what the
 * runner assigns on its own. Null unpins: the runner picks a proxy the next time the account starts.
 */
export async function setAccountProxy(db: Db, accountId: string, proxyId: string | null) {
    const [account] = await db.select({ ownerId: gameAccounts.ownerId }).from(gameAccounts).where(eq(gameAccounts.id, accountId))
    if (!account)
        throw fail("NOT_FOUND", "ACCOUNT_NOT_FOUND")
    if (proxyId) {
        const [proxy] = await db.select({ enabled: proxies.enabled }).from(proxies).where(eq(proxies.id, proxyId))
        if (!proxy)
            throw fail("NOT_FOUND", "PROXY_NOT_FOUND")
        if (!proxy.enabled)
            throw fail("BAD_REQUEST", "PROXY_OFF")
        const siblings = await db
            .select({ id: gameAccounts.id, serverId: gameAccounts.serverId, name: gameAccounts.name, externalEvent: gameAccounts.externalEvent, createdAt: gameAccounts.createdAt })
            .from(gameAccounts).where(eq(gameAccounts.ownerId, account.ownerId))
        if (twinMainIds(siblings).has(accountId))
            throw fail("BAD_REQUEST", "PROXY_TWIN_PIN")
    }
    await db.update(gameAccounts).set({ proxyId, updatedAt: new Date() }).where(eq(gameAccounts.id, accountId))
}

/** Each account's proxy, for the admin lists. An account with none is absent. */
export async function proxiesOfAccounts(db: Reader, accountIds: string[]) {
    if (!accountIds.length)
        return new Map<string, { proxyId: string; proxyLabel: string }>()
    const rows = await db.select({ accountId: gameAccounts.id, proxyId: proxies.id, proxyLabel: proxies.label })
        .from(gameAccounts).innerJoin(proxies, eq(proxies.id, gameAccounts.proxyId)).where(inArray(gameAccounts.id, accountIds))
    return new Map(rows.map(({ accountId, ...proxy }) => [accountId, proxy]))
}
