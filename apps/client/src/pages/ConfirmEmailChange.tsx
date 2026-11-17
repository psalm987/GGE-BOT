import { useMutation } from "@tanstack/react-query"
import { Alert, Spin } from "antd"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

export function ConfirmEmailChange() {
    const { t } = useTranslation("client")
    const token = useSearchParams()[0].get("token")
    const confirm = useMutation(orpc.account.confirmEmailChange.mutationOptions({
        // The change ended this browser's session too, so nothing cached is still the player's to see.
        onSuccess: () => queryClient.clear(),
    }))
    const started = useRef(false)
    useEffect(() => {
        if (token && !started.current) {
            started.current = true
            confirm.mutate({ token })
        }
    })
    return (
        <AuthShell title={t("confirmChange.title")} footer={<Link to="/login">{t("confirmChange.signIn")}</Link>}>
            {!token && <Alert type="error" showIcon role="alert" title={t("link.incomplete")} description={t("link.incompleteHint")} />}
            {token && confirm.isSuccess && <Alert type="success" showIcon role="status" title={t("confirmChange.doneTitle")} description={t("confirmChange.doneBody")} />}
            {token && confirm.error && <Alert type="error" showIcon role="alert" title={messageOf(confirm.error)} description={t("confirmChange.failedHint")} />}
            {token && !confirm.isSuccess && !confirm.error && <Spin />}
        </AuthShell>
    )
}
