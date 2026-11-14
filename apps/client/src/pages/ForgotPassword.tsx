import { MailOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { Link } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"

export function ForgotPassword() {
    const request = useMutation(orpc.auth.requestPasswordReset.mutationOptions())
    return (
        <AuthShell title="Forgot your password?" subtitle="Enter the email on your account and we'll send a reset link."
            footer={<Link to="/login">Back to sign in</Link>}>
            {request.isSuccess
                ? <Alert type="success" showIcon role="status" title="Check your inbox"
                    description="If a verified account uses that address, a reset link is on its way. It works for one hour." />
                : <>
                    {request.error && <Alert type="error" showIcon title={messageOf(request.error)} style={{ marginBottom: 16 }} role="alert" />}
                    <Form layout="vertical" requiredMark={false} onFinish={({ email }) => request.mutate({ email })} disabled={request.isPending}>
                        <Form.Item label="Email" name="email" rules={[{ required: true, type: "email", message: "Enter a valid email" }]}>
                            <Input prefix={<MailOutlined />} type="email" autoComplete="email" autoFocus size="large" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block size="large" loading={request.isPending} className="gge-press">Send reset link</Button>
                    </Form>
                </>}
        </AuthShell>
    )
}
