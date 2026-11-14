import { SettingOutlined, TeamOutlined } from "@ant-design/icons"
import type { MenuProps } from "antd"
import type { ReactNode } from "react"
import { useNavigate } from "react-router"
import { CampaignLayout } from "@gge/ui"
import { useLogout, useMe } from "../auth.tsx"

const ROUTES = { accounts: "/", settings: "/settings" } as const

/** The signed-in shell shared by every player page. */
export function AppLayout({ activeKey, title, extra, accountMenu = [], children }: {
    activeKey: keyof typeof ROUTES
    title: ReactNode
    extra?: ReactNode
    accountMenu?: NonNullable<MenuProps["items"]>
    children: ReactNode
}) {
    const navigate = useNavigate()
    const me = useMe()
    const logout = useLogout()
    async function signOut() {
        await logout.mutateAsync({})
        navigate("/login", { replace: true })
    }
    return (
        <CampaignLayout
            product="GGE Command"
            nav={[
                { key: "accounts", label: "Accounts", icon: <TeamOutlined /> },
                { key: "settings", label: "Settings", icon: <SettingOutlined /> },
            ]}
            activeKey={activeKey}
            onNavigate={key => navigate(ROUTES[key as keyof typeof ROUTES])}
            title={title}
            username={me.data?.username ?? ""}
            onLogout={signOut}
            accountMenu={[{ key: "settings", icon: <SettingOutlined />, label: "Settings", onClick: () => navigate(ROUTES.settings) }, ...accountMenu]}
            extra={extra}>
            {children}
        </CampaignLayout>
    )
}
