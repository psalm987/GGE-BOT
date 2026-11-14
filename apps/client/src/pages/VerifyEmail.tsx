import { useMutation } from "@tanstack/react-query"
import { Alert, Spin } from "antd"
import { useEffect, useRef } from "react"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"

export function VerifyEmail() {
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
        <AuthShell title="Verify your email" footer={<Link to="/">Continue to GGE Command</Link>}>
            {!token && <Alert type="error" showIcon role="alert" title="This link is incomplete" description="Open the link from your email again." />}
            {token && verify.isSuccess && <Alert type="success" showIcon role="status" title="Email verified" description="Thanks. Your address is confirmed." />}
            {token && verify.error && <Alert type="error" showIcon role="alert" title={messageOf(verify.error)} description="Sign in and choose Resend the link for a fresh one." />}
            {token && !verify.isSuccess && !verify.error && <Spin />}
        </AuthShell>
    )
}
