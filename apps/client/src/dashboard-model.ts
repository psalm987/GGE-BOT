import type { LogActivity, PublicAccount } from "@gge/contracts"

/** A count from the kept log lines. `complete` false means the cap on kept lines may have dropped some, so it is a floor. */
export type Counted = { count: number; complete: boolean }

export type ActivityTotals = { attacks: Counted; errors: Counted }

/** The totals across accounts, or undefined while the activity hasn't loaded. */
export function totalsOf(activity: LogActivity | undefined): ActivityTotals | undefined {
    if (!activity)
        return undefined
    const sum = (count: (row: LogActivity["accounts"][number]) => number, complete: (row: LogActivity["accounts"][number]) => boolean): Counted =>
        ({ count: activity.accounts.reduce((total, row) => total + count(row), 0), complete: activity.accounts.every(complete) })
    return { attacks: sum(row => row.attacks, row => row.attacksComplete), errors: sum(row => row.errors, row => row.errorsComplete) }
}

export type TopAccount = { account: PublicAccount; attacks: number; errors: number; complete: boolean }

/** The accounts that attacked in the window, most attacks first, then fewest errors, then by name. An account that didn't attack isn't ranked. */
export function topAccounts(accounts: readonly PublicAccount[], activity: LogActivity | undefined, limit: number): TopAccount[] {
    const byId = new Map(activity?.accounts.map(row => [row.accountId, row]))
    return accounts
        .flatMap(account => {
            const row = byId.get(account.id)
            return row && row.attacks > 0 ? [{ account, attacks: row.attacks, errors: row.errors, complete: row.attacksComplete }] : []
        })
        .sort((a, b) => b.attacks - a.attacks || a.errors - b.errors || a.account.name.localeCompare(b.account.name))
        .slice(0, limit)
}
