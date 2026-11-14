import { LockOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, App, Button, Form, Input } from "antd"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"
import { AppLayout } from "../components/AppLayout.tsx"

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
                    <Form.Item label="New password" name="next" extra="At least 10 characters"
                        rules={[{ required: true, message: "Choose a new password" }, { min: 10, message: "At least 10 characters" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item label="Confirm new password" name="confirm" dependencies={["next"]}
                        rules={[{ required: true, message: "Type the password again" }, ({ getFieldValue }) => ({
                            validator: (_, value) => !value || value === getFieldValue("next") ? Promise.resolve() : Promise.reject(new Error("The passwords don't match")),
                        })]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={change.isPending} className="gge-press">Change password</Button>
                </Form>
            </ParchmentCard>
        </AppLayout>
    )
}
