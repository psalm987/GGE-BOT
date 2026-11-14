import { SettingOutlined, TeamOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input, type MenuProps } from "antd"
import type { ReactNode } from "react"
import { useNavigate } from "react-router"
import type { PublicUser } from "@gge/contracts"
import { CampaignLayout } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { useLogout, useMe } from "../auth.tsx"

const ROUTES = { accounts: "/", settings: "/settings" } as const

/** Soft gate: unverified players keep full access, but are nudged to add or confirm an email. */
function EmailBanner({ user }: { user: PublicUser }) {
    const { message } = App.useApp()
    const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() })
    const resend = useMutation(orpc.account.resendVerification.mutationOptions({
        onSuccess: () => message.success("Verification email sent"),
        onError: error => message.error(messageOf(error)),
    }))
    const add = useMutation(orpc.account.addEmail.mutationOptions({
        onSuccess: () => { message.success("Check your inbox to verify it"); void refresh() },
        onError: error => message.error(messageOf(error)),
    }))
    if (user.emailVerified)
        return null
    const style = { marginBottom: 16 }
    if (!user.email)
        return (
            <Alert type="warning" showIcon style={style} title="Add your email"
                description={
                    <>
                        <div style={{ marginBottom: 8 }}>Without one you can't reset a forgotten password.</div>
                        <Form layout="inline" onFinish={({ email }) => add.mutate({ email })} disabled={add.isPending}>
                            <Form.Item name="email" rules={[{ required: true, type: "email", message: "Enter a valid email" }]} style={{ flex: "1 1 220px" }}>
                                <Input type="email" autoComplete="email" placeholder="you@example.com" aria-label="Email address" />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" loading={add.isPending}>Add email</Button>
                        </Form>
                    </>
                } />
        )
    return (
        <Alert type="info" showIcon style={style} title="Check your inbox"
            description={`We sent a verification link to ${user.email}.`}
            action={<Button loading={resend.isPending} onClick={() => resend.mutate({})}>Resend</Button>} />
    )
}

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
            {me.data && <EmailBanner user={me.data} />}
            {children}
        </CampaignLayout>
    )
}
