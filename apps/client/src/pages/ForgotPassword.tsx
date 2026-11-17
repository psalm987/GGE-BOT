import { MailOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input } from "antd"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"

export function ForgotPassword() {
    const { t } = useTranslation("client")
    const { t: tc } = useTranslation("common")
    const request = useMutation(orpc.auth.requestPasswordReset.mutationOptions())
    return (
        <AuthShell title={t("forgot.title")} subtitle={t("forgot.subtitle")}
            footer={<Link to="/login">{t("auth.backToSignIn")}</Link>}>
            {request.isSuccess
                ? <Alert type="success" showIcon role="status" title={t("forgot.sentTitle")}
                    description={t("forgot.sentBody")} />
                : <>
                    {request.error && <Alert type="error" showIcon title={messageOf(request.error)} style={{ marginBottom: 16 }} role="alert" />}
                    <Form layout="vertical" requiredMark={false} onFinish={({ email }) => request.mutate({ email })} disabled={request.isPending}>
                        <Form.Item label={tc("field.email")} name="email" rules={[{ required: true, type: "email", message: tc("validation.email") }]}>
                            <Input prefix={<MailOutlined />} type="email" autoComplete="email" autoFocus size="large" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block size="large" loading={request.isPending} className="gge-press">{t("forgot.submit")}</Button>
                    </Form>
                </>}
        </AuthShell>
    )
}
