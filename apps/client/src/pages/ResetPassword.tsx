import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form } from "antd"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"
import { PasswordFields } from "../components/PasswordFields.tsx"

export function ResetPassword() {
    const { t } = useTranslation("client")
    const token = useSearchParams()[0].get("token")
    const reset = useMutation(orpc.auth.resetPassword.mutationOptions())
    const footer = <Link to="/login">{t("auth.backToSignIn")}</Link>
    if (!token)
        return (
            <AuthShell title={t("reset.invalidTitle")} footer={<Link to="/forgot-password">{t("reset.requestNew")}</Link>}>
                <Alert type="error" showIcon role="alert" title={t("link.incomplete")} description={t("reset.incompleteHint")} />
            </AuthShell>
        )
    return (
        <AuthShell title={t("reset.title")} subtitle={t("reset.subtitle")} footer={footer}>
            {reset.isSuccess
                ? <Alert type="success" showIcon role="status" title={t("reset.doneTitle")} description={<Link to="/login">{t("reset.signInWithNew")}</Link>} />
                : <>
                    {reset.error && <Alert type="error" showIcon title={messageOf(reset.error)} style={{ marginBottom: 16 }} role="alert" />}
                    <Form layout="vertical" requiredMark={false} onFinish={({ password }) => reset.mutate({ token, password })} disabled={reset.isPending}>
                        <PasswordFields isNew size="large" autoFocus />
                        <Button type="primary" htmlType="submit" block size="large" loading={reset.isPending} className="gge-press">{t("reset.submit")}</Button>
                    </Form>
                </>}
        </AuthShell>
    )
}
