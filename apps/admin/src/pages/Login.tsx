import { LockOutlined, UserOutlined } from "@ant-design/icons"
import { useMutation } from "@tanstack/react-query"
import { Alert, Button, Form, Input, QRCode, Typography } from "antd"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router"
import type { PublicUser } from "@gge/contracts"
import { AuthShell, messageOf } from "@gge/ui"
import { orpc, queryClient } from "../api.ts"
import { CodeInput, useCodeRules } from "../components/CodeInput.tsx"
import { RecoveryCodes } from "../components/RecoveryCodes.tsx"
import { CLIENT_URL } from "../config.ts"

type Step =
    | { name: "credentials" }
    | { name: "totp"; useRecoveryCode: boolean }
    | { name: "enroll"; otpauthUri: string; secret: string }
    | { name: "recoveryCodes"; user: PublicUser; codes: string[] }

const SHELL: Record<Step["name"], { titleKey: string; subtitleKey: string }> = {
    credentials: { titleKey: "login.adminTitle", subtitleKey: "login.adminSubtitle" },
    totp: { titleKey: "login.totpTitle", subtitleKey: "login.totpSubtitle" },
    enroll: { titleKey: "login.enrollTitle", subtitleKey: "login.enrollSubtitle" },
    recoveryCodes: { titleKey: "login.recoveryTitle", subtitleKey: "login.recoverySubtitle" },
}

export function Login() {
    const navigate = useNavigate()
    const { t } = useTranslation("admin")
    const codeRules = useCodeRules()
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
        <AuthShell title={t(SHELL[step.name].titleKey)} subtitle={t(SHELL[step.name].subtitleKey)} wide={step.name === "enroll"}>
            {error !== undefined && <Alert type="error" showIcon title={messageOf(error)} style={{ marginBottom: 16 }} role="alert" />}

            {step.name === "credentials" && (
                <Form layout="vertical" requiredMark={false} onFinish={values => login.mutate(values)} disabled={login.isPending || enrollStart.isPending}>
                    <Form.Item label={t("login.identifier")} name="login" rules={[{ required: true, message: t("login.identifierRequired") }]}>
                        <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
                    </Form.Item>
                    <Form.Item label={t("field.password", { ns: "common" })} name="password" rules={[{ required: true, message: t("login.passwordRequired") }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
                    </Form.Item>
                    <div style={{ marginBottom: 16, textAlign: "end" }}><a href={`${CLIENT_URL}/forgot-password`}>{t("login.forgot")}</a></div>
                    <Button type="primary" htmlType="submit" block size="large" loading={login.isPending || enrollStart.isPending} className="gge-press">{t("action.signIn", { ns: "common" })}</Button>
                </Form>
            )}

            {step.name === "totp" && (
                <Form key={String(step.useRecoveryCode)} layout="vertical" requiredMark={false} disabled={verify.isPending}
                    onFinish={(values: { code: string }) => verify.mutate(step.useRecoveryCode ? { recoveryCode: values.code } : { code: values.code })}>
                    {step.useRecoveryCode ? (
                        <Form.Item label={t("login.recoveryLabel")} name="code" extra={t("login.recoveryHint")}
                            rules={[{ required: true, message: t("login.recoveryRequired") }]}>
                            <Input autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus size="large" placeholder="xxxxx-xxxxx" maxLength={64} />
                        </Form.Item>
                    ) : (
                        <Form.Item label={t("login.codeLabel")} name="code" extra={t("login.codeHint")} rules={codeRules}>
                            <CodeInput autoFocus />
                        </Form.Item>
                    )}
                    <Button type="primary" htmlType="submit" block size="large" loading={verify.isPending} className="gge-press">{t("login.verify")}</Button>
                    <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <Button type="link" style={{ padding: 0 }} onClick={() => { setError(undefined); setStep({ name: "totp", useRecoveryCode: !step.useRecoveryCode }) }}>
                            {step.useRecoveryCode ? t("login.useCode") : t("login.useRecovery")}
                        </Button>
                        <Button type="link" style={{ padding: 0 }} onClick={startOver}>{t("login.backToSignIn")}</Button>
                    </div>
                </Form>
            )}

            {step.name === "enroll" && (
                <Form layout="vertical" requiredMark={false} disabled={confirm.isPending} onFinish={(values: { code: string }) => confirm.mutate(values)}>
                    <Typography.Paragraph>{t("login.enrollScan")}</Typography.Paragraph>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                        <QRCode value={step.otpauthUri} size={200} color="#000000" bgColor="#ffffff" aria-label={t("login.qrLabel")} />
                    </div>
                    <Typography.Paragraph>
                        {t("login.enrollManual")}<br />
                        <Typography.Text code copyable aria-label={t("login.setupKey")} style={{ wordBreak: "break-all" }}>{step.secret}</Typography.Text>
                    </Typography.Paragraph>
                    <Form.Item label={t("login.enrollCodeLabel")} name="code" rules={codeRules}>
                        <CodeInput />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block size="large" loading={confirm.isPending} className="gge-press">{t("login.turnOn")}</Button>
                    <div style={{ marginTop: 16 }}><Button type="link" style={{ padding: 0 }} onClick={startOver}>{t("login.backToSignIn")}</Button></div>
                </Form>
            )}

            {step.name === "recoveryCodes" && (
                <>
                    <RecoveryCodes codes={step.codes} />
                    <Button type="primary" block size="large" className="gge-press" style={{ marginTop: 24 }} onClick={() => enter(step.user)}>{t("login.savedContinue")}</Button>
                </>
            )}
        </AuthShell>
    )
}
