import { LockOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input, Switch, Typography } from "antd"
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationPrefs } from "@gge/contracts"
import { useTranslation } from "react-i18next"
import { LanguagePicker, ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { useMe, useSaveLocale } from "../auth.tsx"
import { ChangeEmailCard, DeleteAccountCard, ExportDataCard } from "../components/AccountCards.tsx"
import { AppLayout } from "../components/AppLayout.tsx"
import { PasswordFields } from "../components/PasswordFields.tsx"

/** Each completes the sentence "Email me when…". */
const EMAIL_WHEN: Record<NotificationKind, string> = {
    banned: "the game bans an account",
    auth_failed: "the game rejects an account's password",
    crash_loop: "a bot is stopped after repeated crashes",
    shutoff: "the shutoff timer stops a bot",
}

function EmailPrefs() {
    const { message } = App.useApp()
    const me = useMe().data
    const key = orpc.account.notificationPrefs.queryKey()
    const prefs = useQuery(orpc.account.notificationPrefs.queryOptions())
    const save = useMutation(orpc.account.setNotificationPrefs.mutationOptions({
        // Flip the switch at once; roll back if the server refuses.
        onMutate: async next => {
            await queryClient.cancelQueries({ queryKey: key })
            const previous = queryClient.getQueryData<NotificationPrefs>(key)
            queryClient.setQueryData<NotificationPrefs>(key, next)
            return { previous }
        },
        onError: (error, _next, context) => {
            queryClient.setQueryData(key, context?.previous)
            message.error(messageOf(error))
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    }))
    return (
        <ParchmentCard title="Email me when…" style={{ maxWidth: 480, marginBottom: 16 }}>
            {NOTIFICATION_KINDS.map(kind => (
                <div key={kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 44 }}>
                    <span id={`email-when-${kind}`}>{EMAIL_WHEN[kind]}</span>
                    <Switch aria-labelledby={`email-when-title email-when-${kind}`} checked={prefs.data?.[kind] ?? false} disabled={!prefs.data}
                        onChange={checked => prefs.data && save.mutate({ ...prefs.data, [kind]: checked })} />
                </div>
            ))}
            <span id="email-when-title" hidden>Email me when</span>
            <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>
                {me?.email && me.emailVerified
                    ? <>Emails go to {me.email}. Each of these also shows under the bell, whatever you choose here.</>
                    : "Confirm your email address to get these. Until then they only show under the bell."}
            </Typography.Paragraph>
        </ParchmentCard>
    )
}

export function Settings() {
    const { message } = App.useApp()
    const { t } = useTranslation()
    const me = useMe().data
    const saveLocale = useSaveLocale()
    const [form] = Form.useForm()
    const change = useMutation(orpc.account.changePassword.mutationOptions({
        onSuccess: () => {
            form.resetFields()
            message.success("Password changed. Your other devices were signed out.")
        },
    }))
    return (
        <AppLayout activeKey="settings" title="Settings">
            <ParchmentCard title={t("language.label")} style={{ maxWidth: 480, marginBottom: 16 }}>
                <LanguagePicker variant="inline" onChange={saveLocale} />
                <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>{t("language.geoipAttribution")}</Typography.Paragraph>
            </ParchmentCard>
            <EmailPrefs />
            {me?.email && me.emailVerified && <ChangeEmailCard me={me} />}
            <ParchmentCard title="Change password" style={{ maxWidth: 480, marginBottom: 16 }}>
                {change.error && <Alert type="error" showIcon title={messageOf(change.error)} style={{ marginBottom: 16 }} role="alert" />}
                <Form form={form} layout="vertical" requiredMark={false} onFinish={({ current, next }) => change.mutate({ current, next })} disabled={change.isPending}>
                    <Form.Item label="Current password" name="current" rules={[{ required: true, message: "Enter your current password" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <PasswordFields name="next" label="New password" />
                    <Button type="primary" htmlType="submit" loading={change.isPending} className="gge-press">Change password</Button>
                </Form>
            </ParchmentCard>
            <ExportDataCard />
            {me && <DeleteAccountCard me={me} />}
        </AppLayout>
    )
}
