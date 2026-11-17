import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import type { Level } from "@gge/ui/log-filter"
import { orpc } from "./api.ts"
import { mergeFeed } from "./log-merge.ts"
import { pollInterval, useBotLogs, useRealtimeState } from "./realtime.ts"

export const FEED_PAGE = 500
const GAP_SETTLE_MS = 150

const some = <T,>(values: readonly T[]) => values.length ? [...values] : undefined

/**
 * The newest lines that match the account, level and tag filters, older pages on demand, and the lines that
 * `liveAccountIds` write while this is mounted, merged newest first. Text is filtered by the caller, on the
 * text each viewer reads. While a new filter loads, the previous lines stay, so the caller can narrow them at once.
 */
export function useLogFeed(filters: { accountIds: readonly string[]; levels: readonly Level[]; plugins: readonly string[] }, liveAccountIds: readonly string[]) {
    const feed = useInfiniteQuery({
        ...orpc.logs.feed.infiniteOptions({
            input: (before: number | undefined) => ({
                accountIds: some(filters.accountIds), levels: some(filters.levels), plugins: some(filters.plugins), before, limit: FEED_PAGE,
            }),
            initialPageParam: undefined,
            getNextPageParam: page => page.length >= FEED_PAGE ? page.at(-1)!.id : undefined,
        }),
        placeholderData: keepPreviousData,
        refetchInterval: pollInterval(useRealtimeState()),
    })
    // Every account subscribing at once reports a gap; one refetch after the last of them covers them all.
    const gapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    useEffect(() => () => clearTimeout(gapTimer.current), [])
    const live = useBotLogs([...liveAccountIds], {
        onGap: () => {
            clearTimeout(gapTimer.current)
            gapTimer.current = setTimeout(() => void feed.refetch(), GAP_SETTLE_MS)
        },
    })
    const pages = feed.data?.pages
    const lines = useMemo(() => mergeFeed(pages?.flat() ?? [], live, Infinity), [pages, live])
    return { lines, feed }
}
