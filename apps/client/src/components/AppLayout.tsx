import { InfoCircleOutlined, SettingOutlined, SyncOutlined, UserOutlined } from "@ant-design/icons"
import { moduleOfPlugin } from "@gge/contracts"
import { App, Grid, Tag, type MenuProps } from "antd"
import { useQuery } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Outlet, useLocation, useNavigate } from "react-router"
import { CampaignLayout, type CommandItem } from "@gge/ui"
import { orpc } from "../api.ts"
import { useLogout, useMe, useSaveLocale } from "../auth.tsx"
import { buildNav, pathOf } from "../nav.ts"
import { pendingCode } from "../plan-model.ts"
import { useRealtimeState } from "../realtime.ts"
import { hasUnsaved, setUnsaved } from "../unsaved.ts"
import { usePlanVisible } from "../use-billing.ts"
import { AlertBanners } from "./AlertBanners.tsx"
import { NotificationBell } from "./NotificationBell.tsx"

/** What a page says about itself to the shell around it. */
type Chrome = {
    /** A page key ("accounts", "logs", "plan", "settings") or a module's, "m:<id>". */
    activeKey: string
    title: ReactNode
    extra?: ReactNode
    accountMenu?: NonNullable<MenuProps["items"]>
}
const SetChrome = createContext<(chrome: Chrome) => void>(() => {})

/**
 * What a page puts in the shell's header and menu, and the page itself. The shell is one route above the pages, so the sidebar
 * keeps its scroll position and open groups while the player moves between them.
 */
export function AppLayout({ activeKey, title, extra, accountMenu, children }: Chrome & { children: ReactNode }) {
    const setChrome = useContext(SetChrome)
    useLayoutEffect(() => setChrome({ activeKey, title, extra, accountMenu }))
    return children
}

/** The signed-in shell shared by every player page: the sidebar and the header, with the page in between. */
export function AppShell() {
    const [{ activeKey, title, extra, accountMenu = [] }, setChrome] = useState<Chrome>({ activeKey: "accounts", title: null })
    const routerNavigate = useNavigate()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const { modal } = App.useApp()
    // A module page with unsaved edits asks before the shell takes the player anywhere else.
    const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
        if (!hasUnsaved()) return routerNavigate(to, options)
        modal.confirm({
            title: t("drawer.discardTitle"), content: t("drawer.discardBody"), okText: t("drawer.discard"), okButtonProps: { danger: true }, cancelText: t("drawer.keepEditing"),
            onOk: () => { setUnsaved(false); routerNavigate(to, options) },
        })
    }, [routerNavigate, modal, t])
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
    // Accounts open their drawer through the Overview's ?account= link, and a plugin's settings are on its module's page.
    const commands = useMemo<CommandItem[]>(() => {
        const serverLabel = new Map(servers.data?.map(s => [s.id, s.label]))
        const configurable = catalog.data?.filter(entry => entry.options.length > 0 && moduleOfPlugin(entry.key)) ?? []
        return (accounts.data ?? []).flatMap(account => [
            {
                id: `account:${account.id}`, group: "accounts" as const, label: account.name, hint: serverLabel.get(account.serverId), icon: <UserOutlined />,
                keywords: [t("palette.accountKeyword")], run: () => navigate(`/?account=${account.id}`),
            },
            ...configurable.map(entry => {
                const label = tb(entry.key, { defaultValue: entry.key })
                return {
                    id: `plugin:${account.id}:${entry.key}`, group: "plugins" as const, label, hint: account.name, icon: <SettingOutlined />,
                    keywords: [entry.key, t("palette.pluginKeyword")], run: () => navigate(`/m/${moduleOfPlugin(entry.key)!.id}?account=${account.id}`),
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
        routerNavigate("/login", { replace: true })
    }
    const nav = useMemo(() => buildNav({ client: t, common: tc }, planVisible, new Set(catalog.data?.map(e => e.key))), [t, tc, planVisible, catalog.data])
    // Signed out, the page itself sends the player to sign in, so no sidebar shows meanwhile.
    if (!me.data) return <Outlet />
    return (
        <CampaignLayout
            product="GGE Command"
            nav={nav}
            activeKey={activeKey}
            onNavigate={key => navigate(pathOf(key))}
            title={title}
            banners={<AlertBanners />}
            username={me.data?.username ?? ""}
            onLogout={signOut}
            onLanguageChange={saveLocale}
            commands={commands}
            accountMenu={[{ key: "settings", icon: <SettingOutlined />, label: tc("nav.settings"), onClick: () => navigate(pathOf("settings")) },
                ...accountMenu,
                { key: "credits", icon: <InfoCircleOutlined />, label: t("credits.link"), onClick: () => navigate("/credits") }]}
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
            <SetChrome.Provider value={setChrome}><Outlet /></SetChrome.Provider>
        </CampaignLayout>
    )
}
