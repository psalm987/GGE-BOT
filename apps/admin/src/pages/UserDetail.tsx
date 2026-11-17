import { CrownOutlined, UserOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Descriptions, Spin, Tabs, Tag, Typography } from "antd"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"
import { Link, useParams, useSearchParams } from "react-router"
import { CrestEmpty, ParchmentCard } from "@gge/ui"
import { orpc } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { AuditTable } from "../components/AuditTable.tsx"
import { UserAccounts } from "../components/UserAccounts.tsx"
import { AttackCapSelect, BotLimitInput, UserActionButtons, useUserActions } from "../components/UserControls.tsx"

const TABS = ["profile", "accounts", "audit"] as const
type Tab = (typeof TABS)[number]

const codeOf = (error: unknown) => (error as { code?: string } | null)?.code
const unknownUser = (error: unknown) => codeOf(error) === "NOT_FOUND" || codeOf(error) === "BAD_REQUEST"

export function UserDetail() {
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const { id = "" } = useParams()
    const [params, setParams] = useSearchParams()
    const tab = TABS.find(name => name === params.get("tab")) ?? "profile"
    const user = useQuery(orpc.users.get.queryOptions({
        input: { id },
        retry: (count, error) => !unknownUser(error) && codeOf(error) !== "UNAUTHORIZED" && count < 2,
    }))
    const actions = useUserActions()
    const u = user.data

    if (user.error && unknownUser(user.error))
        return (
            <AdminPage title={t("userDetail.userFallback")}>
                <ParchmentCard>
                    <CrestEmpty title={t("userDetail.noSuchTitle")} hint={t("userDetail.noSuchHint")}
                        action={<Link to="/users">{t("userDetail.backToUsers")}</Link>} />
                </ParchmentCard>
            </AdminPage>
        )

    const change = (next: string) => setParams(prev => {
        const query = new URLSearchParams(prev)
        if (next === "profile") query.delete("tab"); else query.set("tab", next)
        query.delete("account")
        return query
    }, { replace: true })

    return (
        <AdminPage title={u?.username ?? t("userDetail.userFallback")} extra={<Link to="/users">{t("userDetail.allUsers")}</Link>}>
            {user.error && <QueryError error={user.error} onRetry={() => void user.refetch()} />}
            {user.isPending && <Spin />}
            {u && (
                <ParchmentCard>
                    <Tabs activeKey={tab} onChange={change} destroyOnHidden items={[
                        {
                            key: "profile", label: t("userDetail.profile"),
                            children: (
                                <>
                                    <Descriptions column={{ xs: 1, md: 2 }} bordered size="small" items={[
                                        { key: "username", label: tc("field.username"), children: <Typography.Text strong>{u.username}</Typography.Text> },
                                        {
                                            key: "email", label: tc("field.email"),
                                            children: u.email ? <>{u.email} {u.emailVerified ? <Tag color="green">{t("email.verified")}</Tag> : <Tag color="orange">{t("email.unverified")}</Tag>}</> : <Typography.Text type="secondary">{tc("value.none")}</Typography.Text>,
                                        },
                                        { key: "role", label: t("userDetail.role"), children: u.role === "admin" ? <Tag icon={<CrownOutlined />} color="gold">{t("role.admin")}</Tag> : <Tag icon={<UserOutlined />}>{t("role.player")}</Tag> },
                                        { key: "status", label: tc("field.status"), children: u.status === "active" ? <Tag color="green">{t("status.active")}</Tag> : <Tag color="red">{t("status.disabled")}</Tag> },
                                        { key: "limit", label: t("userDetail.planLimit"), children: <>{u.accountCount} / <BotLimitInput user={u} actions={actions} /> {t("userDetail.botsSuffix")}</> },
                                        { key: "attack", label: t("userDetail.attackPlugins"), children: <AttackCapSelect user={u} actions={actions} /> },
                                        { key: "2fa", label: t("userDetail.twoFactor"), children: u.totpEnabled ? <Tag color="green">{t("userDetail.enabled")}</Tag> : <Tag>{t("userDetail.notSetUp")}</Tag> },
                                        { key: "created", label: t("userDetail.created"), children: dayjs(u.createdAt).format("D MMM YYYY HH:mm") },
                                        { key: "login", label: t("userDetail.lastSignIn"), children: u.lastLoginAt ? dayjs(u.lastLoginAt).format("D MMM YYYY HH:mm") : <Typography.Text type="secondary">{tc("value.never")}</Typography.Text> },
                                        { key: "sessions", label: t("userDetail.activeSessions"), children: t("userDetail.sessions", { client: u.sessions.client, admin: u.sessions.admin }) },
                                    ]} />
                                    <div style={{ marginTop: 16 }}>
                                        <UserActionButtons user={u} actions={actions} />
                                    </div>
                                </>
                            ),
                        },
                        { key: "accounts", label: tc("nav.accounts"), children: <UserAccounts userId={u.id} /> },
                        { key: "audit", label: t("nav.audit"), children: <AuditTable actorId={u.id} targetId={u.id} emptyHint={t("userDetail.auditEmpty")} /> },
                    ] satisfies { key: Tab; label: string; children: React.ReactNode }[]} />
                </ParchmentCard>
            )}
        </AdminPage>
    )
}
