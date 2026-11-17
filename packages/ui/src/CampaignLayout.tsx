import { LogoutOutlined, UserOutlined } from "@ant-design/icons"
import { Avatar, Button, Dropdown, Grid, Layout, Menu, Typography, type MenuProps } from "antd"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Crest } from "./Crest.tsx"
import { LanguagePicker } from "./LanguagePicker.tsx"
import type { Preference } from "./i18n/store.ts"

export type NavItem = { key: string; label: string; icon: ReactNode }

/**
 * The war-table shell: a sider with the crest and labelled navigation, a top
 * bar with the page title and the user's banner. The sider collapses to icons
 * below 992px.
 */
export function CampaignLayout({ product, nav, activeKey, onNavigate, title, extra, banners, username, onLogout, accountMenu = [], onLanguageChange, children }: {
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
    children: ReactNode
}) {
    const { t } = useTranslation("ui")
    const [collapsed, setCollapsed] = useState(false)
    const screens = Grid.useBreakpoint()
    const phone = !screens.md
    const userMenu: MenuProps["items"] = [
        ...accountMenu,
        ...(accountMenu.length ? [{ type: "divider" as const }] : []),
        { key: "logout", icon: <LogoutOutlined />, label: t("nav.signOut"), danger: true, onClick: onLogout },
    ]
    return (
        <Layout style={{ minHeight: "100dvh" }}>
            <Layout.Sider breakpoint="lg" collapsedWidth={phone ? 0 : 64} collapsed={collapsed} onCollapse={setCollapsed} width={232}
                zeroWidthTriggerStyle={{ top: 12, insetInlineEnd: -48, borderRadius: 6 }}
                style={{ borderRight: "1px solid #3A2E1F", ...(phone && { position: "fixed", insetBlock: 0, zIndex: 20 }) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: collapsed ? "16px 12px" : "16px 20px", height: 64 }}>
                    <Crest size={28} title={product} />
                    {!collapsed && <span className="gge-display" style={{ color: "#E0A526", fontWeight: 700, fontSize: 17 }}>{product}</span>}
                </div>
                <hr className="gge-rule" />
                <Menu theme="dark" mode="inline" selectedKeys={[activeKey]} onClick={e => { onNavigate(e.key); if (phone) setCollapsed(true) }}
                    items={nav.map(n => ({ key: n.key, icon: n.icon, label: n.label }))} style={{ borderInlineEnd: 0, marginTop: 8 }} />
            </Layout.Sider>
            <Layout>
                <Layout.Header style={{ display: "flex", alignItems: "center", gap: phone ? 8 : 16, borderBottom: "1px solid #3A2E1F", ...(phone && { padding: "0 12px 0 56px" }) }}>
                    <Typography.Title level={3} className="gge-display" ellipsis style={{ margin: 0, flex: 1, minWidth: 0, fontSize: phone ? 17 : 20 }}>{title}</Typography.Title>
                    {extra}
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
        </Layout>
    )
}
