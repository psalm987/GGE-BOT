import { DeleteOutlined, DownloadOutlined, LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input, Modal, Typography } from "antd"
import { useState } from "react"
import { useNavigate } from "react-router"
import type { DataExport, PublicUser } from "@gge/contracts"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

const card = { maxWidth: 480, marginBottom: 16 }

/** For a player whose email is confirmed. One without a confirmed email is asked for it by the email gate instead. */
export function ChangeEmailCard({ me }: { me: PublicUser }) {
    const [form] = Form.useForm()
    const [sentTo, setSentTo] = useState<string>()
    const change = useMutation(orpc.account.changeEmail.mutationOptions({
        onSuccess: (_, { email }) => {
            form.resetFields()
            setSentTo(email)
        },
    }))
    return (
        <ParchmentCard title="Change email" style={card}>
            <Typography.Paragraph>Your email is <Typography.Text strong>{me.email}</Typography.Text>. You sign in with it and get your account emails there.</Typography.Paragraph>
            {sentTo && <Alert type="success" showIcon role="status" style={{ marginBottom: 16 }} title="Check your new inbox"
                description={`We sent a link to ${sentTo}. It works for 1 hour. Your email stays ${me.email} until you open it. Opening it signs you out on every device, and you sign in again with the new address.`} />}
            {change.error && <Alert type="error" showIcon title={messageOf(change.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form form={form} name="change-email" layout="vertical" requiredMark={false} disabled={change.isPending}
                onFinish={({ email, password }) => { setSentTo(undefined); change.mutate({ email, password }) }}>
                <Form.Item label="New email" name="email" rules={[{ required: true, type: "email", message: "Enter a valid email" }]}>
                    <Input prefix={<MailOutlined />} type="email" autoComplete="email" placeholder="you@example.com" />
                </Form.Item>
                <Form.Item label="Confirm with your password" name="password" rules={[{ required: true, message: "Enter your password" }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={change.isPending} className="gge-press">Send confirmation link</Button>
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
    const download = useMutation(orpc.account.exportData.mutationOptions({ onSuccess: saveAsFile }))
    return (
        <ParchmentCard title="Your data" style={card}>
            <Typography.Paragraph>
                Download a JSON file of everything stored about you: your profile, game accounts and their settings, run history, logs, notifications and your own actions. Game passwords are never included.
            </Typography.Paragraph>
            {download.error && <Alert type="error" showIcon title={messageOf(download.error)} style={{ marginBottom: 16 }} role="alert" />}
            {download.isSuccess && <Alert type="success" showIcon title="Your download has started" style={{ marginBottom: 16 }} role="status" />}
            <Button icon={<DownloadOutlined />} loading={download.isPending} onClick={() => download.mutate({})}>Download my data</Button>
        </ParchmentCard>
    )
}

export function DeleteAccountCard({ me }: { me: PublicUser }) {
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [form] = Form.useForm()
    const remove = useMutation(orpc.account.deleteMe.mutationOptions({
        onSuccess: () => {
            void navigate("/login", { replace: true, state: { notice: "Your account was deleted" } })
            queryClient.clear()
        },
    }))
    const close = () => {
        setOpen(false)
        remove.reset()
    }
    return (
        <ParchmentCard title="Delete account" style={card}>
            <Typography.Paragraph>
                This stops your bots and permanently deletes your account, game accounts, settings, logs and notifications. It can't be undone.
            </Typography.Paragraph>
            <Button danger icon={<DeleteOutlined />} onClick={() => setOpen(true)}>Delete account</Button>
            <Modal open={open} title="Delete your account?" onCancel={close} destroyOnHidden okText="Delete account"
                okButtonProps={{ danger: true, loading: remove.isPending }} cancelButtonProps={{ disabled: remove.isPending }} onOk={() => form.submit()}>
                <Typography.Paragraph>Your bots stop and everything is deleted for good. Enter your password and type your username, <Typography.Text strong>{me.username}</Typography.Text>, to confirm.</Typography.Paragraph>
                {remove.error && <Alert type="error" showIcon title={messageOf(remove.error)} style={{ marginBottom: 16 }} role="alert" />}
                <Form form={form} name="delete-account" layout="vertical" requiredMark={false} disabled={remove.isPending}
                    onFinish={({ password, confirmUsername }) => remove.mutate({ password, confirmUsername })}>
                    <Form.Item label="Password" name="password" rules={[{ required: true, message: "Enter your password" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item label="Your username" name="confirmUsername" validateTrigger="onSubmit"
                        rules={[{ validator: (_, value?: string) => value?.trim().toLowerCase() === me.username.toLowerCase() ? Promise.resolve() : Promise.reject(new Error(`Type ${me.username} to confirm`)) }]}>
                        <Input prefix={<UserOutlined />} autoComplete="off" />
                    </Form.Item>
                </Form>
            </Modal>
        </ParchmentCard>
    )
}
