import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Flex, Form, Input, InputNumber, Modal, Popconfirm, Switch, Table, Tag, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { parseProxyUrl } from "@gge/contracts"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { client, messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

dayjs.extend(relativeTime)

type Proxy = Awaited<ReturnType<typeof client.proxies.list>>[number]
type Editing = { name: "closed" } | { name: "creating" } | { name: "editing"; proxy: Proxy }
type Fields = { label: string; url?: string; maxAccounts: number }

const REFRESH_MS = 15_000
const URL_EXAMPLE = "socks5h://user:password@host:1080"
const when = (date: Date) => <Tooltip title={dayjs(date).format("D MMM YYYY HH:mm:ss")}>{dayjs(date).fromNow()}</Tooltip>

function Health({ proxy }: { proxy: Proxy }) {
    const { t } = useTranslation("admin")
    if (!proxy.enabled)
        return proxy.disabledReason
            ? <><Tag color="red">{t("proxies.offAuto")}</Tag><div><Typography.Text type="secondary">{proxy.disabledReason}</Typography.Text></div></>
            : <Tag>{t("proxies.off")}</Tag>
    if (proxy.consecutiveFailures > 0)
        return <Tag color="orange">{t("proxies.failedInARow", { count: proxy.consecutiveFailures })}</Tag>
    return proxy.lastOkAt ? <><Tag color="green">{t("proxies.healthy")}</Tag> {when(proxy.lastOkAt)}</> : <Tag>{t("proxies.notUsed")}</Tag>
}

export function Proxies() {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const [editing, setEditing] = useState<Editing>({ name: "closed" })
    const [form] = Form.useForm<Fields>()
    const proxies = useQuery(orpc.proxies.list.queryOptions({ refetchInterval: REFRESH_MS }))
    const rows = proxies.data ?? []
    const close = () => { form.resetFields(); setEditing({ name: "closed" }) }
    const settle = (done: string) => ({
        onSuccess: () => {
            message.success(done)
            close()
            for (const queryKey of [orpc.proxies.list.key(), orpc.accounts.list.key(), ["audit"]])
                void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
    const create = useMutation(orpc.proxies.create.mutationOptions(settle(t("proxies.added"))))
    const update = useMutation(orpc.proxies.update.mutationOptions(settle(t("proxies.updated"))))
    const remove = useMutation(orpc.proxies.remove.mutationOptions(settle(t("proxies.deleted"))))
    const saving = create.isPending || update.isPending
    const edited = editing.name === "editing" ? editing.proxy : undefined

    const save = ({ label, url, maxAccounts }: Fields) => {
        const trimmed = url?.trim()
        if (edited)
            update.mutate({ id: edited.id, label, maxAccounts, ...(trimmed && { url: trimmed }) })
        else
            create.mutate({ label, url: trimmed ?? "", maxAccounts })
    }

    return (
        <AdminPage title={t("nav.proxies")}>
            {proxies.error && <QueryError error={proxies.error} onRetry={() => void proxies.refetch()} />}
            <ParchmentCard title={t("proxies.pool")} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ name: "creating" })}>{t("proxies.add")}</Button>}>
                <Typography.Paragraph type="secondary">{t("proxies.intro")}</Typography.Paragraph>
                {!proxies.isPending && !proxies.error && rows.length === 0 ? (
                    <CrestEmpty title={t("proxies.emptyTitle")} hint={t("proxies.emptyHint")} />
                ) : (
                    <Table<Proxy> rowKey="id" loading={proxies.isPending} dataSource={rows} pagination={false} scroll={{ x: 980 }}
                        columns={[
                            { title: t("proxies.col.label"), dataIndex: "label", render: (label: string) => <Typography.Text strong>{label}</Typography.Text> },
                            { title: t("proxies.col.host"), dataIndex: "hostHint", render: (hint: string) => <Typography.Text code>{hint}</Typography.Text> },
                            {
                                title: t("proxies.col.enabled"), dataIndex: "enabled", width: 90,
                                render: (enabled: boolean, p) => (
                                    <Switch checked={enabled} aria-label={t("proxies.enabledLabel", { label: p.label })} loading={update.isPending && update.variables?.id === p.id}
                                        onChange={next => update.mutate({ id: p.id, enabled: next })} />
                                ),
                            },
                            {
                                title: t("proxies.col.load"), key: "load", width: 90,
                                render: (_, p) => <Tooltip title={t("proxies.loadTip")}>{p.accountCount}/{p.maxAccounts}</Tooltip>,
                            },
                            { title: t("proxies.col.health"), key: "health", render: (_, p) => <Health proxy={p} /> },
                            {
                                title: t("proxies.col.lastError"), dataIndex: "lastError",
                                render: (error: Proxy["lastError"], p) => error
                                    ? <><Typography.Text code>{error}</Typography.Text> {p.lastErrorAt && when(p.lastErrorAt)}</>
                                    : <Typography.Text type="secondary">{tc("value.none")}</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", align: "right",
                                render: (_, p) => (
                                    <Flex gap={8} justify="flex-end">
                                        <Button icon={<EditOutlined />} aria-label={t("proxies.editLabel", { label: p.label })}
                                            onClick={() => { form.setFieldsValue({ label: p.label, maxAccounts: p.maxAccounts, url: "" }); setEditing({ name: "editing", proxy: p }) }}>{t("proxies.edit")}</Button>
                                        <Popconfirm title={t("proxies.deleteConfirm", { label: p.label })} okText={tc("action.delete")} okButtonProps={{ danger: true }}
                                            description={p.accountCount ? t("proxies.deleteBodyUsed") : t("proxies.deleteBodyFree")}
                                            onConfirm={() => remove.mutate({ id: p.id })}>
                                            <Button danger icon={<DeleteOutlined />} aria-label={t("proxies.deleteLabel", { label: p.label })}>{tc("action.delete")}</Button>
                                        </Popconfirm>
                                    </Flex>
                                ),
                            },
                        ]} />
                )}
            </ParchmentCard>
            <Modal open={editing.name !== "closed"} onCancel={close} destroyOnHidden title={edited ? t("proxies.modalEdit", { label: edited.label }) : t("proxies.modalAdd")}
                okText={edited ? tc("action.save") : t("proxies.add")} confirmLoading={saving} onOk={() => form.submit()}>
                <Form form={form} layout="vertical" requiredMark={false} disabled={saving} initialValues={{ maxAccounts: 3 }} onFinish={save}>
                    <Form.Item label={t("proxies.col.label")} name="label" rules={[{ required: true, whitespace: true, message: t("proxies.nameRequired") }, { max: 64 }]}>
                        <Input autoFocus autoComplete="off" />
                    </Form.Item>
                    <Form.Item label={t("proxies.urlLabel")} name="url"
                        extra={t("proxies.urlHint")}
                        rules={[{
                            validator: async (_, value?: string) => {
                                const url = value?.trim()
                                if (!url && edited)
                                    return
                                if (!url || !parseProxyUrl(url))
                                    throw new Error(t("proxies.urlInvalid", { example: URL_EXAMPLE }))
                            },
                        }]}>
                        <Input.Password autoComplete="new-password" spellCheck={false} placeholder={edited ? t("proxies.urlKeep") : URL_EXAMPLE} />
                    </Form.Item>
                    <Form.Item label={t("proxies.maxLabel")} name="maxAccounts" extra={t("proxies.maxHint")}
                        rules={[{ required: true, message: t("proxies.maxRequired") }]}>
                        <InputNumber min={1} max={1000} precision={0} style={{ width: 120 }} />
                    </Form.Item>
                </Form>
            </Modal>
        </AdminPage>
    )
}
