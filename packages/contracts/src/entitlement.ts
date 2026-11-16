export type PlanOwner = { role: "user" | "admin"; maxBots: number }
export type PlanAccount = { id: string; serverId: number; name: string; externalEvent: boolean; createdAt: Date }

const siblingKey = (a: PlanAccount) => `${a.serverId}:${a.name.toLowerCase()}`

/**
 * One owner's event twins, each mapped to its main: the non-event account
 * with the same server and name. A twin rides on its main's plan slot.
 */
export function twinMainIds(accounts: PlanAccount[]): Map<string, string> {
    const mains = new Map(accounts.filter(a => !a.externalEvent).map(a => [siblingKey(a), a.id]))
    const twins = new Map<string, string>()
    for (const a of accounts) {
        const main = a.externalEvent ? mains.get(siblingKey(a)) : undefined
        if (main)
            twins.set(a.id, main)
    }
    return twins
}

/** How many of one owner's accounts count toward maxBots. */
export const countedAccounts = (accounts: PlanAccount[]) => accounts.length - twinMainIds(accounts).size

/**
 * Which of one owner's accounts may run: the oldest maxBots accounts that
 * aren't twins, by (createdAt, id), plus the twins of those. Admins run all.
 */
export function entitledAccountIds(owner: PlanOwner, accounts: PlanAccount[]): Set<string> {
    if (owner.role === "admin")
        return new Set(accounts.map(a => a.id))
    const twins = twinMainIds(accounts)
    const entitled = new Set(accounts
        .filter(a => !twins.has(a.id))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, Math.max(0, owner.maxBots))
        .map(a => a.id))
    for (const [twin, main] of twins)
        if (entitled.has(main))
            entitled.add(twin)
    return entitled
}

/** Why a player can't start an account their plan doesn't cover. */
export function planRunsMessage(maxBots: number) {
    if (maxBots <= 0)
        return "Your plan doesn't include running bots."
    return `Your plan runs your ${maxBots === 1 ? "oldest bot" : `${maxBots} oldest bots`} and their event twins. Remove a bot to start this one.`
}
