import { MailOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { App, Button, Form, Input, Typography } from "antd"
import type { ReactNode } from "react"
import type { PublicUser } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { AppLayout } from "./AppLayout.tsx"

/** Renders children once the player's email is confirmed; until then, the page asks them to confirm it. */
export function RequireVerified({ children }: { children: ReactNode }) {
    const me = useMe()
    if (!me.data || me.data.emailVerified)
        return children
    return (
        <AppLayout activeKey="accounts" title="Accounts">
            <EmailGate user={me.data} />
        </AppLayout>
    )
}

function EmailGate({ user }: { user: PublicUser }) {
    const { message } = App.useApp()
    const resend = useMutation(orpc.account.resendVerification.mutationOptions({
        onSuccess: () => message.success("Verification email sent"),
        onError: error => message.error(messageOf(error)),
    }))
    const add = useMutation(orpc.account.addEmail.mutationOptions({
        onSuccess: () => {
            message.success("Check your inbox to verify it")
            void queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() })
        },
        onError: error => message.error(messageOf(error)),
    }))
    const card = { maxWidth: 520 }
    if (!user.email)
        return (
            <ParchmentCard title="Add your email" style={card}>
                <Typography.Paragraph>Confirm an email address to start running bots. It's also how you reset a forgotten password.</Typography.Paragraph>
                <Form layout="vertical" requiredMark={false} onFinish={({ email }) => add.mutate({ email })} disabled={add.isPending}>
                    <Form.Item label="Email" name="email" rules={[{ required: true, type: "email", message: "Enter a valid email" }]}>
                        <Input prefix={<MailOutlined />} type="email" autoComplete="email" placeholder="you@example.com" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={add.isPending} className="gge-press">Send verification link</Button>
                </Form>
            </ParchmentCard>
        )
    return (
        <ParchmentCard title="Confirm your email" style={card}>
            <Typography.Paragraph>
                We sent a link to <Typography.Text strong>{user.email}</Typography.Text>. Open it to start running bots.
            </Typography.Paragraph>
            <Button loading={resend.isPending} onClick={() => resend.mutate({})}>Resend the link</Button>
        </ParchmentCard>
    )
}
