import { useQuery } from "@tanstack/react-query"
import { Grid } from "antd"
import { useDeferredValue, useMemo, useState } from "react"
import { LevelFilter, LogSearch, LogTerminal, NO_FILTERS, RunsPanel, TagFilter, activeFilters, facetsOf, filterLines, useLogText, type LogFilters } from "@gge/ui"
import { orpc } from "../api.ts"
import { useLogFeed } from "../log-feed.ts"

/**
 * One account's log in the viewer's language, live. A page of the feed is as long as the runner keeps per account
 * (500), so the filters and the tag list work on what is loaded.
 */
export function AccountLogs({ accountId }: { accountId: string }) {
    const phone = !Grid.useBreakpoint().md
    const [filters, setFilters] = useState<LogFilters>(NO_FILTERS)
    const set = (patch: Partial<LogFilters>) => setFilters(current => ({ ...current, ...patch }))
    const ids = useMemo(() => [accountId], [accountId])
    const { lines, feed } = useLogFeed({ accountIds: ids, levels: [], plugins: [] }, ids)
    const renderText = useLogText()
    const q = useDeferredValue(filters.q)
    const shown = useMemo(() => filterLines(lines, { ...filters, q }, renderText), [lines, filters, q, renderText])
    const facets = useMemo(() => facetsOf(lines), [lines])
    return (
        <div style={{ display: "grid", gap: 12 }}>
            <div className="gge-logs-filters">
                <LogSearch value={filters.q} onChange={q => set({ q })} style={{ flex: "1 1 180px" }} />
                <LevelFilter value={filters.levels[0] ?? null} onChange={level => set({ levels: level === null ? [] : [level] })} counts={facets.levels} block={phone}
                    style={phone ? { flex: "1 1 100%" } : undefined} />
                <TagFilter value={filters.plugins} onChange={plugins => set({ plugins })} options={facets.plugins} style={{ flex: "1 1 100%" }} />
            </div>
            <LogTerminal style={{ height: "min(60dvh, 560px)" }} lines={shown} renderText={renderText}
                loading={feed.isPending} error={feed.isError ? feed.error.message : null} onRetry={() => void feed.refetch()}
                hasOlder={feed.hasNextPage} loadingOlder={feed.isFetchingNextPage} onLoadOlder={() => void feed.fetchNextPage()}
                filtered={activeFilters(filters) > 0} onClearFilters={() => setFilters(NO_FILTERS)} highlight={q}
                onTagClick={tag => { if (!filters.plugins.includes(tag)) set({ plugins: [...filters.plugins, tag] }) }}
                followKey={JSON.stringify({ ...filters, q })} />
        </div>
    )
}

/** The account's last runs. */
export function AccountRuns({ accountId }: { accountId: string }) {
    const runs = useQuery(orpc.accounts.runs.queryOptions({ input: { id: accountId, limit: 20 } }))
    return <RunsPanel runs={runs.data} loading={runs.isPending} />
}
