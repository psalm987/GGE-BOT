import { expect, test } from "vitest"
import type { LogActivity, PublicAccount } from "@gge/contracts"
import { topAccounts, totalsOf } from "../src/dashboard-model.ts"

const account = (id: string, name: string) => ({ id, name }) as PublicAccount
const row = (accountId: string, attacks: number, errors: number, complete = true) => ({ accountId, attacks, errors, attacksComplete: complete, errorsComplete: complete })
const activity: LogActivity = { accounts: [row("a", 5, 1), row("b", 9, 0), row("c", 0, 4), row("d", 5, 0, false)] }

test("totals add up every account, and are a floor when any account's window may be cut", () => {
    expect(totalsOf(activity)).toEqual({ attacks: { count: 19, complete: false }, errors: { count: 5, complete: false } })
    expect(totalsOf({ accounts: [row("a", 2, 3)] })).toEqual({ attacks: { count: 2, complete: true }, errors: { count: 3, complete: true } })
    expect(totalsOf({ accounts: [] })).toEqual({ attacks: { count: 0, complete: true }, errors: { count: 0, complete: true } })
    expect(totalsOf(undefined)).toBeUndefined()
})

test("the top accounts are those that attacked, most first, fewer errors breaking a tie, and the list is cut to the limit", () => {
    const accounts = [account("a", "Ash"), account("b", "Birch"), account("c", "Cedar"), account("d", "Dune"), account("e", "Elm")]
    expect(topAccounts(accounts, activity, 5).map(t => t.account.name)).toEqual(["Birch", "Dune", "Ash"])
    expect(topAccounts(accounts, activity, 2).map(t => t.account.name)).toEqual(["Birch", "Dune"])
    expect(topAccounts(accounts, activity, 5)[1]).toMatchObject({ attacks: 5, errors: 0, complete: false })
    expect(topAccounts(accounts, undefined, 5)).toEqual([])
})
