import { useMutation } from "@tanstack/react-query"
import { Alert, Spin } from "antd"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

export function VerifyEmail() {
    const { t } = useTranslation("client")
    const token = useSearchParams()[0].get("token")
    const verify = useMutation(orpc.auth.verifyEmail.mutationOptions({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.auth.me.queryKey() }),
    }))
    const started = useRef(false)
    useEffect(() => {
        if (token && !started.current) {
            started.current = true
            verify.mutate({ token })
        }
    })
    return (
        <AuthShell title={t("verify.title")} footer={<Link to="/">{t("verify.continue")}</Link>}>
            {!token && <Alert type="error" showIcon role="alert" title={t("link.incomplete")} description={t("link.incompleteHint")} />}
            {token && verify.isSuccess && <Alert type="success" showIcon role="status" title={t("verify.doneTitle")} description={t("verify.doneBody")} />}
            {token && verify.error && <Alert type="error" showIcon role="alert" title={messageOf(verify.error)} description={t("verify.failedHint")} />}
            {token && !verify.isSuccess && !verify.error && <Spin />}
        </AuthShell>
    )
}
