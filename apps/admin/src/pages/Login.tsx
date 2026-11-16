import { LockOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input, QRCode, Typography } from "antd"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router"
import type { PublicUser } from "@gge/contracts"
import { AuthShell } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { CODE_RULES, CodeInput } from "../components/CodeInput.tsx"
import { RecoveryCodes } from "../components/RecoveryCodes.tsx"
import { CLIENT_URL } from "../config.ts"

type Step =
    | { name: "credentials" }
    | { name: "totp"; useRecoveryCode: boolean }
    | { name: "enroll"; otpauthUri: string; secret: string }
    | { name: "recoveryCodes"; user: PublicUser; codes: string[] }

const SHELL: Record<Step["name"], { title: string; subtitle: string }> = {
    credentials: { title: "Admin sign in", subtitle: "Administrators only." },
    totp: { title: "Two-factor sign-in", subtitle: "Your password is right. One more step." },
    enroll: { title: "Set up two-factor sign-in", subtitle: "Admins sign in with a password and a code from an authenticator app." },
    recoveryCodes: { title: "Save your recovery codes", subtitle: "Two-factor sign-in is on." },
}

export function Login() {
    const navigate = useNavigate()
    const from = (useLocation().state as { from?: string } | null)?.from ?? "/"
    const [step, setStep] = useState<Step>({ name: "credentials" })
    const [error, setError] = useState<unknown>()

    const enter = (user: PublicUser) => {
        queryClient.setQueryData(orpc.auth.me.queryKey(), user)
        navigate(from, { replace: true })
    }
    // The API answers UNAUTHORIZED once the sign-in attempt is over (timed out, or too many wrong codes): only the password step can start another.
    const settle = {
        onMutate: () => setError(undefined),
        onError: (failure: unknown) => {
            setError(failure)
            if ((failure as { code?: string }).code === "UNAUTHORIZED")
                setStep({ name: "credentials" })
        },
    }
    const enrollStart = useMutation(orpc.auth.enrollStart.mutationOptions({ ...settle, onSuccess: enrollment => setStep({ name: "enroll", ...enrollment }) }))
    const login = useMutation(orpc.auth.login.mutationOptions({
        ...settle,
        onSuccess: next => next.step === "enroll" ? enrollStart.mutate({}) : setStep({ name: "totp", useRecoveryCode: false }),
    }))
    const verify = useMutation(orpc.auth.verifyTotp.mutationOptions({ ...settle, onSuccess: enter }))
    const confirm = useMutation(orpc.auth.enrollConfirm.mutationOptions({
        ...settle,
        onSuccess: ({ user, recoveryCodes }) => setStep({ name: "recoveryCodes", user, codes: recoveryCodes }),
    }))
    const startOver = () => { setError(undefined); setStep({ name: "credentials" }) }

    return (
        <AuthShell {...SHELL[step.name]} wide={step.name === "enroll"}>
            {error !== undefined && <Alert type="error" showIcon title={messageOf(error)} style={{ marginBottom: 16 }} role="alert" />}

            {step.name === "credentials" && (
                <Form layout="vertical" requiredMark={false} onFinish={values => login.mutate(values)} disabled={login.isPending || enrollStart.isPending}>
                    <Form.Item label="Username or email" name="login" rules={[{ required: true, message: "Enter your username or email" }]}>
                        <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
                    </Form.Item>
                    <Form.Item label="Password" name="password" rules={[{ required: true, message: "Enter your password" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
                    </Form.Item>
                    <div style={{ marginBottom: 16, textAlign: "end" }}><a href={`${CLIENT_URL}/forgot-password`}>Forgot password?</a></div>
                    <Button type="primary" htmlType="submit" block size="large" loading={login.isPending || enrollStart.isPending} className="gge-press">Sign in</Button>
                </Form>
            )}

            {step.name === "totp" && (
                <Form key={String(step.useRecoveryCode)} layout="vertical" requiredMark={false} disabled={verify.isPending}
                    onFinish={(values: { code: string }) => verify.mutate(step.useRecoveryCode ? { recoveryCode: values.code } : { code: values.code })}>
                    {step.useRecoveryCode ? (
                        <Form.Item label="Recovery code" name="code" extra="One of the codes you saved when you set up two-factor sign-in. Each works once."
                            rules={[{ required: true, message: "Enter a recovery code" }]}>
                            <Input autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus size="large" placeholder="xxxxx-xxxxx" maxLength={64} />
                        </Form.Item>
                    ) : (
                        <Form.Item label="Authenticator code" name="code" extra="The 6-digit code your authenticator app shows for GGE Bot Admin." rules={CODE_RULES}>
                            <CodeInput autoFocus />
                        </Form.Item>
                    )}
                    <Button type="primary" htmlType="submit" block size="large" loading={verify.isPending} className="gge-press">Verify</Button>
                    <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <Button type="link" style={{ padding: 0 }} onClick={() => { setError(undefined); setStep({ name: "totp", useRecoveryCode: !step.useRecoveryCode }) }}>
                            {step.useRecoveryCode ? "Use an authenticator code" : "Use a recovery code"}
                        </Button>
                        <Button type="link" style={{ padding: 0 }} onClick={startOver}>Back to sign in</Button>
                    </div>
                </Form>
            )}

            {step.name === "enroll" && (
                <Form layout="vertical" requiredMark={false} disabled={confirm.isPending} onFinish={(values: { code: string }) => confirm.mutate(values)}>
                    <Typography.Paragraph>
                        1. Scan this QR code with an authenticator app such as Google Authenticator, 1Password or Authy.
                    </Typography.Paragraph>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                        <QRCode value={step.otpauthUri} size={200} color="#000000" bgColor="#ffffff" aria-label="QR code for your authenticator app" />
                    </div>
                    <Typography.Paragraph>
                        Can't scan it? Enter this key in the app by hand:<br />
                        <Typography.Text code copyable aria-label="Setup key" style={{ wordBreak: "break-all" }}>{step.secret}</Typography.Text>
                    </Typography.Paragraph>
                    <Form.Item label="2. Enter the 6-digit code the app shows" name="code" rules={CODE_RULES}>
                        <CodeInput />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block size="large" loading={confirm.isPending} className="gge-press">Turn on two-factor sign-in</Button>
                    <div style={{ marginTop: 16 }}><Button type="link" style={{ padding: 0 }} onClick={startOver}>Back to sign in</Button></div>
                </Form>
            )}

            {step.name === "recoveryCodes" && (
                <>
                    <RecoveryCodes codes={step.codes} />
                    <Button type="primary" block size="large" className="gge-press" style={{ marginTop: 24 }} onClick={() => enter(step.user)}>I've saved them, continue</Button>
                </>
            )}
        </AuthShell>
    )
}
