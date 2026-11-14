import { KeyOutlined, LockOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { Link, useNavigate, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

export function Signup() {
    const navigate = useNavigate()
    const [params] = useSearchParams()
    const signup = useMutation(orpc.auth.signup.mutationOptions({
        onSuccess: user => {
            queryClient.setQueryData(orpc.auth.me.queryKey(), user)
            navigate("/", { replace: true })
        },
    }))
    return (
        <AuthShell title="Join the campaign" subtitle="Accounts are by invitation. Paste the code you were given."
            footer={<span style={{ color: "#BFAE8A" }}>Already enlisted? <Link to="/login">Sign in</Link></span>}>
            {signup.error && <Alert type="error" showIcon title={messageOf(signup.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form layout="vertical" requiredMark={false} initialValues={{ inviteCode: params.get("invite") ?? "" }}
                onFinish={({ inviteCode, username, password }) => signup.mutate({ inviteCode, username, password })} disabled={signup.isPending}>
                <Form.Item label="Invite code" name="inviteCode" rules={[{ required: true, message: "Paste your invite code" }]}>
                    <Input prefix={<KeyOutlined />} autoComplete="off" size="large" />
                </Form.Item>
                <Form.Item label="Username" name="username" extra="3–32 characters: letters, digits, _ . -"
                    rules={[{ required: true, message: "Choose a username" }, { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: "3–32 letters, digits, _ . or -" }]}>
                    <Input prefix={<UserOutlined />} autoComplete="username" size="large" />
                </Form.Item>
                <Form.Item label="Password" name="password" extra="At least 10 characters"
                    rules={[{ required: true, message: "Choose a password" }, { min: 10, message: "At least 10 characters" }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size="large" />
                </Form.Item>
                <Form.Item label="Confirm password" name="confirm" dependencies={["password"]}
                    rules={[{ required: true, message: "Type the password again" }, ({ getFieldValue }) => ({
                        validator: (_, value) => !value || value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("The passwords don't match")),
                    })]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="new-password" size="large" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block size="large" loading={signup.isPending} className="gge-press">Create account</Button>
            </Form>
        </AuthShell>
    )
}
