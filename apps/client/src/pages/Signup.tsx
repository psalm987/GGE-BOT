import { MailOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { PasswordFields } from "../components/PasswordFields.tsx"
import { TURNSTILE_SITE_KEY, Turnstile } from "../components/Turnstile.tsx"

export function Signup() {
    const navigate = useNavigate()
    const [form] = Form.useForm()
    // A token works once, so every failed attempt remounts the widget for a fresh one.
    const [captchaRound, setCaptchaRound] = useState(0)
    const signup = useMutation(orpc.auth.signup.mutationOptions({
        onError: () => {
            form.setFieldValue("turnstileToken", undefined)
            setCaptchaRound(round => round + 1)
        },
        onSuccess: user => {
            queryClient.setQueryData(orpc.auth.me.queryKey(), user)
            navigate("/", { replace: true })
        },
    }))
    return (
        <AuthShell title="Join the campaign" subtitle="Create your account, then confirm your email to start your bots." wide
            footer={<span style={{ color: "#BFAE8A" }}>Already enlisted? <Link to="/login">Sign in</Link></span>}>
            {signup.error && <Alert type="error" showIcon title={messageOf(signup.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form form={form} layout="vertical" requiredMark={false}
                onFinish={({ username, email, password, turnstileToken }) => signup.mutate({ username, email, password, turnstileToken })} disabled={signup.isPending}>
                <Form.Item label="Username" name="username" extra="3–32 characters: letters, digits, _ . -"
                    rules={[{ required: true, message: "Choose a username" }, { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: "3–32 letters, digits, _ . or -" }]}>
                    <Input prefix={<UserOutlined />} autoComplete="username" size="large" autoFocus />
                </Form.Item>
                <Form.Item label="Email" name="email" extra="We'll send a link to confirm it."
                    rules={[{ required: true, type: "email", message: "Enter a valid email" }]}>
                    <Input prefix={<MailOutlined />} type="email" autoComplete="email" size="large" />
                </Form.Item>
                <PasswordFields size="large" />
                {TURNSTILE_SITE_KEY && (
                    <Form.Item name="turnstileToken" rules={[{ required: true, message: "Complete the captcha" }]}>
                        <Turnstile key={captchaRound} />
                    </Form.Item>
                )}
                <Button type="primary" htmlType="submit" block size="large" loading={signup.isPending} className="gge-press">Create account</Button>
            </Form>
        </AuthShell>
    )
}
