import { DeleteOutlined, DownloadOutlined, LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input, Modal, Typography } from "antd"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import type { DataExport, PublicUser } from "@gge/contracts"
import { messageOf, ParchmentCard } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"

const card = { maxWidth: 480, marginBottom: 16 }

/** For a player whose email is confirmed. One without a confirmed email is asked for it by the email gate instead. */
export function ChangeEmailCard({ me }: { me: PublicUser }) {
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const [form] = Form.useForm()
    const [sentTo, setSentTo] = useState<string>()
    const change = useMutation(orpc.account.changeEmail.mutationOptions({
        onSuccess: (_, { email }) => {
            form.resetFields()
            setSentTo(email)
        },
    }))
    return (
        <ParchmentCard title={t("changeEmail.title")} style={card}>
            <Typography.Paragraph><Trans t={t} i18nKey="changeEmail.current" values={{ email: me.email }} components={{ strong: <Typography.Text strong /> }} /></Typography.Paragraph>
            {sentTo && <Alert type="success" showIcon role="status" style={{ marginBottom: 16 }} title={t("changeEmail.sentTitle")}
                description={t("changeEmail.sentBody", { sentTo, current: me.email })} />}
            {change.error && <Alert type="error" showIcon title={messageOf(change.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form form={form} name="change-email" layout="vertical" requiredMark={false} disabled={change.isPending}
                onFinish={({ email, password }) => { setSentTo(undefined); change.mutate({ email, password }) }}>
                <Form.Item label={t("changeEmail.newLabel")} name="email" rules={[{ required: true, type: "email", message: tc("validation.email") }]}>
                    <Input prefix={<MailOutlined />} type="email" autoComplete="email" placeholder="you@example.com" />
                </Form.Item>
                <Form.Item label={t("changeEmail.passwordLabel")} name="password" rules={[{ required: true, message: t("validation.enterPassword") }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={change.isPending} className="gge-press">{t("changeEmail.submit")}</Button>
            </Form>
        </ParchmentCard>
    )
}

function saveAsFile(data: DataExport) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `gge-bot-export-${data.profile.username}-${data.exportedAt.toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
}

export function ExportDataCard() {
    const { t } = useTranslation("client")
    const download = useMutation(orpc.account.exportData.mutationOptions({ onSuccess: saveAsFile }))
    return (
        <ParchmentCard title={t("export.title")} style={card}>
            <Typography.Paragraph>{t("export.body")}</Typography.Paragraph>
            {download.error && <Alert type="error" showIcon title={messageOf(download.error)} style={{ marginBottom: 16 }} role="alert" />}
            {download.isSuccess && <Alert type="success" showIcon title={t("export.started")} style={{ marginBottom: 16 }} role="status" />}
            <Button icon={<DownloadOutlined />} loading={download.isPending} onClick={() => download.mutate({})}>{t("export.button")}</Button>
        </ParchmentCard>
    )
}

export function DeleteAccountCard({ me }: { me: PublicUser }) {
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [form] = Form.useForm()
    const remove = useMutation(orpc.account.deleteMe.mutationOptions({
        onSuccess: () => {
            void navigate("/login", { replace: true, state: { notice: t("delete.notice") } })
            queryClient.clear()
        },
    }))
    const close = () => {
        setOpen(false)
        remove.reset()
    }
    return (
        <ParchmentCard title={t("delete.title")} style={card}>
            <Typography.Paragraph>{t("delete.body")}</Typography.Paragraph>
            <Button danger icon={<DeleteOutlined />} onClick={() => setOpen(true)}>{t("delete.button")}</Button>
            <Modal open={open} title={t("delete.modalTitle")} onCancel={close} destroyOnHidden okText={t("delete.modalOk")}
                okButtonProps={{ danger: true, loading: remove.isPending }} cancelButtonProps={{ disabled: remove.isPending }} onOk={() => form.submit()}>
                <Typography.Paragraph><Trans t={t} i18nKey="delete.modalBody" values={{ username: me.username }} components={{ strong: <Typography.Text strong /> }} /></Typography.Paragraph>
                {remove.error && <Alert type="error" showIcon title={messageOf(remove.error)} style={{ marginBottom: 16 }} role="alert" />}
                <Form form={form} name="delete-account" layout="vertical" requiredMark={false} disabled={remove.isPending}
                    onFinish={({ password, confirmUsername }) => remove.mutate({ password, confirmUsername })}>
                    <Form.Item label={tc("field.password")} name="password" rules={[{ required: true, message: t("validation.enterPassword") }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item label={t("delete.usernameLabel")} name="confirmUsername" validateTrigger="onSubmit"
                        rules={[{ validator: (_, value?: string) => value?.trim().toLowerCase() === me.username.toLowerCase() ? Promise.resolve() : Promise.reject(new Error(t("delete.usernameMismatch", { username: me.username }))) }]}>
                        <Input prefix={<UserOutlined />} autoComplete="off" />
                    </Form.Item>
                </Form>
            </Modal>
        </ParchmentCard>
    )
}
