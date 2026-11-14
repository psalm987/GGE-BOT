import { LockOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { useLocation, useNavigate } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { CLIENT_URL } from "../config.ts"

export function Login() {
    const navigate = useNavigate()
    const from = (useLocation().state as { from?: string } | null)?.from ?? "/"
    const login = useMutation(orpc.auth.login.mutationOptions({
        onSuccess: user => {
            queryClient.setQueryData(orpc.auth.me.queryKey(), user)
            navigate(from, { replace: true })
        },
    }))
    return (
        <AuthShell title="Admin sign in" subtitle="Administrators only.">
            {login.error && <Alert type="error" showIcon title={messageOf(login.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form layout="vertical" requiredMark={false} onFinish={values => login.mutate(values)} disabled={login.isPending}>
                <Form.Item label="Username or email" name="login" rules={[{ required: true, message: "Enter your username or email" }]}>
                    <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
                </Form.Item>
                <Form.Item label="Password" name="password" rules={[{ required: true, message: "Enter your password" }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
                </Form.Item>
                <div style={{ marginBottom: 16, textAlign: "end" }}><a href={`${CLIENT_URL}/forgot-password`}>Forgot password?</a></div>
                <Button type="primary" htmlType="submit" block size="large" loading={login.isPending} className="gge-press">Sign in</Button>
            </Form>
        </AuthShell>
    )
}
