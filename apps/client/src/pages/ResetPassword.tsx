import { LockOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"

export function ResetPassword() {
    const token = useSearchParams()[0].get("token")
    const reset = useMutation(orpc.auth.resetPassword.mutationOptions())
    const footer = <Link to="/login">Back to sign in</Link>
    if (!token)
        return (
            <AuthShell title="Reset password" footer={<Link to="/forgot-password">Request a new link</Link>}>
                <Alert type="error" showIcon role="alert" title="This link is incomplete" description="Open the link from your email again, or request a new one." />
            </AuthShell>
        )
    return (
        <AuthShell title="Choose a new password" subtitle="You'll be signed out everywhere and can sign in with the new password." footer={footer}>
            {reset.isSuccess
                ? <Alert type="success" showIcon role="status" title="Password changed" description={<Link to="/login">Sign in with your new password</Link>} />
                : <>
                    {reset.error && <Alert type="error" showIcon title={messageOf(reset.error)} style={{ marginBottom: 16 }} role="alert" />}
                    <Form layout="vertical" requiredMark={false} onFinish={({ password }) => reset.mutate({ token, password })} disabled={reset.isPending}>
                        <Form.Item label="New password" name="password" extra="At least 10 characters"
                            rules={[{ required: true, message: "Choose a password" }, { min: 10, message: "At least 10 characters" }]}>
                            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" autoFocus size="large" />
                        </Form.Item>
                        <Form.Item label="Confirm password" name="confirm" dependencies={["password"]}
                            rules={[{ required: true, message: "Type the password again" }, ({ getFieldValue }) => ({
                                validator: (_, value) => !value || value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("The passwords don't match")),
                            })]}>
                            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size="large" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block size="large" loading={reset.isPending} className="gge-press">Change password</Button>
                    </Form>
                </>}
        </AuthShell>
    )
}
