import { LockOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { Link, useLocation, useNavigate } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

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
        <AuthShell title="Sign in" subtitle="Command your game accounts from one war table."
            footer={<span style={{ color: "#BFAE8A" }}>Have an invite? <Link to="/signup">Create your account</Link></span>}>
            {login.error && <Alert type="error" showIcon title={messageOf(login.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form layout="vertical" requiredMark={false} onFinish={values => login.mutate(values)} disabled={login.isPending}>
                <Form.Item label="Username" name="username" rules={[{ required: true, message: "Enter your username" }]}>
                    <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
                </Form.Item>
                <Form.Item label="Password" name="password" rules={[{ required: true, message: "Enter your password" }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block size="large" loading={login.isPending} className="gge-press">Sign in</Button>
            </Form>
        </AuthShell>
    )
}
