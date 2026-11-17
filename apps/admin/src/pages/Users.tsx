import { CrownOutlined, UserOutlined } from "@ant-design/icons"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Flex, Input, Select, Space, Table, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { orpc } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { useListParams } from "../components/useListParams.ts"
import { AttackCapSelect, BotLimitInput, UserActionButtons, useUserActions, type UserRow as Row } from "../components/UserControls.tsx"

const FILTERS = { role: ["user", "admin"], status: ["active", "disabled"], plan: ["trial", "expiring", "none"] } as const
const EXPIRING_MS = 7 * 24 * 60 * 60 * 1000

export function Users() {
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const list = useListParams(FILTERS)
    const { role, status, plan } = list.values
    const users = useQuery(orpc.users.list.queryOptions({
        input: { search: list.search || undefined, role, status, plan, limit: list.size, offset: list.offset },
        placeholderData: keepPreviousData,
    }))
    const rows = users.data?.items ?? []
    const total = users.data?.total ?? 0
    const { clampTo } = list
    useEffect(() => { if (users.data && !users.isPlaceholderData) clampTo(users.data.total) }, [users.data, users.isPlaceholderData, clampTo])
    const actions = useUserActions()

    return (
        <AdminPage title={t("nav.users")}>
            {users.error && <QueryError error={users.error} onRetry={() => void users.refetch()} />}
            <ParchmentCard extra={
                <Flex wrap gap={8}>
                    <Input allowClear placeholder={t("users.searchPlaceholder")} aria-label={t("users.searchLabel")} style={{ width: 220, maxWidth: "100%" }}
                        value={list.draft} onChange={e => list.setDraft(e.target.value)} />
                    <Select allowClear placeholder={t("users.rolePlaceholder")} aria-label={t("users.filterRole")} style={{ width: 110 }} value={role}
                        options={[{ value: "user", label: t("role.player") }, { value: "admin", label: t("role.admin") }]} onChange={value => list.setFilter("role", value)} />
                    <Select allowClear placeholder={t("users.statusPlaceholder")} aria-label={t("users.filterStatus")} style={{ width: 120 }} value={status}
                        options={[{ value: "active", label: t("status.active") }, { value: "disabled", label: t("status.disabled") }]} onChange={value => list.setFilter("status", value)} />
                    <Select allowClear placeholder={t("users.planPlaceholder")} aria-label={t("users.filterPlan")} style={{ width: 170 }} value={plan}
                        options={[{ value: "trial", label: t("users.plan.trial") }, { value: "expiring", label: t("users.plan.expiring") }, { value: "none", label: t("users.plan.none") }]}
                        onChange={value => list.setFilter("plan", value)} />
                </Flex>
            } title={t("users.players")}>
                {!users.isPending && !users.error && total === 0 ? (
                    <CrestEmpty title={t("users.emptyTitle")} hint={list.search || role || status || plan ? t("list.tryDifferent") : t("users.emptyHint")} />
                ) : (
                    <Table<Row> rowKey="id" loading={users.isFetching} dataSource={rows} scroll={{ x: 1560 }}
                        pagination={{ current: list.page, pageSize: list.size, total, showSizeChanger: true, showTotal: n => t("users.total", { count: n }), hideOnSinglePage: total <= Math.min(list.size, 10) }}
                        onChange={({ current, pageSize }) => list.setPage(current ?? 1, pageSize ?? list.size)}
                        columns={[
                            { title: tc("field.username"), dataIndex: "username", render: (name: string, u) => <Link to={`/users/${u.id}`}><Typography.Text strong>{name}</Typography.Text></Link> },
                            { title: tc("field.email"), dataIndex: "email", render: (e: Row["email"], row: Row) => e ? <>{e} {row.emailVerified ? <Tag color="green">{t("email.verified")}</Tag> : <Tag color="orange">{t("email.unverified")}</Tag>}</> : <Typography.Text type="secondary">{tc("value.none")}</Typography.Text> },
                            { title: t("users.col.role"), dataIndex: "role", render: (role: Row["role"]) => role === "admin" ? <Tag icon={<CrownOutlined />} color="gold">{t("role.admin")}</Tag> : <Tag icon={<UserOutlined />}>{t("role.player")}</Tag> },
                            { title: tc("field.status"), dataIndex: "status", render: (s: Row["status"]) => s === "active" ? <Tag color="green">{t("status.active")}</Tag> : <Tag color="red">{t("status.disabled")}</Tag> },
                            {
                                title: t("users.col.plan"), dataIndex: "plan", width: 130,
                                render: (p: Row["plan"], u) => p
                                    ? <Space size={4}>{tc(`plan.${p.planId}`)}{p.isTrial && <Tag color="gold">{t("users.trial")}</Tag>}</Space>
                                    : <Typography.Text type="secondary">{u.role === "admin" ? t("users.planNotNeeded") : tc("value.none")}</Typography.Text>,
                            },
                            {
                                title: t("users.col.ends"), key: "ends", width: 140,
                                render: (_, u) => u.plan
                                    ? <Typography.Text type={u.plan.endsAt.getTime() - Date.now() < EXPIRING_MS ? "warning" : undefined}>{dayjs(u.plan.endsAt).format("D MMM YYYY")}</Typography.Text>
                                    : null,
                            },
                            {
                                title: t("users.col.bots"), dataIndex: "accountCount", width: 150,
                                render: (n: number, u) => <Space size={4}>{n} / <BotLimitInput user={u} actions={actions} /></Space>,
                            },
                            {
                                title: t("users.col.attack"), dataIndex: "attackPluginCap", width: 200,
                                render: (_: Row["attackPluginCap"], u) => <AttackCapSelect user={u} actions={actions} />,
                            },
                            { title: t("users.col.created"), dataIndex: "createdAt", render: (d: Date) => dayjs(d).format("D MMM YYYY") },
                            {
                                title: t("users.col.actions"), key: "actions", align: "right",
                                render: (_, u) => <UserActionButtons user={u} actions={actions} />,
                            },
                        ]} />
                )}
            </ParchmentCard>
        </AdminPage>
    )
}
