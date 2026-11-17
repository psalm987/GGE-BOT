import { AuditOutlined, CloudServerOutlined, DashboardOutlined, SettingOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons"
import { Alert, Button } from "antd"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"
import { CampaignLayout, type NavItem } from "@gge/ui"
import { messageOf } from "../api.ts"
import { useLogout, useMe } from "../auth.tsx"

const NAV = [
    { key: "overview", path: "/", label: { key: "nav.overview", ns: "admin" }, icon: <DashboardOutlined /> },
    { key: "users", path: "/users", label: { key: "nav.users", ns: "admin" }, icon: <UserOutlined /> },
    { key: "accounts", path: "/accounts", label: { key: "nav.accounts", ns: "common" }, icon: <TeamOutlined /> },
    { key: "proxies", path: "/proxies", label: { key: "nav.proxies", ns: "admin" }, icon: <CloudServerOutlined /> },
    { key: "audit", path: "/audit", label: { key: "nav.audit", ns: "admin" }, icon: <AuditOutlined /> },
    { key: "settings", path: "/settings", label: { key: "nav.settings", ns: "common" }, icon: <SettingOutlined /> },
]

export function AdminPage({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { t } = useTranslation()
    const me = useMe()
    const logout = useLogout()
    const active = NAV.find(n => n.path !== "/" && pathname.startsWith(n.path)) ?? NAV[0]!
    return (
        <CampaignLayout
            product="GGE Command"
            nav={NAV.map(({ key, label, icon }): NavItem => ({ key, label: t(label.key, { ns: label.ns }), icon }))}
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
    const { t } = useTranslation("common")
    return <Alert type="error" showIcon role="alert" title={messageOf(error)} action={<Button size="small" onClick={onRetry}>{t("action.retry")}</Button>} style={{ marginBottom: 16 }} />
}

