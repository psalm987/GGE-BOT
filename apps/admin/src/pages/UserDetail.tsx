import { CrownOutlined, UserOutlined } from "@ant-design/icons"
import { useQuery } from "@tanstack/react-query"
import { Descriptions, Spin, Tabs, Tag, Typography } from "antd"
import dayjs from "dayjs"
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
    const { id = "" } = useParams()
    const [params, setParams] = useSearchParams()
    const tab = TABS.find(t => t === params.get("tab")) ?? "profile"
    const user = useQuery(orpc.users.get.queryOptions({
        input: { id },
        retry: (count, error) => !unknownUser(error) && codeOf(error) !== "UNAUTHORIZED" && count < 2,
    }))
    const actions = useUserActions()
    const u = user.data

    if (user.error && unknownUser(user.error))
        return (
            <AdminPage title="User">
                <ParchmentCard>
                    <CrestEmpty title="No such user" hint="This user doesn't exist, or was deleted."
                        action={<Link to="/users">Back to users</Link>} />
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
        <AdminPage title={u?.username ?? "User"} extra={<Link to="/users">All users</Link>}>
            {user.error && <QueryError error={user.error} onRetry={() => void user.refetch()} />}
            {user.isPending && <Spin />}
            {u && (
                <ParchmentCard>
                    <Tabs activeKey={tab} onChange={change} destroyOnHidden items={[
                        {
                            key: "profile", label: "Profile",
                            children: (
                                <>
                                    <Descriptions column={{ xs: 1, md: 2 }} bordered size="small" items={[
                                        { key: "username", label: "Username", children: <Typography.Text strong>{u.username}</Typography.Text> },
                                        {
                                            key: "email", label: "Email",
                                            children: u.email ? <>{u.email} {u.emailVerified ? <Tag color="green">Verified</Tag> : <Tag color="orange">Unverified</Tag>}</> : <Typography.Text type="secondary">None</Typography.Text>,
                                        },
                                        { key: "role", label: "Role", children: u.role === "admin" ? <Tag icon={<CrownOutlined />} color="gold">Admin</Tag> : <Tag icon={<UserOutlined />}>Player</Tag> },
                                        { key: "status", label: "Status", children: u.status === "active" ? <Tag color="green">Active</Tag> : <Tag color="red">Disabled</Tag> },
                                        { key: "limit", label: "Plan limit", children: <>{u.accountCount} / <BotLimitInput user={u} actions={actions} /> bots</> },
                                        { key: "attack", label: "Attack plugins", children: <AttackCapSelect user={u} actions={actions} /> },
                                        { key: "2fa", label: "Two-factor sign-in", children: u.totpEnabled ? <Tag color="green">Enabled</Tag> : <Tag>Not set up</Tag> },
                                        { key: "created", label: "Created", children: dayjs(u.createdAt).format("D MMM YYYY HH:mm") },
                                        { key: "login", label: "Last sign-in", children: u.lastLoginAt ? dayjs(u.lastLoginAt).format("D MMM YYYY HH:mm") : <Typography.Text type="secondary">Never</Typography.Text> },
                                        { key: "sessions", label: "Active sessions", children: `${u.sessions.client} player app, ${u.sessions.admin} admin app` },
                                    ]} />
                                    <div style={{ marginTop: 16 }}>
                                        <UserActionButtons user={u} actions={actions} />
                                    </div>
                                </>
                            ),
                        },
                        { key: "accounts", label: "Accounts", children: <UserAccounts userId={u.id} /> },
                        { key: "audit", label: "Audit", children: <AuditTable actorId={u.id} targetId={u.id} emptyHint="Actions by or about this user will appear here." /> },
                    ] satisfies { key: Tab; label: string; children: React.ReactNode }[]} />
                </ParchmentCard>
            )}
        </AdminPage>
    )
}
