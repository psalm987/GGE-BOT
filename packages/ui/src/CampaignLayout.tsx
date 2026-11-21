import { GlobalOutlined, LogoutOutlined, MenuOutlined, SearchOutlined, UserOutlined } from "@ant-design/icons"
import { Avatar, Button, ConfigProvider, Drawer, Dropdown, Grid, Layout, Menu, Typography, type MenuProps } from "antd"
import { useContext, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { LOCALES, LOCALE_CODES } from "@gge/i18n"
import { CommandPalette, paletteShortcut, usePaletteShortcut, type CommandItem } from "./CommandPalette.tsx"
import { Crest } from "./Crest.tsx"
import { GroupedNav } from "./GroupedNav.tsx"
import { LanguagePicker } from "./LanguagePicker.tsx"
import { setPreference, useLocale, type Preference } from "./i18n/store.ts"
import { palette } from "./palette.ts"

/**
 * A page link. With `children` it is a collapsible group instead, and the sidebar shows real links with a filter box;
 * without any group the sidebar is the plain menu. `tag` is a small word after the label, such as "Soon".
 */
export type NavItem = { key: string; label: string; icon?: ReactNode; href?: string; tag?: string; children?: NavItem[] }

const leaves = (nav: NavItem[]): NavItem[] => nav.flatMap(item => item.children ?? [item])

/**
 * The war-table shell: a sider with the crest and labelled navigation, a top
 * bar with the page title and the user's banner. The sider collapses to icons
 * below 992px and becomes a drawer on a phone.
 */
export function CampaignLayout({ product, nav, activeKey, onNavigate, title, extra, banners, username, onLogout, accountMenu = [], onLanguageChange, commands = [], children }: {
    product: string
    nav: NavItem[]
    activeKey: string
    onNavigate: (key: string) => void
    title: ReactNode
    extra?: ReactNode
    /** Notices for the whole app, between the header and the page, such as an AlertStack. */
    banners?: ReactNode
    username: string
    onLogout: () => void
    /** Extra entries above "Sign out" in the account menu. */
    accountMenu?: NonNullable<MenuProps["items"]>
    /** Fires after the user picks a language in the header, for apps that also save it to the account. */
    onLanguageChange?: (preference: Preference) => void
    /** What the command palette can do besides the pages, languages and signing out, such as opening an account. */
    commands?: CommandItem[]
    children: ReactNode
}) {
    const { t } = useTranslation("ui")
    const [collapsed, setCollapsed] = useState(false)
    const screens = Grid.useBreakpoint()
    const phone = !screens.md
    const [drawerOpen, setDrawerOpen] = useState(false)
    const { direction } = useContext(ConfigProvider.ConfigContext)
    const grouped = nav.some(item => item.children)
    const { t: tc } = useTranslation()
    const { detected } = useLocale()
    const [paletteOpen, setPaletteOpen] = useState(false)
    usePaletteShortcut(() => setPaletteOpen(open => !open))
    const shortcut = paletteShortcut()
    const paletteItems = useMemo<CommandItem[]>(() => {
        const language = (value: Preference, name: string, hint?: string): CommandItem => ({
            id: `language:${value}`, group: "language", label: t("palette.language", { name }), hint, icon: <GlobalOutlined />,
            keywords: [tc("language.label")],
            run: () => void setPreference(value).then(() => onLanguageChange?.(value)),
        })
        return [
            ...leaves(nav).map(n => ({ id: `page:${n.key}`, group: "pages" as const, label: n.label, icon: n.icon ?? <GlobalOutlined />, run: () => onNavigate(n.key) })),
            ...commands,
            language("auto", tc("language.automatic"), detected ? LOCALES[detected].nativeName : undefined),
            ...LOCALE_CODES.map(code => language(code, LOCALES[code].nativeName, LOCALES[code].englishName)),
            { id: "session:signOut", group: "session" as const, label: t("nav.signOut"), icon: <LogoutOutlined />, run: onLogout },
        ]
    }, [nav, commands, detected, t, tc, onNavigate, onLogout, onLanguageChange])
    const userMenu: MenuProps["items"] = [
        ...(phone ? [{ key: "palette", icon: <SearchOutlined />, label: t("palette.open"), onClick: () => setPaletteOpen(true) }] : []),
        ...accountMenu,
        ...(phone || accountMenu.length ? [{ type: "divider" as const }] : []),
        { key: "logout", icon: <LogoutOutlined />, label: t("nav.signOut"), danger: true, onClick: onLogout },
    ]
    const menu = (compact: boolean, close?: () => void) => grouped
        ? <GroupedNav nav={nav} activeKey={activeKey} compact={compact} onNavigate={key => { onNavigate(key); close?.() }} />
        : <Menu theme="dark" mode="inline" selectedKeys={[activeKey]} onClick={e => { onNavigate(e.key); close?.() }}
            items={nav.map(n => ({ key: n.key, icon: n.icon, label: n.label }))} style={{ borderInlineEnd: 0, marginTop: 8 }} />
    return (
        <Layout style={{ minHeight: "100dvh" }}>
{!phone && (
                <Layout.Sider breakpoint="lg" collapsedWidth={64} collapsed={collapsed} onCollapse={setCollapsed} width={232}
                    className={grouped ? "gge-sider-grouped" : undefined} style={{ borderRight: "1px solid #3A2E1F" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: collapsed && !phone ? "16px 12px" : "16px 20px", height: 64, flex: "none" }}>
                        <Crest size={28} title={product} />
                        {(!collapsed || phone) && <span className="gge-display" style={{ color: "#E0A526", fontWeight: 700, fontSize: 17 }}>{product}</span>}
                    </div>
                    <hr className="gge-rule" />
                    {menu(collapsed)}
                </Layout.Sider>
            )}
            {phone && (
                <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} placement={direction === "rtl" ? "right" : "left"} size={288}
                    title={<span style={{ display: "flex", alignItems: "center", gap: 10 }}><Crest size={24} /><span className="gge-display" style={{ color: palette.navText }}>{product}</span></span>}
                    styles={{ body: { padding: 0, display: "flex", flexDirection: "column", background: palette.nav }, header: { background: palette.nav } }}
                    rootClassName="gge-nav-drawer">
                    {menu(false, () => setDrawerOpen(false))}
                </Drawer>
            )}
            <Layout>
                <Layout.Header style={{ display: "flex", alignItems: "center", gap: phone ? 8 : 16, borderBottom: "1px solid #3A2E1F", ...(phone && { padding: "0 12px" }) }}>
                    {phone && <Button type="text" icon={<MenuOutlined />} aria-label={t("nav.openMenu")} aria-haspopup="dialog" onClick={() => setDrawerOpen(true)} style={{ height: 44, minWidth: 44 }} />}
                    <Typography.Title level={3} className="gge-display" ellipsis style={{ margin: 0, flex: 1, minWidth: 0, fontSize: phone ? 17 : 20 }}>{title}</Typography.Title>
                    {extra}
                    {/* On a phone the header has no room for another button, so the account menu opens it. */}
                    {!phone && (
                        <Button type="text" onClick={() => setPaletteOpen(true)} aria-haspopup="dialog" aria-keyshortcuts={shortcut.aria}
                            aria-label={t("palette.open")} icon={<SearchOutlined />} style={{ height: 44, minWidth: 44 }}>
                            <span>{t("palette.trigger")}</span> <kbd className="gge-kbd" aria-hidden>{t(shortcut.apple ? "palette.keyApple" : "palette.keyOther")}</kbd>
                        </Button>
                    )}
                    <LanguagePicker onChange={onLanguageChange} />
                    <Dropdown menu={{ items: userMenu }} trigger={["click"]}>
                        <Button type="text" aria-label={t("nav.accountMenuFor", { username })} style={{ height: 44 }}>
                            <Avatar size="small" icon={<UserOutlined />} style={{ background: "#D7263D" }} />
                            {!phone && <span style={{ marginInlineStart: 8 }}>{username}</span>}
                        </Button>
                    </Dropdown>
                </Layout.Header>
                {banners}
                <Layout.Content className="gge-content" style={{ padding: phone ? 12 : 24, maxWidth: 1400, width: "100%", margin: "0 auto" }}>{children}</Layout.Content>
            </Layout>
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
        </Layout>
    )
}
