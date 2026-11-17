import { MailOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { App, Button, Form, Input, Space, Typography } from "antd"
import { useState, type ReactNode } from "react"
import { Trans, useTranslation } from "react-i18next"
import type { PublicUser } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { useMe } from "../auth.tsx"
import { AppLayout } from "./AppLayout.tsx"

/** Renders children once the player's email is confirmed; until then, the page asks them to confirm it. */
export function RequireVerified({ children }: { children: ReactNode }) {
    const me = useMe()
    const { t } = useTranslation("common")
    if (!me.data || me.data.emailVerified)
        return children
    return (
        <AppLayout activeKey="accounts" title={t("nav.accounts")}>
            <EmailGate user={me.data} />
        </AppLayout>
    )
}

function EmailGate({ user }: { user: PublicUser }) {
    const { message } = App.useApp()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const resend = useMutation(orpc.account.resendVerification.mutationOptions({
        onSuccess: () => message.success(t("emailGate.resent")),
        onError: error => message.error(messageOf(error)),
    }))
    const add = useMutation(orpc.account.addEmail.mutationOptions({
        onSuccess: () => {
            message.success(t("emailGate.added"))
            void queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() })
        },
        onError: error => message.error(messageOf(error)),
    }))
    const [fixing, setFixing] = useState(false)
    const card = { maxWidth: 520 }
    const emailForm = (label: string) => (
        <Form layout="vertical" requiredMark={false} onFinish={({ email }) => add.mutate({ email }, { onSuccess: () => setFixing(false) })} disabled={add.isPending}>
            <Form.Item label={label} name="email" rules={[{ required: true, type: "email", message: tc("validation.email") }]}>
                <Input prefix={<MailOutlined />} type="email" autoComplete="email" placeholder="you@example.com" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={add.isPending} className="gge-press">{t("emailGate.send")}</Button>
        </Form>
    )
    if (!user.email)
        return (
            <ParchmentCard title={t("emailGate.addTitle")} style={card}>
                <Typography.Paragraph>{t("emailGate.addBody")}</Typography.Paragraph>
                {emailForm(tc("field.email"))}
            </ParchmentCard>
        )
    return (
        <ParchmentCard title={t("emailGate.confirmTitle")} style={card}>
            <Typography.Paragraph>
                <Trans t={t} i18nKey="emailGate.sentTo" values={{ email: user.email }} components={{ strong: <Typography.Text strong /> }} />
            </Typography.Paragraph>
            {fixing
                ? emailForm(t("emailGate.correctLabel"))
                : <Space wrap>
                    <Button loading={resend.isPending} onClick={() => resend.mutate({})}>{t("emailGate.resend")}</Button>
                    <Button type="link" onClick={() => setFixing(true)}>{t("emailGate.wrongAddress")}</Button>
                </Space>}
        </ParchmentCard>
    )
}
