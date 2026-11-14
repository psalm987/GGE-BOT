import { CopyOutlined, PlusOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useState } from "react"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { client, messageOf, orpc, queryClient } from "../api.ts"
import { CLIENT_URL } from "../config.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

type Invite = Awaited<ReturnType<typeof client.invites.list>>[number]

function statusOf(i: Invite) {
    if (i.usedAt) return <Tag color="blue">Used by {i.usedBy ?? "someone"}</Tag>
    if (i.revokedAt) return <Tag>Revoked</Tag>
    if (dayjs(i.expiresAt).isBefore(dayjs())) return <Tag color="orange">Expired</Tag>
    return <Tag color="green">Open</Tag>
}
const isOpen = (i: Invite) => !i.usedAt && !i.revokedAt && dayjs(i.expiresAt).isAfter(dayjs())

export function Invites() {
    const { message } = App.useApp()
    const [creating, setCreating] = useState(false)
    const [created, setCreated] = useState<{ code: string; email: string | null } | null>(null)
    const invites = useQuery(orpc.invites.list.queryOptions())
    const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.invites.list.key() })
    const create = useMutation(orpc.invites.create.mutationOptions({
        onSuccess: ({ code, invite }) => { setCreating(false); setCreated({ code, email: invite.email }); void refresh() },
        onError: error => message.error(messageOf(error)),
    }))
    const revoke = useMutation(orpc.invites.revoke.mutationOptions({
        onSuccess: () => { message.success("Invite revoked"); void refresh() },
        onError: error => message.error(messageOf(error)),
    }))
    const list = invites.data ?? []
    const code = created?.code ?? null
    const link = created ? `${CLIENT_URL}/signup?${new URLSearchParams({ invite: created.code, ...(created.email && { email: created.email }) })}` : ""

    async function copy(text: string, what: string) {
        try {
            await navigator.clipboard.writeText(text)
            message.success(`${what} copied`)
        } catch {
            message.error("Couldn't copy. Select the text and copy it by hand.")
        }
    }

    return (
        <AdminPage title="Invites" extra={<Button type="primary" icon={<PlusOutlined />} className="gge-press" onClick={() => setCreating(true)}>Create invite</Button>}>
            {invites.error && <QueryError error={invites.error} onRetry={() => void invites.refetch()} />}
            <ParchmentCard title="Invites">
                {!invites.isPending && !invites.error && list.length === 0 ? (
                    <CrestEmpty title="No invites yet" hint="Create one to let someone join." />
                ) : (
                    <Table<Invite> rowKey="id" loading={invites.isPending} dataSource={list} pagination={list.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 700 }}
                        columns={[
                            { title: "Role", dataIndex: "role", render: (r: Invite["role"]) => r === "admin" ? "Admin" : "Player" },
                            { title: "Email", dataIndex: "email", render: (e: string | null) => e ?? "" },
                            { title: "Created", dataIndex: "createdAt", render: (d: Date) => dayjs(d).format("D MMM YYYY HH:mm") },
                            { title: "Expires", dataIndex: "expiresAt", render: (d: Date) => dayjs(d).format("D MMM YYYY HH:mm") },
                            { title: "Status", key: "status", render: (_, i) => statusOf(i) },
                            {
                                title: "", key: "actions", align: "right",
                                render: (_, i) => isOpen(i) && (
                                    <Popconfirm title="Revoke this invite?" description="The code will stop working." okText="Revoke" okButtonProps={{ danger: true }} onConfirm={() => revoke.mutate({ id: i.id })}>
                                        <Button danger>Revoke</Button>
                                    </Popconfirm>
                                ),
                            },
                        ]} />
                )}
            </ParchmentCard>

            <Modal title="Create invite" open={creating} onCancel={() => setCreating(false)} destroyOnHidden footer={null}>
                <Form layout="vertical" requiredMark={false} initialValues={{ role: "user", expiresInHours: 72 }} onFinish={({ email, ...values }) => create.mutate({ ...values, ...(email && { email }) })} disabled={create.isPending}>
                    <Form.Item label="Role" name="role">
                        <Select options={[{ value: "user", label: "Player" }, { value: "admin", label: "Admin" }]} />
                    </Form.Item>
                    <Form.Item label="Email (optional)" name="email" extra="We'll email the invite link, and the address is confirmed when they sign up."
                        rules={[{ type: "email", message: "Enter a valid email" }]}>
                        <Input type="email" autoComplete="off" />
                    </Form.Item>
                    <Form.Item label="Expires in (hours)" name="expiresInHours" rules={[{ required: true, message: "Enter a number of hours" }]}>
                        <InputNumber min={1} max={720} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Space style={{ justifyContent: "flex-end", width: "100%" }}>
                        <Button onClick={() => setCreating(false)}>Cancel</Button>
                        <Button type="primary" htmlType="submit" loading={create.isPending}>Create</Button>
                    </Space>
                </Form>
            </Modal>

            <Modal title="Invite created" open={code !== null} onCancel={() => setCreated(null)} destroyOnHidden
                footer={<Button type="primary" onClick={() => setCreated(null)}>Done</Button>}>
                <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="This code won't be shown again." description={created?.email ? `The link was emailed to ${created.email}. Copy it here too in case it doesn't arrive.` : "Copy it or the signup link now."} />
                <Typography.Text strong>Invite code</Typography.Text>
                <Space.Compact style={{ width: "100%", margin: "4px 0 16px" }}>
                    <Input readOnly value={code ?? ""} aria-label="Invite code" />
                    <Button icon={<CopyOutlined />} onClick={() => void copy(code ?? "", "Code")}>Copy code</Button>
                </Space.Compact>
                <Typography.Text strong>Signup link</Typography.Text>
                <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                    <Input readOnly value={link} aria-label="Signup link" />
                    <Button icon={<CopyOutlined />} onClick={() => void copy(link, "Link")}>Copy link</Button>
                </Space.Compact>
            </Modal>
        </AdminPage>
    )
}
