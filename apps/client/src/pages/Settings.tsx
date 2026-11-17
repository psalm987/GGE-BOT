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
import { useBillingConfig } from "../use-billing.ts"

/** About the player's plan, so only worth a switch once plans restrict anyone. */
const PLAN_KINDS = new Set<NotificationKind>(["trial_started", "plan_expiring", "plan_expired", "purchase_completed"])

function EmailPrefs() {
    const { message } = App.useApp()
    const { t } = useTranslation("client")
    const me = useMe().data
    const key = orpc.account.notificationPrefs.queryKey()
    const prefs = useQuery(orpc.account.notificationPrefs.queryOptions())
    const billingLive = !!useBillingConfig().data?.billingLive
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
        <ParchmentCard title={t("emailWhen.title")} style={{ maxWidth: 480, marginBottom: 16 }}>
            {NOTIFICATION_KINDS.filter(kind => billingLive || !PLAN_KINDS.has(kind)).map(kind => (
                <div key={kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 44 }}>
                    <span id={`email-when-${kind}`}>{t(`emailWhen.${kind}`)}</span>
                    <Switch aria-labelledby={`email-when-title email-when-${kind}`} checked={prefs.data?.[kind] ?? false} disabled={!prefs.data}
                        onChange={checked => prefs.data && save.mutate({ ...prefs.data, [kind]: checked })} />
                </div>
            ))}
            <span id="email-when-title" hidden>{t("emailWhen.label")}</span>
            <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>
                {me?.email && me.emailVerified
                    ? t("emailWhen.sentTo", { email: me.email })
                    : t("emailWhen.unverified")}
            </Typography.Paragraph>
        </ParchmentCard>
    )
}

export function Settings() {
    const { message } = App.useApp()
    const { t } = useTranslation()
    const { t: tp } = useTranslation("client")
    const me = useMe().data
    const saveLocale = useSaveLocale()
    const [form] = Form.useForm()
    const change = useMutation(orpc.account.changePassword.mutationOptions({
        onSuccess: () => {
            form.resetFields()
            message.success(tp("settings.password.done"))
        },
    }))
    return (
        <AppLayout activeKey="settings" title={t("nav.settings")}>
            <ParchmentCard title={t("language.label")} style={{ maxWidth: 480, marginBottom: 16 }}>
                <LanguagePicker variant="inline" onChange={saveLocale} />
                <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>{t("language.geoipAttribution")}</Typography.Paragraph>
            </ParchmentCard>
            <EmailPrefs />
            {me?.email && me.emailVerified && <ChangeEmailCard me={me} />}
            <ParchmentCard title={tp("settings.password.title")} style={{ maxWidth: 480, marginBottom: 16 }}>
                {change.error && <Alert type="error" showIcon title={messageOf(change.error)} style={{ marginBottom: 16 }} role="alert" />}
                <Form form={form} layout="vertical" requiredMark={false} onFinish={({ current, next }) => change.mutate({ current, next })} disabled={change.isPending}>
                    <Form.Item label={tp("settings.password.current")} name="current" rules={[{ required: true, message: tp("settings.password.currentRequired") }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <PasswordFields name="next" isNew />
                    <Button type="primary" htmlType="submit" loading={change.isPending} className="gge-press">{tp("settings.password.submit")}</Button>
                </Form>
            </ParchmentCard>
            <ExportDataCard />
            {me && <DeleteAccountCard me={me} />}
        </AppLayout>
    )
}
