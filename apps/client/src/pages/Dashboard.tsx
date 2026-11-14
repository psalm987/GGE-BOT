import { CaretRightFilled, DeleteOutlined, EditOutlined, PauseOutlined, PlusOutlined, TranslationOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Col, Grid, Popconfirm, Row, Select, Space, Statistic, Table, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useMemo, useState } from "react"
import type { PublicAccount } from "@gge/contracts"
import { CrestEmpty, ParchmentCard, SigilStatus, palette } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { AccountDrawer } from "../components/AccountDrawer.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { LANGUAGES, setLanguage, useLanguage, type Language } from "../i18n.ts"
import { useLiveBotEvents } from "../live.ts"

dayjs.extend(relativeTime)

const NEEDS_ATTENTION = new Set(["auth_failed", "banned", "error"])
const isRunning = (a: PublicAccount) => a.desiredState === "running"

export function Dashboard() {
    const { message } = App.useApp()
    const language = useLanguage()
    const phone = !Grid.useBreakpoint().md
    const accounts = useQuery(orpc.accounts.list.queryOptions())
    const servers = useQuery(orpc.servers.list.queryOptions())
    const me = useMe().data
    const [selected, setSelected] = useState<string[]>([])
    const [drawer, setDrawer] = useState<{ open: boolean; account?: PublicAccount }>({ open: false })
    useLiveBotEvents(true)

    const serverLabel = useMemo(() => new Map(servers.data?.map(s => [s.id, s.label])), [servers.data])
    const listKey = orpc.accounts.list.queryKey()

    const setState = useMutation(orpc.accounts.setDesiredState.mutationOptions({
        // Flip the switch at once; roll back if the server refuses.
        onMutate: async ({ ids, state }) => {
            await queryClient.cancelQueries({ queryKey: listKey })
            const previous = queryClient.getQueryData<PublicAccount[]>(listKey)
            queryClient.setQueryData<PublicAccount[]>(listKey, list => list?.map(a => ids.includes(a.id) ? { ...a, desiredState: state } : a))
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
            message.success(ids.length === 1 ? "Account removed" : `${ids.length} accounts removed`)
            setSelected([])
            void queryClient.invalidateQueries({ queryKey: listKey })
        },
        onError: error => message.error(messageOf(error)),
    }))

    const list = accounts.data ?? []
    const running = list.filter(a => a.status?.actualState === "running").length
    const limit = me?.role === "admin" ? undefined : me?.maxBots
    const atLimit = limit !== undefined && list.length >= limit
    const limitHint = atLimit ? `Your plan allows ${limit} bot${limit === 1 ? "" : "s"}. Remove one to add another.` : undefined
    const attention = list.filter(a => a.status && NEEDS_ATTENTION.has(a.status.actualState)).length

    return (
        <AppLayout
            activeKey="accounts"
            title="Your accounts"
            accountMenu={phone ? [{
                key: "language", icon: <TranslationOutlined />, label: "Language",
                children: Object.entries(LANGUAGES).map(([value, label]) => ({ key: value, label, onClick: () => setLanguage(value as Language) })),
            }] : []}
            extra={
                <Space>
                    {!phone && <Select<Language> value={language} onChange={setLanguage} aria-label="Language for bot messages" style={{ width: 130 }}
                        suffix={<TranslationOutlined />} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value: value as Language, label }))} />}
                    <Tooltip title={limitHint}>
                        <Button type="primary" icon={<PlusOutlined />} aria-label="Add account" disabled={atLimit} onClick={() => setDrawer({ open: true })} className="gge-press">{phone ? null : "Add account"}</Button>
                    </Tooltip>
                </Space>
            }>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={8}><ParchmentCard><Statistic title="Accounts" value={list.length} suffix={limit !== undefined && `/ ${limit}`} /></ParchmentCard></Col>
                <Col xs={12} sm={8}><ParchmentCard><Statistic title="Running now" value={running} styles={{ content: { color: palette.emeraldText } }} /></ParchmentCard></Col>
                <Col xs={12} sm={8}><ParchmentCard><Statistic title="Need attention" value={attention} styles={{ content: { color: attention ? palette.crimsonText : undefined } }} /></ParchmentCard></Col>
            </Row>

            <ParchmentCard
                title="Roster"
                extra={selected.length > 0 && (
                    <Space wrap>
                        <Typography.Text type="secondary">{selected.length} selected</Typography.Text>
                        <Button icon={<CaretRightFilled />} onClick={() => setState.mutate({ ids: selected, state: "running" })}>Start</Button>
                        <Button icon={<PauseOutlined />} onClick={() => setState.mutate({ ids: selected, state: "stopped" })}>Stop</Button>
                        <Popconfirm title={`Remove ${selected.length} account${selected.length > 1 ? "s" : ""}?`} description="Their bots stop and their settings are deleted. This can't be undone."
                            okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate({ ids: selected })}>
                            <Button danger icon={<DeleteOutlined />} loading={remove.isPending}>Remove</Button>
                        </Popconfirm>
                    </Space>
                )}>
                {limitHint && <Typography.Paragraph type="secondary" role="status">{limitHint}</Typography.Paragraph>}
                {!accounts.isPending && list.length === 0 ? (
                    <CrestEmpty title="No accounts yet" hint="Add a game account to start running bots."
                        action={<Button type="primary" icon={<PlusOutlined />} disabled={atLimit} onClick={() => setDrawer({ open: true })}>Add your first account</Button>} />
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
                                title: "Account", dataIndex: "name", sorter: (a, b) => a.name.localeCompare(b.name),
                                render: (name: string, a) => (
                                    <div>
                                        <Typography.Text strong>{name}</Typography.Text>
                                        <div><Typography.Text type="secondary" style={{ fontSize: 13 }}>{serverLabel.get(a.serverId) ?? `Server ${a.serverId}`}{a.externalEvent ? " · event" : ""}</Typography.Text></div>
                                    </div>
                                ),
                            },
                            { title: "Status", render: (_, a) => <SigilStatus state={a.status?.actualState} detail={a.status?.lastError} /> },
                            { title: "Plugins", render: (_, a) => Object.values(a.plugins).filter(p => p.enabled).length, width: 90 },
                            {
                                title: "Last seen", width: 140,
                                render: (_, a) => a.status?.heartbeatAt
                                    ? <Tooltip title={dayjs(a.status.heartbeatAt).format("D MMM YYYY HH:mm:ss")}>{dayjs(a.status.heartbeatAt).fromNow()}</Tooltip>
                                    : <Typography.Text type="secondary">—</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", width: 200, align: "right",
                                render: (_, a) => (
                                    <Space>
                                        {isRunning(a)
                                            ? <Button icon={<PauseOutlined />} onClick={() => setState.mutate({ ids: [a.id], state: "stopped" })}>Stop</Button>
                                            : <Button type="primary" ghost icon={<CaretRightFilled />} onClick={() => setState.mutate({ ids: [a.id], state: "running" })}>Start</Button>}
                                        <Button icon={<EditOutlined />} aria-label={`Edit ${a.name}`} onClick={() => setDrawer({ open: true, account: a })} />
                                    </Space>
                                ),
                            },
                        ]}
                    />
                )}
            </ParchmentCard>

            <AccountDrawer open={drawer.open} account={drawer.account} onClose={() => setDrawer({ open: false })} />
        </AppLayout>
    )
}
