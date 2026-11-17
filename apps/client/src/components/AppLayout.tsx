import { SettingOutlined, SyncOutlined, TeamOutlined } from "@ant-design/icons"
import { Grid, Tag, type MenuProps } from "antd"
import type { ReactNode } from "react"
import { useNavigate } from "react-router"
import { CampaignLayout } from "@gge/ui"
import { useLogout, useMe, useSaveLocale } from "../auth.tsx"
import { useRealtimeState } from "../realtime.ts"
import { NotificationBell } from "./NotificationBell.tsx"

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
    const saveLocale = useSaveLocale()
    const phone = !Grid.useBreakpoint().md
    const reconnecting = useRealtimeState() === "polling"
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
            onLanguageChange={saveLocale}
            accountMenu={[{ key: "settings", icon: <SettingOutlined />, label: "Settings", onClick: () => navigate(ROUTES.settings) }, ...accountMenu]}
            extra={<>
                {/* Always in the page, so a screen reader announces the text when it appears. */}
                <span role="status">
                    {reconnecting && (
                        <Tag color="warning" icon={<SyncOutlined spin />} style={{ margin: 0 }}
                            aria-label="Live updates are reconnecting. Statuses refresh every 15 seconds until then.">
                            {phone ? null : "Reconnecting…"}
                        </Tag>
                    )}
                </span>
                {extra}
                <NotificationBell />
            </>}>
            {children}
        </CampaignLayout>
    )
}
