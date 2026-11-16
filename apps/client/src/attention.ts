import type { PublicAccount } from "@gge/contracts"

const NEEDS_ATTENTION = new Set(["auth_failed", "banned", "error", "crash_loop"])

/** Whether the roster shows this account in a state its owner should look at. A sleeping account shows as sleeping, whatever its last status says. */
export const needsAttention = (account: Pick<PublicAccount, "status" | "sleepingUntil">) =>
    !account.sleepingUntil && account.status !== null && NEEDS_ATTENTION.has(account.status.actualState)
