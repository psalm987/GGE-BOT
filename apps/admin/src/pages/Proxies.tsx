import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Flex, Form, Input, InputNumber, Modal, Popconfirm, Switch, Table, Tag, Tooltip, Typography } from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useState } from "react"
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
    if (!proxy.enabled)
        return proxy.disabledReason
            ? <><Tag color="red">Turned off automatically</Tag><div><Typography.Text type="secondary">{proxy.disabledReason}</Typography.Text></div></>
            : <Tag>Off</Tag>
    if (proxy.consecutiveFailures > 0)
        return <Tag color="orange">{proxy.consecutiveFailures} failed in a row</Tag>
    return proxy.lastOkAt ? <><Tag color="green">Healthy</Tag> {when(proxy.lastOkAt)}</> : <Tag>Not used yet</Tag>
}

export function Proxies() {
    const { message } = App.useApp()
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
    const create = useMutation(orpc.proxies.create.mutationOptions(settle("Proxy added")))
    const update = useMutation(orpc.proxies.update.mutationOptions(settle("Proxy updated")))
    const remove = useMutation(orpc.proxies.remove.mutationOptions(settle("Proxy deleted")))
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
        <AdminPage title="Proxies">
            {proxies.error && <QueryError error={proxies.error} onRetry={() => void proxies.refetch()} />}
            <ParchmentCard title="Proxy pool" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ name: "creating" })}>Add proxy</Button>}>
                <Typography.Paragraph type="secondary">
                    Bots connect to the game through these, so the accounts don't all share the server's address. Each account keeps one proxy,
                    and an event twin uses its main account's. A proxy that fails 5 connections in a row is turned off, and its accounts move to another.
                </Typography.Paragraph>
                {!proxies.isPending && !proxies.error && rows.length === 0 ? (
                    <CrestEmpty title="No proxies" hint="Without any, every bot connects directly from the server." />
                ) : (
                    <Table<Proxy> rowKey="id" loading={proxies.isPending} dataSource={rows} pagination={false} scroll={{ x: 980 }}
                        columns={[
                            { title: "Label", dataIndex: "label", render: (label: string) => <Typography.Text strong>{label}</Typography.Text> },
                            { title: "Host", dataIndex: "hostHint", render: (hint: string) => <Typography.Text code>{hint}</Typography.Text> },
                            {
                                title: "Enabled", dataIndex: "enabled", width: 90,
                                render: (enabled: boolean, p) => (
                                    <Switch checked={enabled} aria-label={`${p.label} enabled`} loading={update.isPending && update.variables?.id === p.id}
                                        onChange={next => update.mutate({ id: p.id, enabled: next })} />
                                ),
                            },
                            {
                                title: "Load", key: "load", width: 90,
                                render: (_, p) => <Tooltip title="Accounts assigned / the most the runner assigns on its own">{p.accountCount}/{p.maxAccounts}</Tooltip>,
                            },
                            { title: "Health", key: "health", render: (_, p) => <Health proxy={p} /> },
                            {
                                title: "Last error", dataIndex: "lastError",
                                render: (error: Proxy["lastError"], p) => error
                                    ? <><Typography.Text code>{error}</Typography.Text> {p.lastErrorAt && when(p.lastErrorAt)}</>
                                    : <Typography.Text type="secondary">None</Typography.Text>,
                            },
                            {
                                title: "", key: "actions", align: "right",
                                render: (_, p) => (
                                    <Flex gap={8} justify="flex-end">
                                        <Button icon={<EditOutlined />} aria-label={`Edit ${p.label}`}
                                            onClick={() => { form.setFieldsValue({ label: p.label, maxAccounts: p.maxAccounts, url: "" }); setEditing({ name: "editing", proxy: p }) }}>Edit</Button>
                                        <Popconfirm title={`Delete ${p.label}?`} okText="Delete" okButtonProps={{ danger: true }}
                                            description={p.accountCount ? "Its accounts lose their proxy. The runner gives each another one the next time it starts." : "No account uses it."}
                                            onConfirm={() => remove.mutate({ id: p.id })}>
                                            <Button danger icon={<DeleteOutlined />} aria-label={`Delete ${p.label}`}>Delete</Button>
                                        </Popconfirm>
                                    </Flex>
                                ),
                            },
                        ]} />
                )}
            </ParchmentCard>
            <Modal open={editing.name !== "closed"} onCancel={close} destroyOnHidden title={edited ? `Edit ${edited.label}` : "Add a proxy"}
                okText={edited ? "Save" : "Add proxy"} confirmLoading={saving} onOk={() => form.submit()}>
                <Form form={form} layout="vertical" requiredMark={false} disabled={saving} initialValues={{ maxAccounts: 3 }} onFinish={save}>
                    <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true, message: "Give the proxy a name" }, { max: 64 }]}>
                        <Input autoFocus autoComplete="off" />
                    </Form.Item>
                    <Form.Item label="Proxy URL" name="url"
                        extra="Stored sealed, so only the runner can read it and it is never shown again. Use socks5h so the proxy looks up the game's address."
                        rules={[{
                            validator: async (_, value?: string) => {
                                const url = value?.trim()
                                if (!url && edited)
                                    return
                                if (!url || !parseProxyUrl(url))
                                    throw new Error(`Use http, https, socks5 or socks5h with a host and a port, like ${URL_EXAMPLE}`)
                            },
                        }]}>
                        <Input.Password autoComplete="new-password" spellCheck={false} placeholder={edited ? "Leave empty to keep the current URL" : URL_EXAMPLE} />
                    </Form.Item>
                    <Form.Item label="Accounts" name="maxAccounts" extra="The most accounts the runner puts on this proxy on its own. Pinning an account by hand can go over it."
                        rules={[{ required: true, message: "Enter a number from 1 to 1000" }]}>
                        <InputNumber min={1} max={1000} precision={0} style={{ width: 120 }} />
                    </Form.Item>
                </Form>
            </Modal>
        </AdminPage>
    )
}
