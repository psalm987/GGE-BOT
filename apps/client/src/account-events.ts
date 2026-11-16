import type { AccountEvent, PublicAccount } from "@gge/contracts"

/** The account list after one live event. An event about an account that isn't listed changes nothing. */
export function applyUserEvent(accounts: PublicAccount[] | undefined, event: AccountEvent): PublicAccount[] | undefined {
    return accounts?.map(account => {
        if (account.id !== event.accountId)
            return account
        switch (event.kind) {
            case "status": return { ...account, status: event.status }
            // A stopped account isn't sleeping. A started one may be; only the server's answer says.
            case "account": return { ...account, desiredState: event.desiredState, ...(event.desiredState === "stopped" && { sleepingUntil: null }) }
        }
    })
}
