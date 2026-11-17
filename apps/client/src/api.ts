import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import { QueryClient } from "@tanstack/react-query"
import type { ClientApi } from "@gge/contracts"

export const client = createORPCClient<ClientApi>(new RPCLink({
    url: `${window.location.origin}/rpc`,
    // Read per request: the language can change while the page is open.
    headers: () => ({ "x-gge-locale": document.documentElement.lang }),
}))
export const orpc = createTanstackQueryUtils(client)

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 15_000,
            retry: (count, error) => (error as { status?: number })?.status !== 401 && count < 2,
        },
    },
})

/** The message the API wrote for people, or a generic one. */
export const messageOf = (error: unknown) => (error as { message?: string })?.message || "Something went wrong. Try again."

const NOTIFICATIONS_PAGE = 20
/** The player's notifications, a page at a time, newest first. Live events patch this query's data. */
export const notificationsQuery = orpc.notifications.list.infiniteOptions({
    input: (before: number | undefined) => ({ before, limit: NOTIFICATIONS_PAGE }),
    initialPageParam: undefined,
    getNextPageParam: last => last.items.length >= NOTIFICATIONS_PAGE ? last.items.at(-1)!.id : undefined,
})
