import { LockOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input } from "antd"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"
import { AppLayout } from "../components/AppLayout.tsx"
import { PasswordFields } from "../components/PasswordFields.tsx"

export function Settings() {
    const { message } = App.useApp()
    const [form] = Form.useForm()
    const change = useMutation(orpc.account.changePassword.mutationOptions({
        onSuccess: () => {
            form.resetFields()
            message.success("Password changed. Your other devices were signed out.")
        },
    }))
    return (
        <AppLayout activeKey="settings" title="Settings">
            <ParchmentCard title="Change password" style={{ maxWidth: 480 }}>
                {change.error && <Alert type="error" showIcon title={messageOf(change.error)} style={{ marginBottom: 16 }} role="alert" />}
                <Form form={form} layout="vertical" requiredMark={false} onFinish={({ current, next }) => change.mutate({ current, next })} disabled={change.isPending}>
                    <Form.Item label="Current password" name="current" rules={[{ required: true, message: "Enter your current password" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item>
                    <PasswordFields name="next" label="New password" />
                    <Button type="primary" htmlType="submit" loading={change.isPending} className="gge-press">Change password</Button>
                </Form>
            </ParchmentCard>
        </AppLayout>
    )
}
