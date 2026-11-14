import { CheckCircleOutlined, CrownOutlined, LogoutOutlined, StopOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Input, InputNumber, Popconfirm, Space, Table, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useState } from "react"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { client, messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"

type Row = Awaited<ReturnType<typeof client.users.list>>[number]

export function Users() {
    const { message } = App.useApp()
    const [search, setSearch] = useState("")
    const input = { search: search.trim() || undefined }
    const users = useQuery(orpc.users.list.queryOptions({ input }))
    const settle = (done: string) => ({
        onSuccess: () => { message.success(done); void queryClient.invalidateQueries({ queryKey: orpc.users.list.key() }) },
        onError: (error: unknown) => message.error(messageOf(error)),
    })
    const setStatus = useMutation(orpc.users.setStatus.mutationOptions(settle("User updated")))
    const setRole = useMutation(orpc.users.setRole.mutationOptions(settle("Role updated")))
    const setMaxBots = useMutation(orpc.users.setMaxBots.mutationOptions(settle("Bot limit updated")))
    const revoke = useMutation(orpc.users.revokeSessions.mutationOptions(settle("Signed out everywhere")))
    const list = users.data ?? []

    return (
        <AdminPage title="Users">
            {users.error && <QueryError error={users.error} onRetry={() => void users.refetch()} />}
            <ParchmentCard extra={
                <Input.Search allowClear placeholder="Search by username" aria-label="Search users" style={{ width: 240, maxWidth: "100%" }} onSearch={setSearch} />
            } title="Players">
                {!users.isPending && !users.error && list.length === 0 ? (
                    <CrestEmpty title="No users found" hint={search ? "Try a different search." : "Players appear here once they sign up."} />
                ) : (
                    <Table<Row> rowKey="id" loading={users.isPending} dataSource={list} pagination={list.length > 20 ? { pageSize: 20 } : false} scroll={{ x: 1100 }}
                        columns={[
                            { title: "Username", dataIndex: "username", render: (name: string) => <Typography.Text strong>{name}</Typography.Text> },
                            { title: "Email", dataIndex: "email", render: (e: Row["email"], row: Row) => e ? <>{e} {row.emailVerified ? <Tag color="green">Verified</Tag> : <Tag color="orange">Unverified</Tag>}</> : <Typography.Text type="secondary">None</Typography.Text> },
                            { title: "Role", dataIndex: "role", render: (role: Row["role"]) => role === "admin" ? <Tag icon={<CrownOutlined />} color="gold">Admin</Tag> : <Tag icon={<UserOutlined />}>Player</Tag> },
                            { title: "Status", dataIndex: "status", render: (s: Row["status"]) => s === "active" ? <Tag color="green">Active</Tag> : <Tag color="red">Disabled</Tag> },
                            {
                                title: "Bots", dataIndex: "accountCount", width: 150,
                                render: (n: number, u) => (
                                    <Space size={4}>
                                        {n} /
                                        <InputNumber key={`${u.id}:${u.maxBots}`} size="small" min={0} max={50} precision={0} defaultValue={u.maxBots} style={{ width: 64 }}
                                            aria-label={`Bot limit for ${u.username}`} disabled={u.role === "admin"} title={u.role === "admin" ? "Admins have no limit" : undefined}
                                            onBlur={e => {
                                                const value = Number(e.target.value)
                                                if (Number.isInteger(value) && value >= 0 && value <= 50 && value !== u.maxBots)
                                                    setMaxBots.mutate({ id: u.id, maxBots: value })
                                            }}
                                            onPressEnter={e => e.currentTarget.blur()} />
                                    </Space>
                                ),
                            },
                            { title: "Created", dataIndex: "createdAt", render: (d: Date) => dayjs(d).format("D MMM YYYY") },
                            {
                                title: "Actions", key: "actions", align: "right",
                                render: (_, u) => (
                                    <Space wrap>
                                        {u.status === "active" ? (
                                            <Popconfirm title={`Disable ${u.username}?`} description="Disabling ends their sessions and stops their bots." okText="Disable"
                                                okButtonProps={{ danger: true }} onConfirm={() => setStatus.mutate({ id: u.id, status: "disabled" })}>
                                                <Button danger icon={<StopOutlined />}>Disable</Button>
                                            </Popconfirm>
                                        ) : (
                                            <Button icon={<CheckCircleOutlined />} onClick={() => setStatus.mutate({ id: u.id, status: "active" })}>Enable</Button>
                                        )}
                                        <Button icon={<CrownOutlined />} onClick={() => setRole.mutate({ id: u.id, role: u.role === "admin" ? "user" : "admin" })}>
                                            {u.role === "admin" ? "Make player" : "Make admin"}
                                        </Button>
                                        <Button icon={<LogoutOutlined />} aria-label={`Sign ${u.username} out everywhere`} onClick={() => revoke.mutate({ id: u.id })}>Sign out everywhere</Button>
                                    </Space>
                                ),
                            },
                        ]} />
                )}
            </ParchmentCard>
        </AdminPage>
    )
}
