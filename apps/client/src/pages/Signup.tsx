import { MailOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { PasswordFields } from "../components/PasswordFields.tsx"
import { TURNSTILE_SITE_KEY, Turnstile } from "../components/Turnstile.tsx"

export function Signup() {
    const navigate = useNavigate()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
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
        <AuthShell title={t("signup.title")} subtitle={t("signup.subtitle")} wide
            footer={<span style={{ color: "#BFAE8A" }}><Trans t={t} i18nKey="signup.enlisted" components={{ login: <Link to="/login" /> }} /></span>}>
            {signup.error && <Alert type="error" showIcon title={messageOf(signup.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form form={form} layout="vertical" requiredMark={false}
                onFinish={({ username, email, password, turnstileToken }) => signup.mutate({ username, email, password, turnstileToken })} disabled={signup.isPending}>
                <Form.Item label={tc("field.username")} name="username" extra={t("signup.usernameHint")}
                    rules={[{ required: true, message: t("signup.usernameRequired") }, { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: t("signup.usernamePattern") }]}>
                    <Input prefix={<UserOutlined />} autoComplete="username" size="large" autoFocus />
                </Form.Item>
                <Form.Item label={tc("field.email")} name="email" extra={t("signup.emailHint")}
                    rules={[{ required: true, type: "email", message: tc("validation.email") }]}>
                    <Input prefix={<MailOutlined />} type="email" autoComplete="email" size="large" />
                </Form.Item>
                <PasswordFields size="large" />
                {TURNSTILE_SITE_KEY && (
                    <Form.Item name="turnstileToken" rules={[{ required: true, message: t("signup.captchaRequired") }]}>
                        <Turnstile key={captchaRound} />
                    </Form.Item>
                )}
                <Button type="primary" htmlType="submit" block size="large" loading={signup.isPending} className="gge-press">{t("signup.submit")}</Button>
            </Form>
        </AuthShell>
    )
}
