import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import { QueryClient } from "@tanstack/react-query"
import { getI18n } from "react-i18next"
import type { AdminApi } from "@gge/contracts"

export const client = createORPCClient<AdminApi>(new RPCLink({ url: `${window.location.origin}/admin/rpc` }))
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
export const messageOf = (error: unknown) => (error as { message?: string })?.message || getI18n().t("error.generic", { ns: "common" })
