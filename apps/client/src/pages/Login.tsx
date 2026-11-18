import { LockOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { Trans, useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate } from "react-router"
import { AuthShell, messageOf } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"

export function Login() {
    const navigate = useNavigate()
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const state = useLocation().state as { from?: string; notice?: string } | null
    const from = state?.from ?? "/"
    const login = useMutation(orpc.auth.login.mutationOptions({
        onSuccess: user => {
            queryClient.setQueryData(orpc.auth.me.queryKey(), user)
            navigate(from, { replace: true })
        },
    }))
    return (
        <AuthShell title={t("login.title")} subtitle={t("login.subtitle")}
            footer={<div style={{ color: "#BFAE8A", display: "flex", flexDirection: "column", gap: 8 }}>
                <span><Trans t={t} i18nKey="login.newHere" components={{ signup: <Link to="/signup" /> }} /></span>
                <Link to="/credits">{t("credits.link")}</Link>
            </div>}>
            {state?.notice && !login.error && <Alert type="success" showIcon title={state.notice} style={{ marginBottom: 16 }} role="status" />}
            {login.error && <Alert type="error" showIcon title={messageOf(login.error)} style={{ marginBottom: 16 }} role="alert" />}
            <Form layout="vertical" requiredMark={false} onFinish={values => login.mutate(values)} disabled={login.isPending}>
                <Form.Item label={t("login.identifier")} name="login" rules={[{ required: true, message: t("login.identifierRequired") }]}>
                    <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
                </Form.Item>
                <Form.Item label={tc("field.password")} name="password" rules={[{ required: true, message: t("validation.enterPassword") }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
                </Form.Item>
                <div style={{ marginBottom: 16, textAlign: "end" }}><Link to="/forgot-password">{t("login.forgot")}</Link></div>
                <Button type="primary" htmlType="submit" block size="large" loading={login.isPending} className="gge-press">{tc("action.signIn")}</Button>
            </Form>
        </AuthShell>
    )
}
