import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Flex, Input, Select, Table, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { CrestEmpty, ParchmentCard, SigilStatus } from "@gge/ui"
import { client, orpc } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { ForceStopButton } from "../components/ForceStopButton.tsx"
import { ProxySelect } from "../components/ProxySelect.tsx"
import { useListParams } from "../components/useListParams.ts"

dayjs.extend(relativeTime)

type Account = Awaited<ReturnType<typeof client.accounts.list>>["items"][number]

const STATES = ["running", "starting", "stopped", "error", "crash_loop", "banned", "auth_failed"] as const
const FILTERS = { state: STATES } as const

export function Accounts() {
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
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
        <AdminPage title={tc("nav.accounts")}>
            {accounts.error && <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />}
            <ParchmentCard title={t("accounts.title")} extra={
                <Flex wrap gap={8}>
                    <Input allowClear placeholder={t("accounts.search")} aria-label={t("accounts.searchLabel")} style={{ width: 240, maxWidth: "100%" }}
                        value={list.draft} onChange={e => list.setDraft(e.target.value)} />
                    <Select allowClear placeholder={t("accounts.state")} aria-label={t("accounts.filterState")} style={{ width: 140 }} value={state}
                        options={STATES.map(value => ({ value, label: t(`accounts.state.${value}`) }))} onChange={value => list.setFilter("state", value)} />
                </Flex>
            }>
                {!accounts.isPending && !accounts.error && total === 0 ? (
                    <CrestEmpty title={t("accounts.emptyTitle")} hint={list.search || state ? t("list.tryDifferent") : t("accounts.emptyHint")} />
                ) : (
                    <Table<Account> rowKey="id" loading={accounts.isFetching} dataSource={rows} scroll={{ x: 1100 }}
                        pagination={{ current: list.page, pageSize: list.size, total, showSizeChanger: true, showTotal: n => t("accounts.total", { count: n }), hideOnSinglePage: total <= Math.min(list.size, 10) }}
                        onChange={({ current, pageSize }) => list.setPage(current ?? 1, pageSize ?? list.size)}
                        columns={[
                            { title: tc("field.name"), dataIndex: "name", render: (n: string) => <Typography.Text strong>{n}</Typography.Text> },
                            { title: t("accounts.owner"), dataIndex: "owner", render: (owner: string, a) => <Link to={`/users/${a.ownerId}`}>{owner}</Link> },
                            { title: tc("field.server"), dataIndex: "serverId", width: 90 },
                            { title: t("accounts.desired"), dataIndex: "desiredState", render: (s: Account["desiredState"]) => t(`desired.${s}`) },
                            { title: tc("field.status"), key: "status", render: (_, a) => <SigilStatus state={a.status?.actualState} detail={a.status?.lastError} sleepingUntil={a.sleepingUntil} /> },
                            { title: t("accounts.proxy"), key: "proxy", width: 210, render: (_, a) => <ProxySelect account={a} /> },
                            {
                                title: t("accounts.lastSeen"), key: "seen",
                                render: (_, a) => a.status?.heartbeatAt
                                    ? <Tooltip title={dayjs(a.status.heartbeatAt).format("D MMM YYYY HH:mm:ss")}>{dayjs(a.status.heartbeatAt).fromNow()}</Tooltip>
                                    : <Typography.Text type="secondary">{tc("value.never")}</Typography.Text>,
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
