import { useMutation, useQuery } from "@tanstack/react-query"
import { App, Button, Form, Modal, Select, Typography } from "antd"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ParchmentCard } from "@gge/ui"
import { messageOf, orpc, queryClient } from "../api.ts"
import { AdminPage, QueryError } from "../components/AdminPage.tsx"
import { CodeInput, useCodeRules } from "../components/CodeInput.tsx"
import { RecoveryCodes } from "../components/RecoveryCodes.tsx"

/** The choices for an attack plugin limit, in the language on screen. */
export function useAttackCapOptions() {
    const { t } = useTranslation("admin")
    return [
        { value: "4", label: t("attackCap.n", { count: 4 }) },
        { value: "6", label: t("attackCap.n", { count: 6 }) },
        { value: "none", label: t("attackCap.none") },
    ] as const
}

export function Settings() {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const capOptions = useAttackCapOptions()
    const settings = useQuery(orpc.settings.get.queryOptions())
    const setCap = useMutation(orpc.settings.setAttackPluginCap.mutationOptions({
        onSuccess: () => {
            message.success(t("settings.defaultUpdated"))
            void queryClient.invalidateQueries({ queryKey: orpc.settings.get.key() })
            void queryClient.invalidateQueries({ queryKey: orpc.users.list.key() })
        },
        onError: (error: unknown) => message.error(messageOf(error)),
    }))
    return (
        <AdminPage title={tc("nav.settings")}>
            {settings.error && <QueryError error={settings.error} onRetry={() => void settings.refetch()} />}
            <ParchmentCard title={t("settings.attackTitle")}>
                <Typography.Paragraph type="secondary">{t("settings.attackIntro")}</Typography.Paragraph>
                <Form layout="vertical">
                    <Form.Item label={t("settings.defaultLimit")} htmlFor="attack-cap-default">
                        <Select id="attack-cap-default" style={{ width: 220 }} loading={settings.isPending} disabled={setCap.isPending}
                            value={settings.data?.attackPluginCap} options={[...capOptions]}
                            onChange={cap => setCap.mutate({ cap })} />
                    </Form.Item>
                </Form>
            </ParchmentCard>
            <TwoFactorCard />
        </AdminPage>
    )
}

type Regenerate = { name: "closed" } | { name: "asking" } | { name: "done"; codes: string[] }

function TwoFactorCard() {
    const { message } = App.useApp()
    const { t } = useTranslation("admin")
    const { t: tc } = useTranslation("common")
    const codeRules = useCodeRules()
    const [state, setState] = useState<Regenerate>({ name: "closed" })
    const [form] = Form.useForm<{ code: string }>()
    const regenerate = useMutation(orpc.security.regenerateRecoveryCodes.mutationOptions({
        onSuccess: codes => setState({ name: "done", codes }),
        onError: (error: unknown) => message.error(messageOf(error)),
    }))
    const close = () => { form.resetFields(); setState({ name: "closed" }) }
    return (
        <ParchmentCard title={t("settings.twoFactorTitle")} style={{ marginTop: 16 }}>
            <Typography.Paragraph type="secondary">{t("settings.twoFactorIntro")}</Typography.Paragraph>
            <Button onClick={() => setState({ name: "asking" })}>{t("settings.regenerate")}</Button>
            <Modal open={state.name !== "closed"} onCancel={close} destroyOnHidden
                title={state.name === "done" ? t("settings.newCodesTitle") : t("settings.regenerate")}
                footer={state.name === "done"
                    ? <Button type="primary" onClick={close}>{t("settings.savedThem")}</Button>
                    : [<Button key="cancel" onClick={close}>{tc("action.cancel")}</Button>, <Button key="ok" type="primary" loading={regenerate.isPending} onClick={() => form.submit()}>{t("settings.regenerateOk")}</Button>]}>
                {state.name === "done" ? <RecoveryCodes codes={state.codes} /> : (
                    <Form form={form} layout="vertical" requiredMark={false} disabled={regenerate.isPending} onFinish={values => regenerate.mutate(values)}>
                        <Form.Item label={t("settings.codeLabel")} name="code" extra={t("settings.codeHint")} rules={codeRules}>
                            <CodeInput autoFocus />
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </ParchmentCard>
    )
}
