import { CrownOutlined, ProfileOutlined, SettingOutlined, SyncOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons"
import { Grid, Tag, type MenuProps } from "antd"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"
import { CampaignLayout, type CommandItem } from "@gge/ui"
import { orpc } from "../api.ts"
import { useLogout, useMe, useSaveLocale } from "../auth.tsx"
import { pendingCode } from "../plan-model.ts"
import { useRealtimeState } from "../realtime.ts"
import { usePlanVisible } from "../use-billing.ts"
import { AlertBanners } from "./AlertBanners.tsx"
import { NotificationBell } from "./NotificationBell.tsx"

const ROUTES = { accounts: "/", logs: "/logs", plan: "/plan", settings: "/settings" } as const

/** The signed-in shell shared by every player page. */
export function AppLayout({ activeKey, title, extra, accountMenu = [], children }: {
    activeKey: keyof typeof ROUTES
    title: ReactNode
    extra?: ReactNode
    accountMenu?: NonNullable<MenuProps["items"]>
    children: ReactNode
}) {
    const navigate = useNavigate()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const me = useMe()
    const logout = useLogout()
    const saveLocale = useSaveLocale()
    const phone = !Grid.useBreakpoint().md
    const reconnecting = useRealtimeState() === "polling"
    const planVisible = usePlanVisible()
    const { pathname } = useLocation()
    const { t: tb } = useTranslation("bot")
    const verifiedUser = !!me.data?.emailVerified
    const accounts = useQuery({ ...orpc.accounts.list.queryOptions(), enabled: verifiedUser })
    const servers = useQuery({ ...orpc.servers.list.queryOptions(), enabled: verifiedUser })
    const catalog = useQuery({ ...orpc.plugins.catalog.queryOptions(), enabled: verifiedUser })
    // Accounts open their drawer through the Dashboard's ?account= link, and a plugin's settings through ?plugin=.
    const commands = useMemo<CommandItem[]>(() => {
        const serverLabel = new Map(servers.data?.map(s => [s.id, s.label]))
        const configurable = catalog.data?.filter(entry => entry.options.length > 0) ?? []
        return (accounts.data ?? []).flatMap(account => [
            {
                id: `account:${account.id}`, group: "accounts" as const, label: account.name, hint: serverLabel.get(account.serverId), icon: <UserOutlined />,
                keywords: [t("palette.accountKeyword")], run: () => navigate(`/?account=${account.id}`),
            },
            ...configurable.map(entry => {
                const label = tb(entry.key, { defaultValue: entry.key })
                return {
                    id: `plugin:${account.id}:${entry.key}`, group: "plugins" as const, label, hint: account.name, icon: <SettingOutlined />,
                    keywords: [entry.key, t("palette.pluginKeyword")], run: () => navigate(`/?account=${account.id}&plugin=${entry.key}`),
                }
            }),
        ])
    }, [accounts.data, servers.data, catalog.data, tb, t, navigate])
    // A code from a shared link waits through sign-up and the email check, then is redeemed on the first page they reach.
    const verified = !!me.data?.emailVerified
    useEffect(() => {
        if (verified && pathname !== "/redeem" && pendingCode())
            navigate("/redeem", { replace: true })
    }, [verified, pathname, navigate])
    async function signOut() {
        await logout.mutateAsync({})
        navigate("/login", { replace: true })
    }
    return (
        <CampaignLayout
            product="GGE Command"
            nav={[
                { key: "accounts", label: tc("nav.accounts"), icon: <TeamOutlined /> },
                { key: "logs", label: t("nav.logs"), icon: <ProfileOutlined /> },
                ...planVisible ? [{ key: "plan", label: t("nav.plan"), icon: <CrownOutlined /> }] : [],
                { key: "settings", label: tc("nav.settings"), icon: <SettingOutlined /> },
            ]}
            activeKey={activeKey}
            onNavigate={key => navigate(ROUTES[key as keyof typeof ROUTES])}
            title={title}
            banners={<AlertBanners />}
            username={me.data?.username ?? ""}
            onLogout={signOut}
            onLanguageChange={saveLocale}
            commands={commands}
            accountMenu={[{ key: "settings", icon: <SettingOutlined />, label: tc("nav.settings"), onClick: () => navigate(ROUTES.settings) }, ...accountMenu]}
            extra={<>
                {/* Always in the page, so a screen reader announces the text when it appears. */}
                <span role="status">
                    {reconnecting && (
                        <Tag color="warning" icon={<SyncOutlined spin />} style={{ margin: 0 }}
                            aria-label={t("layout.reconnectingLabel")}>
                            {phone ? null : t("layout.reconnecting")}
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
