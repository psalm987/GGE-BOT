import { useMutation } from "@tanstack/react-query"
import { Alert, Spin } from "antd"
import { useEffect, useRef } from "react"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

export function ConfirmEmailChange() {
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
        <AuthShell title="Confirm your new email" footer={<Link to="/login">Go to sign in</Link>}>
            {!token && <Alert type="error" showIcon role="alert" title="This link is incomplete" description="Open the link from your email again." />}
            {token && confirm.isSuccess && <Alert type="success" showIcon role="status" title="Email changed" description="You were signed out on every device. Sign in with your new email." />}
            {token && confirm.error && <Alert type="error" showIcon role="alert" title={messageOf(confirm.error)} description="Your email was not changed. Sign in and ask for a new link under Settings." />}
            {token && !confirm.isSuccess && !confirm.error && <Spin />}
        </AuthShell>
    )
}
