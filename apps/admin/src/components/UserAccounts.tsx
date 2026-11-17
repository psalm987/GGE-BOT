import { ReloadOutlined } from "@ant-design/icons"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Button, Flex, Table, Typography } from "antd"
import { useMemo } from "react"
import { useSearchParams } from "react-router"
import { CrestEmpty, LogTerminal, RunsPanel, SigilStatus, useLogText } from "@gge/ui"
import { client, orpc } from "../api.ts"
import { QueryError } from "./AdminPage.tsx"
import { ForceStopButton } from "./ForceStopButton.tsx"
import { ProxySelect } from "./ProxySelect.tsx"

type Account = Awaited<ReturnType<typeof client.accounts.list>>["items"][number]
const REFRESH_MS = 10_000
const PAGE = 500

/** One account's latest runs and log, in English, refetched every 10 seconds while this is on screen. */
function AccountHistory({ account }: { account: Account }) {
    const runs = useQuery(orpc.accounts.runs.queryOptions({ input: { id: account.id, limit: 20 }, refetchInterval: REFRESH_MS }))
    const log = useInfiniteQuery({
        ...orpc.logs.feed.infiniteOptions({
            input: (before: number | undefined) => ({ ownerId: account.ownerId, accountIds: [account.id], before, limit: PAGE }),
            initialPageParam: undefined,
            getNextPageParam: page => page.length >= PAGE ? page.at(-1)!.id : undefined,
        }),
        refetchInterval: REFRESH_MS,
    })
    const lines = useMemo(() => log.data?.pages.flat() ?? [], [log.data])
    const english = useLogText("en")
    return (
        <section aria-label={`History of ${account.name}`} style={{ marginTop: 24 }}>
            <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
                <Typography.Title level={4} className="gge-display" style={{ margin: 0 }}>{account.name}</Typography.Title>
                <Button icon={<ReloadOutlined />} loading={runs.isFetching || log.isRefetching} onClick={() => { void log.refetch(); void runs.refetch() }}>Refresh</Button>
            </Flex>
            <Typography.Title level={5} style={{ marginTop: 0 }}>Runs</Typography.Title>
            <div role="region" aria-label="Runs">
                <RunsPanel runs={runs.data} loading={runs.isPending} />
            </div>
            <Typography.Title level={5}>Logs</Typography.Title>
            <div role="region" aria-label="Logs">
                <LogTerminal style={{ height: 480 }} lines={lines} renderText={english}
                    loading={log.isPending} error={log.isError ? log.error.message : null} onRetry={() => void log.refetch()}
                    hasOlder={log.hasNextPage} loadingOlder={log.isFetchingNextPage} onLoadOlder={() => void log.fetchNextPage()} />
            </div>
        </section>
    )
}

/** The user's game accounts. Selecting one, which the `account` query parameter remembers, shows its runs and logs. */
export function UserAccounts({ userId }: { userId: string }) {
    const [params, setParams] = useSearchParams()
    const selectedId = params.get("account")
    const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { ownerId: userId, limit: 200 } }))
    const rows = accounts.data?.items ?? []
    const selected = rows.find(a => a.id === selectedId)
    const select = (id: string) => setParams(prev => { const next = new URLSearchParams(prev); next.set("account", id); return next }, { replace: true })

    return (
        <>
            {accounts.error && <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />}
            {!accounts.isPending && !accounts.error && rows.length === 0 ? (
                <CrestEmpty title="No game accounts" hint="This player hasn't added any yet." />
            ) : (
                <Table<Account> rowKey="id" loading={accounts.isPending} dataSource={rows} pagination={false} scroll={{ x: 860 }}
                    rowClassName={a => a.id === selected?.id ? "ant-table-row-selected" : ""}
                    columns={[
                        { title: "Name", dataIndex: "name", render: (n: string) => <Typography.Text strong>{n}</Typography.Text> },
                        { title: "Server", dataIndex: "serverId", width: 90 },
                        { title: "Desired", dataIndex: "desiredState", render: (s: Account["desiredState"]) => s === "running" ? "Running" : "Stopped" },
                        { title: "Status", key: "status", render: (_, a) => <SigilStatus state={a.status?.actualState} detail={a.status?.lastError} sleepingUntil={a.sleepingUntil} /> },
                        { title: "Proxy", key: "proxy", width: 210, render: (_, a) => <ProxySelect account={a} /> },
                        {
                            title: "", key: "actions", align: "right",
                            render: (_, a) => (
                                <Flex gap={8} justify="flex-end" wrap>
                                    <Button aria-pressed={a.id === selected?.id} aria-label={`Show runs and logs of ${a.name}`} onClick={() => select(a.id)}>Runs and logs</Button>
                                    <ForceStopButton account={a} />
                                </Flex>
                            ),
                        },
                    ]} />
            )}
            {selected && <AccountHistory key={selected.id} account={selected} />}
        </>
    )
}
