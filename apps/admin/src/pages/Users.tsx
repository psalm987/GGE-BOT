import { CrownOutlined, UserOutlined } from "@ant-design/icons"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Flex, Input, Select, Space, Table, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useEffect } from "react"
import { Link } from "react-router"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { orpc } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { useListParams } from "../components/useListParams.ts"
import { AttackCapSelect, BotLimitInput, UserActionButtons, useUserActions, type UserRow as Row } from "../components/UserControls.tsx"

const FILTERS = { role: ["user", "admin"], status: ["active", "disabled"] } as const

export function Users() {
    const list = useListParams(FILTERS)
    const { role, status } = list.values
    const users = useQuery(orpc.users.list.queryOptions({
        input: { search: list.search || undefined, role, status, limit: list.size, offset: list.offset },
        placeholderData: keepPreviousData,
    }))
    const rows = users.data?.items ?? []
    const total = users.data?.total ?? 0
    const { clampTo } = list
    useEffect(() => { if (users.data && !users.isPlaceholderData) clampTo(users.data.total) }, [users.data, users.isPlaceholderData, clampTo])
    const actions = useUserActions()

    return (
        <AdminPage title="Users">
            {users.error && <QueryError error={users.error} onRetry={() => void users.refetch()} />}
            <ParchmentCard extra={
                <Flex wrap gap={8}>
                    <Input allowClear placeholder="Search by username" aria-label="Search users" style={{ width: 220, maxWidth: "100%" }}
                        value={list.draft} onChange={e => list.setDraft(e.target.value)} />
                    <Select allowClear placeholder="Role" aria-label="Filter by role" style={{ width: 110 }} value={role}
                        options={[{ value: "user", label: "Player" }, { value: "admin", label: "Admin" }]} onChange={value => list.setFilter("role", value)} />
                    <Select allowClear placeholder="Status" aria-label="Filter by status" style={{ width: 120 }} value={status}
                        options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} onChange={value => list.setFilter("status", value)} />
                </Flex>
            } title="Players">
                {!users.isPending && !users.error && total === 0 ? (
                    <CrestEmpty title="No users found" hint={list.search || role || status ? "Try a different search or filter." : "Players appear here once they sign up."} />
                ) : (
                    <Table<Row> rowKey="id" loading={users.isFetching} dataSource={rows} scroll={{ x: 1300 }}
                        pagination={{ current: list.page, pageSize: list.size, total, showSizeChanger: true, showTotal: n => `${n} users`, hideOnSinglePage: total <= Math.min(list.size, 10) }}
                        onChange={({ current, pageSize }) => list.setPage(current ?? 1, pageSize ?? list.size)}
                        columns={[
                            { title: "Username", dataIndex: "username", render: (name: string, u) => <Link to={`/users/${u.id}`}><Typography.Text strong>{name}</Typography.Text></Link> },
                            { title: "Email", dataIndex: "email", render: (e: Row["email"], row: Row) => e ? <>{e} {row.emailVerified ? <Tag color="green">Verified</Tag> : <Tag color="orange">Unverified</Tag>}</> : <Typography.Text type="secondary">None</Typography.Text> },
                            { title: "Role", dataIndex: "role", render: (role: Row["role"]) => role === "admin" ? <Tag icon={<CrownOutlined />} color="gold">Admin</Tag> : <Tag icon={<UserOutlined />}>Player</Tag> },
                            { title: "Status", dataIndex: "status", render: (s: Row["status"]) => s === "active" ? <Tag color="green">Active</Tag> : <Tag color="red">Disabled</Tag> },
                            {
                                title: "Bots", dataIndex: "accountCount", width: 150,
                                render: (n: number, u) => <Space size={4}>{n} / <BotLimitInput user={u} actions={actions} /></Space>,
                            },
                            {
                                title: "Attack plugins", dataIndex: "attackPluginCap", width: 200,
                                render: (_: Row["attackPluginCap"], u) => <AttackCapSelect user={u} actions={actions} />,
                            },
                            { title: "Created", dataIndex: "createdAt", render: (d: Date) => dayjs(d).format("D MMM YYYY") },
                            {
                                title: "Actions", key: "actions", align: "right",
                                render: (_, u) => <UserActionButtons user={u} actions={actions} />,
                            },
                        ]} />
                )}
            </ParchmentCard>
        </AdminPage>
    )
}
