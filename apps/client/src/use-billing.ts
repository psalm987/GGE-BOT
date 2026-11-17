import { useQuery } from "@tanstack/react-query"
import { orpc } from "./api.ts"
import { useMe } from "./auth.tsx"

const REFRESH_MS = 5 * 60_000

/** Whether billing is live and what is for sale. Only a player with a confirmed email can ask. */
export function useBillingConfig() {
    const verified = !!useMe().data?.emailVerified
    return useQuery({ ...orpc.billing.config.queryOptions(), enabled: verified, refetchOnWindowFocus: true, refetchInterval: REFRESH_MS })
}

/** Players see the Plan page only once plans restrict them; admins always do, to try checkout first. */
export function usePlanVisible() {
    const me = useMe().data
    const config = useBillingConfig()
    return me?.role === "admin" || !!config.data?.billingLive
}
