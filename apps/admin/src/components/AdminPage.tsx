import { AuditOutlined, DashboardOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons"
import { Alert, Button } from "antd"
import type { ReactNode } from "react"
import { useLocation, useNavigate } from "react-router"
import { CampaignLayout, type NavItem } from "@gge/ui"
import { messageOf } from "../api.ts"
import { useLogout, useMe } from "../auth.tsx"

const NAV: (NavItem & { path: string })[] = [
    { key: "overview", path: "/", label: "Overview", icon: <DashboardOutlined /> },
    { key: "users", path: "/users", label: "Users", icon: <UserOutlined /> },
    { key: "accounts", path: "/accounts", label: "Accounts", icon: <TeamOutlined /> },
    { key: "audit", path: "/audit", label: "Audit", icon: <AuditOutlined /> },
]

export function AdminPage({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const me = useMe()
    const logout = useLogout()
    const active = NAV.find(n => n.path === pathname) ?? NAV[0]!
    return (
        <CampaignLayout
            product="GGE Command"
            nav={NAV.map(({ key, label, icon }) => ({ key, label, icon }))}
            activeKey={active.key}
            onNavigate={key => navigate(NAV.find(n => n.key === key)!.path)}
            title={title}
            extra={extra}
            username={me.data?.username ?? ""}
            onLogout={async () => { await logout.mutateAsync({}); navigate("/login", { replace: true }) }}>
            {children}
        </CampaignLayout>
    )
}

/** A failed query, with a way to try again. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
    return <Alert type="error" showIcon role="alert" title={messageOf(error)} action={<Button size="small" onClick={onRetry}>Retry</Button>} style={{ marginBottom: 16 }} />
}

