import type { QueryClient, QueryKey } from "@tanstack/react-query"

/**
 * Applies a live event to a query's cached data.
 * A fetch already under way asked the server before the event happened, and its answer would undo the patch, so that fetch is replaced by a new one.
 */
export function patchQuery<T>(queryClient: QueryClient, queryKey: QueryKey, patch: (data: T | undefined) => T | undefined) {
    queryClient.setQueryData<T>(queryKey, patch)
    if (queryClient.isFetching({ queryKey, exact: true }))
        void queryClient.invalidateQueries({ queryKey, exact: true })
}
