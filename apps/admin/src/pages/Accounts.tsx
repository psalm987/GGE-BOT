import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Flex, Input, Select, Table, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useEffect } from "react"
import { Link } from "react-router"
import { CrestEmpty, ParchmentCard, SigilStatus } from "@gge/ui"
import { client, orpc } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { ForceStopButton } from "../components/ForceStopButton.tsx"
import { useListParams } from "../components/useListParams.ts"

dayjs.extend(relativeTime)

type Account = Awaited<ReturnType<typeof client.accounts.list>>["items"][number]

const STATES = [
    { value: "running", label: "Running" }, { value: "starting", label: "Starting" }, { value: "stopped", label: "Stopped" }, { value: "error", label: "Error" },
    { value: "crash_loop", label: "Crash loop" }, { value: "banned", label: "Banned" }, { value: "auth_failed", label: "Sign-in failed" },
] as const
const FILTERS = { state: STATES.map(s => s.value) } as const

export function Accounts() {
    const list = useListParams(FILTERS)
    const { state } = list.values
    const accounts = useQuery(orpc.accounts.list.queryOptions({
        input: { search: list.search || undefined, state, limit: list.size, offset: list.offset },
        placeholderData: keepPreviousData,
    }))
    const rows = accounts.data?.items ?? []
    const total = accounts.data?.total ?? 0
    const { clampTo } = list
    useEffect(() => { if (accounts.data && !accounts.isPlaceholderData) clampTo(accounts.data.total) }, [accounts.data, accounts.isPlaceholderData, clampTo])

    return (
        <AdminPage title="Accounts">
            {accounts.error && <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />}
            <ParchmentCard title="All game accounts" extra={
                <Flex wrap gap={8}>
                    <Input allowClear placeholder="Search by account or owner" aria-label="Search accounts" style={{ width: 240, maxWidth: "100%" }}
                        value={list.draft} onChange={e => list.setDraft(e.target.value)} />
                    <Select allowClear placeholder="State" aria-label="Filter by state" style={{ width: 140 }} value={state}
                        options={[...STATES]} onChange={value => list.setFilter("state", value)} />
                </Flex>
            }>
                {!accounts.isPending && !accounts.error && total === 0 ? (
                    <CrestEmpty title="No game accounts" hint={list.search || state ? "Try a different search or filter." : "Players haven't added any yet."} />
                ) : (
                    <Table<Account> rowKey="id" loading={accounts.isFetching} dataSource={rows} scroll={{ x: 900 }}
                        pagination={{ current: list.page, pageSize: list.size, total, showSizeChanger: true, showTotal: n => `${n} accounts`, hideOnSinglePage: total <= Math.min(list.size, 10) }}
                        onChange={({ current, pageSize }) => list.setPage(current ?? 1, pageSize ?? list.size)}
                        columns={[
                            { title: "Name", dataIndex: "name", render: (n: string) => <Typography.Text strong>{n}</Typography.Text> },
                            { title: "Owner", dataIndex: "owner", render: (owner: string, a) => <Link to={`/users/${a.ownerId}`}>{owner}</Link> },
                            { title: "Server", dataIndex: "serverId", width: 90 },
                            { title: "Desired", dataIndex: "desiredState", render: (s: Account["desiredState"]) => s === "running" ? "Running" : "Stopped" },
                            { title: "Status", key: "status", render: (_, a) => <SigilStatus state={a.status?.actualState} detail={a.status?.lastError} /> },
                            {
                                title: "Last seen", key: "seen",
                                render: (_, a) => a.status?.heartbeatAt
                                    ? <Tooltip title={dayjs(a.status.heartbeatAt).format("D MMM YYYY HH:mm:ss")}>{dayjs(a.status.heartbeatAt).fromNow()}</Tooltip>
                                    : <Typography.Text type="secondary">Never</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", align: "right",
                                render: (_, a) => <ForceStopButton account={a} />,
                            },
                        ]} />
                )}
            </ParchmentCard>
        </AdminPage>
    )
}
