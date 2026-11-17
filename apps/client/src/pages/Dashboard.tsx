import { CaretRightFilled, DeleteOutlined, EditOutlined, PauseOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Grid, Popconfirm, Space, Table, Tag, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { planRunsMessage, type PublicAccount } from "@gge/contracts"
import { CrestEmpty, messageOf, palette, ParchmentCard, SigilStatus } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { AccountDrawer } from "../components/AccountDrawer.tsx"
import { DashboardOverview } from "../components/DashboardOverview.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { needsAttention } from "../attention.ts"
import { pollInterval, useRealtimeState } from "../realtime.ts"

dayjs.extend(relativeTime)

const isRunning = (a: PublicAccount) => a.desiredState === "running"
const twinKey = (a: Pick<PublicAccount, "serverId" | "name">) => `${a.serverId}:${a.name.toLowerCase()}`

export function Dashboard() {
    const { message } = App.useApp()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const phone = !Grid.useBreakpoint().md
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), refetchInterval: pollInterval(useRealtimeState()) })
    const servers = useQuery(orpc.servers.list.queryOptions())
    const me = useMe().data
    const [selected, setSelected] = useState<string[]>([])
    const [drawer, setDrawer] = useState<{ open: boolean; account?: PublicAccount; twinOf?: PublicAccount; plugin?: string }>({ open: false })

    // A notification links here as /?account=<id>, and the command palette adds &plugin=<key> to open that plugin's settings.
    // Both are taken off the URL once used, so closing the drawer or reloading doesn't reopen it.
    const [params, setParams] = useSearchParams()
    const wanted = params.get("account")
    const wantedPlugin = params.get("plugin") ?? undefined
    useEffect(() => {
        if (!wanted || !accounts.data)
            return
        const account = accounts.data.find(a => a.id === wanted)
        if (account)
            setDrawer({ open: true, account, plugin: wantedPlugin })
        setParams(current => {
            current.delete("account")
            current.delete("plugin")
            return current
        }, { replace: true })
    }, [wanted, wantedPlugin, accounts.data, setParams])

    const serverLabel = useMemo(() => new Map(servers.data?.map(s => [s.id, s.label])), [servers.data])
    const listKey = orpc.accounts.list.queryKey()

    const setState = useMutation(orpc.accounts.setDesiredState.mutationOptions({
        // Flip the switch at once; roll back if the server refuses.
        onMutate: async ({ ids, state }) => {
            await queryClient.cancelQueries({ queryKey: listKey })
            const previous = queryClient.getQueryData<PublicAccount[]>(listKey)
            queryClient.setQueryData<PublicAccount[]>(listKey, list => list?.map(a => ids.includes(a.id) ? { ...a, desiredState: state, ...(state === "stopped" && { sleepingUntil: null }) } : a))
            return { previous }
        },
        onError: (error, _vars, context) => {
            queryClient.setQueryData(listKey, (context as { previous?: PublicAccount[] })?.previous)
            message.error(messageOf(error))
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }))
    const remove = useMutation(orpc.accounts.remove.mutationOptions({
        onSuccess: (_, { ids }) => {
            message.success(t("dashboard.removed", { count: ids.length }))
            setSelected([])
            void queryClient.invalidateQueries({ queryKey: listKey })
        },
        onError: error => message.error(messageOf(error)),
    }))

    const list = accounts.data ?? []
    const running = list.filter(a => a.status?.actualState === "running").length
    const counted = list.filter(a => !a.isTwin).length
    const limit = me?.role === "admin" ? undefined : me?.accountLimit
    const atLimit = limit !== undefined && counted >= limit
    const overLimit = list.filter(a => !a.entitled).length
    const runs = limit === undefined ? undefined : planRunsMessage(limit)
    const planHint = runs && t(runs.key, { ns: "errors", ...runs.params })
    const limitHint = overLimit
        ? t("dashboard.overLimit", { count: overLimit, hint: planHint })
        : atLimit ? t("dashboard.planAllows", { count: limit }) : undefined
    const twinned = new Set(list.filter(a => a.isTwin).map(twinKey))
    const selectedOverLimit = list.some(a => selected.includes(a.id) && !a.entitled)
    const attention = list.filter(needsAttention).length

    return (
        <AppLayout
            activeKey="accounts"
            title={t("dashboard.title")}
            extra={
                <Space>
                    <Tooltip title={limitHint}>
                        <Button type="primary" icon={<PlusOutlined />} aria-label={t("account.add")} disabled={atLimit} onClick={() => setDrawer({ open: true })} className="gge-press">{phone ? null : t("account.add")}</Button>
                    </Tooltip>
                </Space>
            }>
            {list.length > 0 && (
                <DashboardOverview accounts={list} counted={counted} limit={limit} online={running} attention={attention} onOpen={account => setDrawer({ open: true, account })} />
            )}

            <ParchmentCard
                title={t("dashboard.roster")}
                extra={selected.length > 0 && (
                    <Space wrap>
                        <Typography.Text type="secondary">{t("dashboard.selected", { count: selected.length })}</Typography.Text>
                        <Tooltip title={selectedOverLimit ? t("dashboard.selectionOverLimit", { hint: planHint }) : undefined}>
                            <Button icon={<CaretRightFilled />} disabled={selectedOverLimit} onClick={() => setState.mutate({ ids: selected, state: "running" })}>{tc("action.start")}</Button>
                        </Tooltip>
                        <Button icon={<PauseOutlined />} onClick={() => setState.mutate({ ids: selected, state: "stopped" })}>{tc("action.stop")}</Button>
                        <Popconfirm title={t("dashboard.removeConfirm", { count: selected.length })} description={t("dashboard.removeBody")}
                            okText={tc("action.remove")} okButtonProps={{ danger: true }} onConfirm={() => remove.mutate({ ids: selected })}>
                            <Button danger icon={<DeleteOutlined />} loading={remove.isPending}>{tc("action.remove")}</Button>
                        </Popconfirm>
                    </Space>
                )}>
                {/* Being over the limit has its own banner above the page. */}
                {atLimit && !overLimit && <Typography.Paragraph type="secondary" role="status">{limitHint}</Typography.Paragraph>}
                {!accounts.isPending && list.length === 0 ? (
                    <CrestEmpty title={t("dashboard.emptyTitle")} hint={t("dashboard.emptyHint")}
                        action={<Button type="primary" icon={<PlusOutlined />} disabled={atLimit} onClick={() => setDrawer({ open: true })}>{t("dashboard.addFirst")}</Button>} />
                ) : (
                    <Table<PublicAccount>
                        rowKey="id"
                        loading={accounts.isPending}
                        dataSource={list}
                        pagination={list.length > 20 ? { pageSize: 20 } : false}
                        rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys as string[]) }}
                        scroll={{ x: 760 }}
                        columns={[
                            {
                                title: t("dashboard.col.account"), dataIndex: "name", sorter: (a, b) => a.name.localeCompare(b.name),
                                render: (name: string, a) => (
                                    <div>
                                        <Typography.Text strong>{name}</Typography.Text>
                                        <div><Typography.Text type="secondary" style={{ fontSize: 13 }}>{serverLabel.get(a.serverId) ?? t("dashboard.server", { id: a.serverId })}{a.externalEvent ? ` · ${t("dashboard.event")}` : ""}</Typography.Text></div>
                                    </div>
                                ),
                            },
                            {
                                title: tc("field.status"),
                                render: (_, a) => a.entitled ? <SigilStatus state={a.status?.actualState} detail={a.status?.lastError} sleepingUntil={a.sleepingUntil} /> : (
                                    <Tooltip title={planHint}>
                                        <Tag tabIndex={0} variant="outlined" style={{ color: palette.amber, borderColor: palette.amber, background: "transparent", fontWeight: 500 }}>{t("dashboard.overPlan")}</Tag>
                                    </Tooltip>
                                ),
                            },
                            { title: t("dashboard.col.plugins"), render: (_, a) => Object.values(a.plugins).filter(p => p.enabled).length, width: 90 },
                            {
                                title: t("dashboard.col.lastSeen"), width: 140,
                                render: (_, a) => a.status?.heartbeatAt
                                    ? <Tooltip title={dayjs(a.status.heartbeatAt).format("D MMM YYYY HH:mm:ss")}>{dayjs(a.status.heartbeatAt).fromNow()}</Tooltip>
                                    : <Typography.Text type="secondary">—</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", width: 240, align: "right",
                                render: (_, a) => (
                                    <Space>
                                        {isRunning(a)
                                            ? <Button icon={<PauseOutlined />} onClick={() => setState.mutate({ ids: [a.id], state: "stopped" })}>{tc("action.stop")}</Button>
                                            : (
                                                <Tooltip title={a.entitled ? undefined : t("dashboard.overPlanStart", { hint: planHint })}>
                                                    <Button type="primary" ghost icon={<CaretRightFilled />} disabled={!a.entitled} aria-label={t("dashboard.startAccount", { name: a.name })}
                                                        onClick={() => setState.mutate({ ids: [a.id], state: "running" })}>{tc("action.start")}</Button>
                                                </Tooltip>
                                            )}
                                        {!a.externalEvent && !twinned.has(twinKey(a)) && (
                                            <Tooltip title={t("dashboard.twinTip")}>
                                                <Button icon={<ThunderboltOutlined />} aria-label={t("account.addTwinFor", { name: a.name })} onClick={() => setDrawer({ open: true, twinOf: a })} />
                                            </Tooltip>
                                        )}
                                        <Button icon={<EditOutlined />} aria-label={t("dashboard.edit", { name: a.name })} onClick={() => setDrawer({ open: true, account: a })} />
                                    </Space>
                                ),
                            },
                        ]}
                    />
                )}
            </ParchmentCard>

            <AccountDrawer open={drawer.open} account={drawer.account} twinOf={drawer.twinOf} openPlugin={drawer.plugin} onClose={() => setDrawer({ open: false })} />
        </AppLayout>
    )
}
