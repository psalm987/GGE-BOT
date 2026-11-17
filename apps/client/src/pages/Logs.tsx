import { DownloadOutlined, FilterOutlined, ReloadOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Button, Drawer, Grid, Select } from "antd"
import { useDeferredValue, useId, useMemo, useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import type { PublicAccount } from "@gge/contracts"
import {
    Field, LevelFilter, LogSearch, LogTerminal, TagFilter, activeFilters, filterLines, formatForDownload, useLogText, type TerminalAccount,
} from "@gge/ui"
import { orpc } from "../api.ts"
import { AppLayout } from "../components/AppLayout.tsx"
import { useLogFeed } from "../log-feed.ts"
import { useLogFilters, writeLogParams } from "../log-params.ts"
import { pollInterval, useRealtimeState } from "../realtime.ts"

const FACETS_MS = 60_000

function AccountFilter({ value, onChange, accounts, counts, labels, style }: {
    value: readonly string[]
    onChange: (ids: string[]) => void
    accounts: readonly PublicAccount[]
    counts: ReadonlyMap<string, number>
    labels: ReadonlyMap<string, TerminalAccount>
    style?: CSSProperties
}) {
    const { t, i18n } = useTranslation("client")
    const number = new Intl.NumberFormat(i18n.language).format
    const id = useId()
    return (
        <Field label={t("logs.accounts")} id={id} style={style}>
            <Select<string[]> id={id} mode="multiple" allowClear maxTagCount="responsive" value={[...value]} onChange={onChange}
                placeholder={t("logs.allAccounts")} popupMatchSelectWidth={false}
                showSearch={{ optionFilterProp: "title" }}
                options={accounts.map(a => ({
                    value: a.id,
                    title: a.name,
                    label: (
                        <span className="gge-tag-option">
                            <span>{a.name} <small>{labels.get(a.id)?.serverLabel}{a.externalEvent && ` · ${t("logs.event")}`}</small></span>
                            <small>{number(counts.get(a.id) ?? 0)}</small>
                        </span>
                    ),
                }))}
                labelRender={({ value: accountId }) => labels.get(String(accountId))?.name ?? String(accountId)} />
        </Field>
    )
}

/** Every line from every one of the player's accounts, live, with the filters kept in the URL. */
export function Logs() {
    const { t } = useTranslation("client")
    const phone = !Grid.useBreakpoint().md
    const { filters, set: update, type, clear } = useLogFilters()
    const [drawerOpen, setDrawerOpen] = useState(false)

    const poll = pollInterval(useRealtimeState())
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), refetchInterval: poll })
    const servers = useQuery(orpc.servers.list.queryOptions())
    // Live lines don't update the counts and tags, so they are asked for again now and then.
    const facets = useQuery({ ...orpc.logs.facets.queryOptions(), refetchInterval: poll || FACETS_MS })
    const accountIds = useMemo(() => accounts.data?.map(a => a.id) ?? [], [accounts.data])
    const { lines, feed } = useLogFeed(filters, accountIds)

    const renderText = useLogText()
    const q = useDeferredValue(filters.q)
    const shown = useMemo(() => filterLines(lines, { ...filters, q }, renderText), [lines, filters, q, renderText])
    const labels = useMemo(() => {
        const serverLabel = new Map(servers.data?.map(s => [s.id, s.label]))
        return new Map((accounts.data ?? []).map(a => [a.id, { name: a.name, serverLabel: serverLabel.get(a.serverId) }]))
    }, [accounts.data, servers.data])
    const accountCounts = useMemo(() => new Map(facets.data?.accounts.map(a => [a.id, a.count])), [facets.data])
    const total = Math.max(facets.data?.total ?? 0, lines.length)
    const active = activeFilters(filters)
    const inDrawer = active - (filters.q.trim() ? 1 : 0)
    const countText = t(feed.hasNextPage ? "logs.countMore" : "logs.count", { shown: shown.length, count: total })

    // Screen readers hear the count when a filter has taken effect, not after every live line.
    const filterKey = writeLogParams({ ...filters, q }).toString()
    const [announced, setAnnounced] = useState({ key: filterKey, text: "" })
    if (announced.key !== filterKey && !feed.isPlaceholderData && !feed.isPending)
        setAnnounced({ key: filterKey, text: countText })

    function refresh() {
        void feed.refetch()
        void facets.refetch()
    }
    function download() {
        const text = formatForDownload(shown, { renderText, accountName: id => labels.get(id)?.name })
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }))
        const link = document.createElement("a")
        link.href = url
        link.download = `gge-bot-logs-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.txt`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    const addTo = (key: "plugins" | "accountIds", value: string) => {
        if (!filters[key].includes(value))
            update({ [key]: [...filters[key], value] })
    }

    const selectStyle = { flex: "1 1 200px", maxWidth: phone ? undefined : 300 }
    const accountFilter = <AccountFilter value={filters.accountIds} onChange={accountIds => update({ accountIds })} accounts={accounts.data ?? []} counts={accountCounts} labels={labels} style={selectStyle} />
    const tagFilter = <TagFilter value={filters.plugins} onChange={plugins => update({ plugins })} options={facets.data?.plugins ?? []} style={selectStyle} />
    const levelFilter = <LevelFilter value={filters.levels[0] ?? null} onChange={level => update({ levels: level === null ? [] : [level] })} counts={facets.data?.levels} block={phone} />
    const count = <><span className="gge-count gge-logs-count">{countText}</span><span className="gge-sr-only" role="status">{announced.text}</span></>
    const refreshButton = (
        <Button icon={<ReloadOutlined />} loading={feed.isRefetching && !feed.isFetchingNextPage} onClick={refresh} aria-label={phone ? t("logs.refresh") : undefined}>
            {phone ? null : t("logs.refresh")}
        </Button>
    )
    const downloadButton = (
        <Button icon={<DownloadOutlined />} disabled={!shown.length} onClick={download} aria-label={phone ? t("logs.download") : undefined}>
            {phone ? null : t("logs.download")}
        </Button>
    )

    return (
        <AppLayout activeKey="logs" title={t("logs.title")}>
            <div className="gge-logs-page">
                {phone ? (
                    <div className="gge-logs-toolbar">
                        <LogSearch value={filters.q} onChange={type} shortcut />
                        <div className="gge-logs-actions">
                            <Button icon={<FilterOutlined />} onClick={() => setDrawerOpen(true)} style={{ flex: 1 }}>
                                {inDrawer ? t("logs.filtersCount", { count: inDrawer }) : t("logs.filters")}
                            </Button>
                            {refreshButton}
                            {downloadButton}
                        </div>
                        {count}
                        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="bottom" size="auto" title={t("logs.filters")}
                            footer={
                                <div className="gge-logs-actions">
                                    <Button onClick={clear} disabled={!active}>{t("log.clearFilters", { ns: "ui" })}</Button>
                                    <Button type="primary" style={{ flex: 1 }} onClick={() => setDrawerOpen(false)}>{t("logs.showLines", { count: shown.length })}</Button>
                                </div>
                            }>
                            <div style={{ display: "grid", gap: 16 }}>
                                {accountFilter}
                                {levelFilter}
                                {tagFilter}
                            </div>
                        </Drawer>
                    </div>
                ) : (
                    <div className="gge-logs-toolbar">
                        <div className="gge-logs-filters">
                            <LogSearch value={filters.q} onChange={type} shortcut style={{ flex: "1 1 240px", maxWidth: 360 }} />
                            {accountFilter}
                            {tagFilter}
                            {levelFilter}
                        </div>
                        <div className="gge-logs-actions">
                            {count}
                            {active > 0 && <Button type="link" onClick={clear}>{t("log.clearFilters", { ns: "ui" })}</Button>}
                            <span style={{ flex: 1 }} />
                            {refreshButton}
                            {downloadButton}
                        </div>
                    </div>
                )}
                <LogTerminal style={{ flex: 1, minHeight: 320 }} lines={shown} renderText={renderText} accounts={labels} showAccount
                    loading={feed.isPending} error={feed.isError ? feed.error.message : null} onRetry={refresh}
                    hasOlder={feed.hasNextPage} loadingOlder={feed.isFetchingNextPage} onLoadOlder={() => void feed.fetchNextPage()}
                    filtered={active > 0} onClearFilters={clear} highlight={q}
                    onTagClick={tag => addTo("plugins", tag)} onAccountClick={id => addTo("accountIds", id)}
                    followKey={filterKey} />
            </div>
        </AppLayout>
    )
}
