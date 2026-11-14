import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form } from "antd"
import { Link, useSearchParams } from "react-router"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc } from "../api.ts"
import { PasswordFields } from "../components/PasswordFields.tsx"

export function ResetPassword() {
    const token = useSearchParams()[0].get("token")
    const reset = useMutation(orpc.auth.resetPassword.mutationOptions())
    const footer = <Link to="/login">Back to sign in</Link>
    if (!token)
        return (
            <AuthShell title="Reset password" footer={<Link to="/forgot-password">Request a new link</Link>}>
                <Alert type="error" showIcon role="alert" title="This link is incomplete" description="Open the link from your email again, or request a new one." />
            </AuthShell>
        )
    return (
        <AuthShell title="Choose a new password" subtitle="You'll be signed out everywhere and can sign in with the new password." footer={footer}>
            {reset.isSuccess
                ? <Alert type="success" showIcon role="status" title="Password changed" description={<Link to="/login">Sign in with your new password</Link>} />
                : <>
                    {reset.error && <Alert type="error" showIcon title={messageOf(reset.error)} style={{ marginBottom: 16 }} role="alert" />}
                    <Form layout="vertical" requiredMark={false} onFinish={({ password }) => reset.mutate({ token, password })} disabled={reset.isPending}>
                        <PasswordFields label="New password" size="large" autoFocus />
                        <Button type="primary" htmlType="submit" block size="large" loading={reset.isPending} className="gge-press">Change password</Button>
                    </Form>
                </>}
        </AuthShell>
    )
}
